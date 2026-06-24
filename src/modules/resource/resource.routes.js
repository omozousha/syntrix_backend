const express = require('express');
const { randomUUID } = require('crypto');
const multer = require('multer');
const FormData = require('form-data');
const XLSX = require('xlsx');
const { env } = require('../../config/env');
const { authenticate, requireRole } = require('../../middleware/auth.middleware');
const { getResourceConfig, RESOURCE_CONFIG } = require('./resource.registry');
const controller = require('./resource.controller');
const { createHttpError } = require('../../utils/httpError');
const { nhostAuthClient, nhostStorageClient } = require('../../config/nhost');
const { executeHasura, executeHasuraSql } = require('../../config/hasura');
const { sendSuccess } = require('../../utils/response');
const { buildWhereClause, listResources } = require('../../shared/resource.service');
const { createAuditLog } = require('../../shared/audit.service');
const { buildOdpCoreChainSummary, buildOdpCoreChainDraft } = require('../device/odp-chain.service');
const { validateFiberCoreRangeForConnection } = require('../device/fiber-core-policy.service');
const { createRedirectToNotAllowedError, isRedirectToNotAllowed } = require('../auth/auth.service');
const { getPagination } = require('../../utils/pagination');
const { normalizeRoleName, isSuperAdminRole, isRegionalRole } = require('../../utils/roles');
const { parseSplitterRatioPorts } = require('../../utils/splitterRatio');
const { buildFiberCorePhysicalFields } = require('../../utils/fiberColor');
const {
  STATUS: VALIDATION_STATUS,
  ACTION: VALIDATION_ACTION,
  createRequest: createValidationRequest,
  insertRequestLog: insertValidationRequestLog,
} = require('../validation/validation.service');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.maxUploadSizeMb * 1024 * 1024,
  },
});

const resourceRouter = express.Router();
const DEFAULT_QR_LABEL_FOOTER = 'Scan QR untuk membuka detail/validasi Device';
const REFERENCE_DATA_GROUPS = {
  regions: { resourceName: 'regions' },
  pops: { resourceName: 'pops' },
  tenants: { resourceName: 'tenants' },
  deviceTypes: { resourceName: 'deviceTypes' },
  brands: { resourceName: 'brands' },
  models: { resourceName: 'assetModels' },
  assetModels: { resourceName: 'assetModels' },
  manufacturers: { resourceName: 'manufacturers' },
  projects: { resourceName: 'projects' },
  customers: { resourceName: 'customers' },
  serviceTypes: { resourceName: 'serviceTypes' },
  odpTypes: { resourceName: 'odpTypes' },
  installationTypes: { resourceName: 'installationTypes' },
  splitterProfiles: { resourceName: 'splitterProfiles' },
};
const DEFAULT_REFERENCE_DATA_GROUPS = ['regions', 'pops', 'tenants', 'deviceTypes', 'brands', 'models', 'manufacturers'];
const REFERENCE_DATA_CACHE_TTL_MS = 60 * 1000;
const referenceDataCache = new Map();

function sqlLiteral(value) {
  if (value == null || value === '') return 'null';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlBoolean(value) {
  return value === false || String(value).toLowerCase() === 'false' ? 'false' : 'true';
}

function mapSqlRows(result) {
  const rows = result?.result || [];
  const headers = rows[0] || [];
  return rows.slice(1).map((row) => headers.reduce((accumulator, header, index) => {
    accumulator[header] = normalizeSqlValue(row[index]);
    return accumulator;
  }, {}));
}

function normalizeSqlValue(value) {
  if (value === '' || value == null) return null;
  if (String(value).toUpperCase() === 'NULL') return null;
  return value;
}

function normalizeNullableUuid(value) {
  const text = String(value || '').trim();
  if (!text || text.toLowerCase() === 'null' || text.toLowerCase() === 'undefined') return null;
  return text;
}

function parseReferenceGroups(value) {
  const rawGroups = String(value || '')
    .split(',')
    .map((group) => group.trim())
    .filter(Boolean);
  const groups = rawGroups.length ? rawGroups : DEFAULT_REFERENCE_DATA_GROUPS;
  return Array.from(new Set(groups)).filter((group) => REFERENCE_DATA_GROUPS[group]);
}

function buildReferenceDataCacheKey(req, groups, limit) {
  const query = { ...req.query };
  delete query.page;
  const normalizedQuery = Object.keys(query)
    .sort()
    .reduce((accumulator, key) => {
      accumulator[key] = query[key];
      return accumulator;
    }, {});

  return JSON.stringify({
    role: normalizeRoleName(req.auth.role),
    userId: req.auth.appUser?.id || null,
    regions: [...(req.auth.regions || [])].sort(),
    groups,
    limit,
    query: normalizedQuery,
  });
}

function getCachedReferenceData(cacheKey) {
  const cached = referenceDataCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() > cached.expiresAt) {
    referenceDataCache.delete(cacheKey);
    return null;
  }
  return cached.payload;
}

function setCachedReferenceData(cacheKey, payload) {
  referenceDataCache.set(cacheKey, {
    payload,
    expiresAt: Date.now() + REFERENCE_DATA_CACHE_TTL_MS,
  });
}

function getRegionalTopologyScope(auth) {
  if (!isRegionalRole(auth?.role)) {
    return { allowedRegionIds: [], isRegional: false };
  }

  const allowedRegionIds = Array.from(new Set((auth?.regions || []).filter(Boolean)));
  if (!allowedRegionIds.length) {
    throw createHttpError(403, 'This regional user does not have any assigned region');
  }

  return { allowedRegionIds, isRegional: true };
}

function assertTopologyRegionAccess(scope, regionId, message = 'You do not have access to this region') {
  if (scope.isRegional && regionId && !scope.allowedRegionIds.includes(regionId)) {
    throw createHttpError(403, message);
  }
}

function buildReferenceDataWhere(config, query, auth) {
  const where = buildWhereClause(config, query, auth);
  const normalizedRole = normalizeRoleName(auth.role);
  if (config.table === 'regions' && isRegionalRole(normalizedRole)) {
    if (!auth.regions.length) {
      throw createHttpError(403, 'This regional user does not have any assigned region');
    }

    const scopedCondition = { id: { _in: auth.regions } };
    if (!where._and?.length) return { _and: [scopedCondition] };
    return { _and: [...where._and, scopedCondition] };
  }

  return where;
}

function normalizeQrLabelSetting(row = {}) {
  return {
    id: row.id || null,
    setting_key: row.setting_key || 'default',
    qr_logo_attachment_id: normalizeNullableUuid(row.qr_logo_attachment_id),
    qr_logo_url: row.qr_logo_attachment_id ? `/attachments/${row.qr_logo_attachment_id}/preview` : null,
    qr_logo_original_name: row.qr_logo_original_name || null,
    qr_logo_mime_type: row.qr_logo_mime_type || null,
    footer_text: row.footer_text || DEFAULT_QR_LABEL_FOOTER,
    is_active: row.is_active == null ? true : String(row.is_active) === 'true',
    updated_by_user_id: row.updated_by_user_id || null,
    updated_at: row.updated_at || null,
  };
}

async function getQrLabelSetting() {
  await executeHasuraSql(`
    insert into public.qr_label_settings (setting_key, footer_text, is_active)
    values ('default', ${sqlLiteral(DEFAULT_QR_LABEL_FOOTER)}, true)
    on conflict (setting_key) do nothing;
  `);

  const rows = mapSqlRows(await executeHasuraSql(`
    select
      s.id::text,
      s.setting_key,
      s.qr_logo_attachment_id::text,
      a.original_name as qr_logo_original_name,
      a.mime_type as qr_logo_mime_type,
      s.footer_text,
      s.is_active::text,
      s.updated_by_user_id::text,
      s.updated_at::text
    from public.qr_label_settings s
    left join public.attachments a on a.id = s.qr_logo_attachment_id
    where s.setting_key = 'default'
    limit 1;
  `));

  return normalizeQrLabelSetting(rows[0]);
}

function isMissingTenantFieldError(error) {
  const message = String(error?.message || error?.response?.data?.message || '').toLowerCase();
  return message.includes('tenant_id') || message.includes('tenants_by_pk') || message.includes('field') && message.includes('not found');
}

async function loadDeviceById(deviceId, options = {}) {
  const includeTenant = options.includeTenant !== false;
  const query = includeTenant ? `
    query LoadDeviceById($id: uuid!) {
      item: devices_by_pk(id: $id) {
        id
        device_id
        device_code
        device_name
        device_type_key
        total_ports
        splitter_ratio
        region_id
        pop_id
        project_id
        tenant_id
        status
        deleted_at
      }
    }
  ` : `
    query LoadDeviceById($id: uuid!) {
      item: devices_by_pk(id: $id) {
        id
        device_id
        device_code
        device_name
        device_type_key
        total_ports
        splitter_ratio
        region_id
        pop_id
        project_id
        status
        deleted_at
      }
    }
  `;

  let data;
  try {
    data = await executeHasura(query, { id: deviceId });
  } catch (error) {
    if (includeTenant && isMissingTenantFieldError(error)) {
      return loadDeviceById(deviceId, { includeTenant: false });
    }
    throw error;
  }
  return data.item;
}

async function loadTenantById(tenantId) {
  if (!tenantId) return null;
  const query = `
    query LoadTenantById($id: uuid!) {
      item: tenants_by_pk(id: $id) {
        id
        tenant_code
        tenant_name
        is_active
        deleted_at
      }
    }
  `;

  const data = await executeHasura(query, { id: tenantId });
  return data.item && !data.item.deleted_at ? data.item : null;
}

async function loadRegionById(regionId) {
  if (!regionId) return null;
  const query = `
    query LoadRegionById($id: uuid!) {
      item: regions_by_pk(id: $id) {
        id
        region_code
        region_name
      }
    }
  `;

  const data = await executeHasura(query, { id: regionId });
  return data.item || null;
}

function isMissingPopDeletedAtFieldError(error) {
  const message = String(error?.message || error?.response?.data?.message || '').toLowerCase();
  return message.includes('deleted_at') && message.includes('pops');
}

async function loadPopById(popId, options = {}) {
  if (!popId) return null;
  const includeDeletedAt = options.includeDeletedAt !== false;
  const query = includeDeletedAt ? `
    query LoadPopById($id: uuid!) {
      item: pops_by_pk(id: $id) {
        id
        pop_id
        pop_code
        pop_name
        deleted_at
      }
    }
  ` : `
    query LoadPopById($id: uuid!) {
      item: pops_by_pk(id: $id) {
        id
        pop_id
        pop_code
        pop_name
      }
    }
  `;

  let data;
  try {
    data = await executeHasura(query, { id: popId });
  } catch (error) {
    if (includeDeletedAt && isMissingPopDeletedAtFieldError(error)) {
      return loadPopById(popId, { includeDeletedAt: false });
    }
    throw error;
  }
  return data.item && !data.item.deleted_at ? data.item : null;
}

async function loadPublicQrDeviceContext(deviceId) {
  const device = await loadDeviceById(deviceId);
  if (!device || device.deleted_at) return null;
  const [tenant, region, pop] = await Promise.all([
    loadTenantById(device.tenant_id).catch(() => null),
    loadRegionById(device.region_id).catch(() => null),
    loadPopById(device.pop_id).catch(() => null),
  ]);

  return {
    id: device.id,
    region_id: device.region_id || null,
    device_type_key: device.device_type_key || null,
    device_name: device.device_name || device.device_code || device.device_id || null,
    region: region
      ? {
          id: region.id,
          region_code: region.region_code || null,
          region_name: region.region_name || null,
        }
      : null,
    pop: pop
      ? {
          id: pop.id,
          pop_id: pop.pop_id || null,
          pop_code: pop.pop_code || null,
          pop_name: pop.pop_name || null,
        }
      : null,
    tenant: tenant
      ? {
          id: tenant.id,
          tenant_code: tenant.tenant_code || null,
          tenant_name: tenant.tenant_name || null,
        }
      : null,
  };
}

async function loadDevicePortTemplate(deviceTypeKey, profileName = 'default') {
  const query = `
    query LoadDevicePortTemplate($deviceTypeKey: String!, $profileName: String!) {
      items: device_port_templates(
        where: {
          device_type_key: { _eq: $deviceTypeKey }
          profile_name: { _eq: $profileName }
          is_active: { _eq: true }
        }
        limit: 1
      ) {
        id
        template_id
        device_type_key
        profile_name
        total_ports
        start_port_index
        default_port_type
        default_direction
        default_speed_profile
        default_core_capacity
      }
    }
  `;
  const data = await executeHasura(query, { deviceTypeKey, profileName });
  return data.items?.[0] || null;
}

async function loadDevicePortsByDeviceId(deviceId) {
  const query = `
    query LoadDevicePortsByDeviceId($deviceId: uuid!) {
      items: device_ports(
        where: { device_id: { _eq: $deviceId } }
        order_by: [{ port_index: asc }]
      ) {
        id
        port_id
        port_index
        port_label
        port_type
        direction
        status
        core_capacity
      }
    }
  `;
  const data = await executeHasura(query, { deviceId });
  return data.items || [];
}

async function syncDevicePortUsage(deviceId) {
  if (!deviceId) return null;

  const query = `
    query DevicePortUsage($deviceId: uuid!, $usedWhere: device_ports_bool_exp!) {
      total_ports: device_ports_aggregate(where: { device_id: { _eq: $deviceId }, deleted_at: { _is_null: true } }) {
        aggregate { count }
      }
      used_ports: device_ports_aggregate(where: $usedWhere) {
        aggregate { count }
      }
      device: devices_by_pk(id: $deviceId) {
        id
      }
    }
  `;

  const usedWhere = {
    device_id: { _eq: deviceId },
    deleted_at: { _is_null: true },
    _or: [
      { status: { _eq: 'used' } },
      { customer_id: { _is_null: false } },
      { ont_device_id: { _is_null: false } },
    ],
  };

  const data = await executeHasura(query, { deviceId, usedWhere });
  if (!data.device?.id) return null;

  const totalPorts = Number(data.total_ports?.aggregate?.count || 0);
  const usedPorts = Number(data.used_ports?.aggregate?.count || 0);

  await executeHasura(
    `
      mutation UpdateDevicePortUsage($deviceId: uuid!, $set: devices_set_input!) {
        updated: update_devices_by_pk(pk_columns: { id: $deviceId }, _set: $set) {
          id
          total_ports
          used_ports
        }
      }
    `,
    {
      deviceId,
      set: {
        total_ports: totalPorts,
        used_ports: usedPorts,
      },
    },
  );

  return { total_ports: totalPorts, used_ports: usedPorts };
}

async function findActiveProvisionPortsRequest(deviceId, profileName) {
  const query = `
    query FindActiveProvisionPortsRequest($deviceId: uuid!, $payloadMatcher: jsonb!) {
      items: validation_requests(
        where: {
          entity_type: { _eq: "device" }
          entity_id: { _eq: $deviceId }
          current_status: { _eq: "pending_async" }
          payload_snapshot: { _contains: $payloadMatcher }
        }
        order_by: { created_at: desc }
        limit: 1
      ) {
        id
        request_id
        entity_type
        entity_id
        region_id
        submitted_by_user_id
        current_status
        payload_snapshot
        created_at
        updated_at
      }
    }
  `;

  const data = await executeHasura(query, {
    deviceId,
    payloadMatcher: {
      source: 'adminregion-provision-device-ports',
      profile_name: profileName,
    },
  });
  return data.items?.[0] || null;
}

async function findActivePortConnectionCreateRequest({ regionId, fromPortId, toPortId }) {
  const query = `
    query FindActivePortConnectionCreateRequest($regionId: uuid!, $payloadMatcher: jsonb!) {
      items: validation_requests(
        where: {
          entity_type: { _eq: "portConnection" }
          region_id: { _eq: $regionId }
          current_status: { _eq: "pending_async" }
          payload_snapshot: { _contains: $payloadMatcher }
        }
        order_by: { created_at: desc }
        limit: 1
      ) {
        id
        request_id
        entity_type
        entity_id
        region_id
        submitted_by_user_id
        current_status
        payload_snapshot
        created_at
        updated_at
      }
    }
  `;

  const data = await executeHasura(query, {
    regionId,
    payloadMatcher: {
      source: 'adminregion-create-resource',
      operation: 'create',
      resource_name: 'portConnections',
      resource_payload: {
        from_port_id: fromPortId,
        to_port_id: toPortId,
      },
    },
  });
  return data.items?.[0] || null;
}

async function loadDevicesByIds(ids) {
  if (!ids.length) return [];

  const query = `
    query LoadDevicesByIds($ids: [uuid!]!) {
      items: devices(where: { id: { _in: $ids } }) {
        id
        device_id
        device_name
        device_type_key
        region_id
        pop_id
        project_id
        tenant_id
        status
        validation_status
        longitude
        latitude
        splitter_ratio
        total_ports
        used_ports
        capacity_core
        used_core
        updated_at
      }
    }
  `;

  const data = await executeHasura(query, { ids });
  return data.items || [];
}

async function loadCoreManagementByDeviceId(deviceId, limit = 100) {
  const query = `
    query LoadCoreManagementByDeviceId($deviceId: uuid!, $limit: Int!) {
      items: core_management(
        where: {
          _or: [
            { cable_device_id: { _eq: $deviceId } }
            { from_device_id: { _eq: $deviceId } }
            { to_device_id: { _eq: $deviceId } }
          ]
        }
        limit: $limit
        order_by: [{ updated_at: desc }]
      ) {
        id
        core_id
        core_code
        cable_device_id
        route_id
        project_id
        region_id
        pop_id
        from_device_id
        to_device_id
        tray_no
        tube_no
        core_no_start
        core_no_end
        core_count
        used_count
        reserved_count
        status
        splice_info
        notes
        tags
        created_at
        updated_at
      }
    }
  `;
  const data = await executeHasura(query, { deviceId, limit });
  return data.items || [];
}

async function loadFiberCoresByCableDeviceIds(cableDeviceIds, limit = 500) {
  if (!cableDeviceIds.length) return [];
  const query = `
    query LoadFiberCoresByCableDeviceIds($cableDeviceIds: [uuid!]!, $limit: Int!) {
      items: fiber_cores(
        where: { cable_device_id: { _in: $cableDeviceIds } }
        limit: $limit
        order_by: [{ cable_device_id: asc }, { tube_no: asc_nulls_last }, { core_no: asc }]
      ) {
        id
        core_id
        region_id
        cable_device_id
        tray_no
        tube_no
        tube_color_name
        tube_color_hex
        core_no
        status
        from_port_id
        to_port_id
        connection_id
        color_name
        color_hex
        color_standard
        cores_per_tube
        last_loss_db
        last_loss_measured_at
        last_loss_method
        health_notes
      }
    }
  `;
  const data = await executeHasura(query, { cableDeviceIds, limit });
  return data.items || [];
}

async function loadDevicesByRegion({ allowedRegionIds = [], requestedRegionId = null }) {
  const regionFilters = [];
  if (requestedRegionId) {
    regionFilters.push({ region_id: { _eq: requestedRegionId } });
  } else if (allowedRegionIds.length) {
    regionFilters.push({ region_id: { _in: allowedRegionIds } });
  }
  const where = {
    _and: [
      { deleted_at: { _is_null: true } },
      ...regionFilters,
    ],
  };

  const query = `
    query LoadDevicesByRegion($where: devices_bool_exp!) {
      items: devices(where: $where, order_by: [{ device_type_key: asc }, { device_name: asc }]) {
        id
        device_id
        device_name
        device_type_key
        region_id
        pop_id
        project_id
        splitter_ratio
        total_ports
        used_ports
        capacity_core
        used_core
      }
    }
  `;
  const data = await executeHasura(query, { where });
  return data.items || [];
}

async function loadLinksByDeviceIds(deviceIds, allowedRegionIds = []) {
  if (!deviceIds.length) return [];

  if (!allowedRegionIds.length) {
    const query = `
      query LoadLinksByDeviceIds($deviceIds: [uuid!]!) {
        items: device_links(
          where: {
            _and: [
              {
                _or: [
                  { from_device_id: { _in: $deviceIds } }
                  { to_device_id: { _in: $deviceIds } }
                ]
              }
              {
                _or: [
                  { status: { _neq: "inactive" } }
                  { status: { _is_null: true } }
                ]
              }
            ]
          }
        ) {
          id
          link_id
          region_id
          from_device_id
          to_device_id
          link_type
          route_id
          cable_device_id
          core_start
          core_end
          fiber_count
          status
          notes
          created_at
          updated_at
        }
      }
    `;
    const data = await executeHasura(query, { deviceIds });
    return data.items || [];
  }

  const query = `
    query LoadLinksByDeviceIds($deviceIds: [uuid!]!, $allowedRegions: [uuid!]) {
      items: device_links(
        where: {
          _and: [
            {
              _or: [
                { from_device_id: { _in: $deviceIds } }
                { to_device_id: { _in: $deviceIds } }
              ]
            }
            {
              _or: [
                { status: { _neq: "inactive" } }
                { status: { _is_null: true } }
              ]
            }
            {
              region_id: { _in: $allowedRegions }
            }
          ]
        }
      ) {
        id
        link_id
        region_id
        from_device_id
        to_device_id
        link_type
        route_id
        cable_device_id
        core_start
        core_end
        fiber_count
        status
        notes
        created_at
        updated_at
      }
    }
  `;

  const data = await executeHasura(query, { deviceIds, allowedRegions: allowedRegionIds });
  return data.items || [];
}

async function loadPortConnections({ allowedRegionIds = [], requestedRegionId = null }) {
  const regionFilters = [];
  if (requestedRegionId) {
    regionFilters.push({ region_id: { _eq: requestedRegionId } });
  } else if (allowedRegionIds.length) {
    regionFilters.push({ region_id: { _in: allowedRegionIds } });
  }

  const where = {
    _and: [
      {
        _or: [
          { status: { _neq: 'inactive' } },
          { status: { _is_null: true } },
        ],
      },
      ...regionFilters,
    ],
  };

  const query = `
    query LoadPortConnections($where: port_connections_bool_exp!) {
      items: port_connections(where: $where) {
        id
        connection_id
        region_id
        from_port_id
        to_port_id
        connection_type
        status
        route_id
        cable_device_id
        core_start
        core_end
        fiber_count
        installed_at
        notes
        created_at
        updated_at
      }
    }
  `;
  const data = await executeHasura(query, { where });
  return data.items || [];
}

async function loadPortConnectionsByWhere(where, limit = 100) {
  const query = `
    query LoadPortConnectionsByWhere($where: port_connections_bool_exp!, $limit: Int!) {
      items: port_connections(where: $where, limit: $limit, order_by: { updated_at: desc }) {
        id
        connection_id
        region_id
        from_port_id
        to_port_id
        connection_type
        status
        route_id
        cable_device_id
        core_start
        core_end
        fiber_count
        installed_at
        notes
        created_at
        updated_at
      }
    }
  `;
  const data = await executeHasura(query, { where, limit });
  return data.items || [];
}

async function loadPortsByIds(portIds) {
  if (!portIds.length) return [];

  const query = `
    query LoadPortsByIds($ids: [uuid!]!) {
      items: device_ports(where: { id: { _in: $ids } }) {
        id
        port_id
        region_id
        device_id
        port_index
        port_label
        port_type
        direction
        status
      }
    }
  `;
  const data = await executeHasura(query, { ids: portIds });
  return data.items || [];
}

async function loadRoutesByIds(routeIds) {
  if (!routeIds.length) return [];

  const query = `
    query LoadRoutesByIds($ids: [uuid!]!) {
      items: network_routes(where: { id: { _in: $ids } }) {
        id
        route_id
        route_code
        route_name
        route_type
        status
        region_id
        pop_id
        project_id
        start_asset_id
        end_asset_id
        distance_meters
        path_geojson
        updated_at
      }
    }
  `;
  const data = await executeHasura(query, { ids: routeIds });
  return data.items || [];
}

async function loadRoutesByRegion({ allowedRegionIds = [], requestedRegionId = null }) {
  const regionFilters = [];
  if (requestedRegionId) {
    regionFilters.push({ region_id: { _eq: requestedRegionId } });
  } else if (allowedRegionIds.length) {
    regionFilters.push({ region_id: { _in: allowedRegionIds } });
  }
  const where = regionFilters.length ? { _and: regionFilters } : {};

  const query = `
    query LoadRoutesByRegion($where: network_routes_bool_exp!) {
      items: network_routes(where: $where, order_by: [{ updated_at: desc }]) {
        id
        route_id
        route_code
        route_name
        route_type
        status
        region_id
        pop_id
        project_id
        start_asset_id
        end_asset_id
      }
    }
  `;
  const data = await executeHasura(query, { where });
  return data.items || [];
}

function buildPortConnectionLabel(connection, fromPort, toPort, cableDevice, route) {
  const fromDeviceName = fromPort?.device?.device_name || fromPort?.device?.device_id || 'Unknown device';
  const toDeviceName = toPort?.device?.device_name || toPort?.device?.device_id || 'Unknown device';
  const fromPortName = fromPort?.port_label || fromPort?.port_id || `Port ${fromPort?.port_index || '-'}`;
  const toPortName = toPort?.port_label || toPort?.port_id || `Port ${toPort?.port_index || '-'}`;

  return {
    title: `${fromDeviceName} ${fromPortName} -> ${toDeviceName} ${toPortName}`,
    from: `${fromDeviceName} / ${fromPortName}`,
    to: `${toDeviceName} / ${toPortName}`,
    cable: cableDevice?.device_name || cableDevice?.device_id || null,
    route: route?.route_name || route?.route_code || route?.route_id || null,
    core_range:
      connection.core_start && connection.core_end
        ? `${connection.core_start}-${connection.core_end}`
        : null,
  };
}

async function enrichPortConnections(connections) {
  if (!connections.length) return [];

  const portIds = Array.from(
    new Set(connections.flatMap((item) => [item.from_port_id, item.to_port_id]).filter(Boolean)),
  );
  const ports = await loadPortsByIds(portIds);
  const portMap = new Map(ports.map((port) => [port.id, port]));

  const deviceIds = Array.from(
    new Set(
      [
        ...ports.map((port) => port.device_id),
        ...connections.map((item) => item.cable_device_id),
      ].filter(Boolean),
    ),
  );
  const devices = await loadDevicesByIds(deviceIds);
  const deviceMap = new Map(devices.map((device) => [device.id, device]));

  const routeIds = Array.from(new Set(connections.map((item) => item.route_id).filter(Boolean)));
  const routes = await loadRoutesByIds(routeIds);
  const routeMap = new Map(routes.map((route) => [route.id, route]));

  return connections.map((connection) => {
    const rawFromPort = portMap.get(connection.from_port_id) || null;
    const rawToPort = portMap.get(connection.to_port_id) || null;
    const fromPort = rawFromPort
      ? { ...rawFromPort, device: deviceMap.get(rawFromPort.device_id) || null }
      : null;
    const toPort = rawToPort
      ? { ...rawToPort, device: deviceMap.get(rawToPort.device_id) || null }
      : null;
    const cableDevice = connection.cable_device_id ? deviceMap.get(connection.cable_device_id) || null : null;
    const route = connection.route_id ? routeMap.get(connection.route_id) || null : null;

    return {
      ...connection,
      from_port: fromPort,
      to_port: toPort,
      from_device: fromPort?.device || null,
      to_device: toPort?.device || null,
      cable_device: cableDevice,
      route,
      labels: buildPortConnectionLabel(connection, fromPort, toPort, cableDevice, route),
    };
  });
}

async function enrichCoreManagementRows(rows) {
  if (!rows.length) return [];

  const deviceIds = Array.from(
    new Set(
      rows
        .flatMap((item) => [item.cable_device_id, item.from_device_id, item.to_device_id])
        .filter(Boolean),
    ),
  );
  const devices = await loadDevicesByIds(deviceIds);
  const deviceMap = new Map(devices.map((device) => [device.id, device]));

  const routeIds = Array.from(new Set(rows.map((item) => item.route_id).filter(Boolean)));
  const routes = await loadRoutesByIds(routeIds);
  const routeMap = new Map(routes.map((route) => [route.id, route]));

  return rows.map((item) => {
    const cableDevice = item.cable_device_id ? deviceMap.get(item.cable_device_id) || null : null;
    const fromDevice = item.from_device_id ? deviceMap.get(item.from_device_id) || null : null;
    const toDevice = item.to_device_id ? deviceMap.get(item.to_device_id) || null : null;
    const route = item.route_id ? routeMap.get(item.route_id) || null : null;
    const coreRange = item.core_no_start && item.core_no_end
      ? `${item.core_no_start}-${item.core_no_end}`
      : null;

    return {
      ...item,
      cable_device: cableDevice,
      from_device: fromDevice,
      to_device: toDevice,
      route,
      labels: {
        title: [
          cableDevice?.device_name || cableDevice?.device_id || 'Cable',
          coreRange ? `Core ${coreRange}` : null,
        ].filter(Boolean).join(' / '),
        cable: cableDevice?.device_name || cableDevice?.device_id || null,
        from: fromDevice?.device_name || fromDevice?.device_id || null,
        to: toDevice?.device_name || toDevice?.device_id || null,
        route: route?.route_name || route?.route_code || route?.route_id || null,
        core_range: coreRange,
      },
    };
  });
}

function buildPortSummary(ports) {
  const activePorts = ports.filter((port) => port.is_active !== false && !port.deleted_at);
  const statusCounts = countBy(activePorts, 'status');
  return {
    total: ports.length,
    active: activePorts.length,
    inactive_or_deleted: ports.length - activePorts.length,
    by_status: statusCounts,
    assigned_customers: activePorts.filter((port) => port.customer_id).length,
    assigned_onts: activePorts.filter((port) => port.ont_device_id).length,
    used_capacity: sumNumber(activePorts, 'core_used'),
    total_capacity: sumNumber(activePorts, 'core_capacity'),
  };
}

function buildConnectionSummary(connections) {
  return {
    total: connections.length,
    by_status: countBy(connections, 'status'),
    by_type: countBy(connections, 'connection_type'),
    with_cable: connections.filter((item) => item.cable_device_id).length,
    with_core_range: connections.filter((item) => item.core_start != null && item.core_end != null).length,
  };
}

function buildDeviceRef(device) {
  if (!device) return null;
  return {
    id: device.id,
    device_id: device.device_id,
    device_name: device.device_name,
    device_type_key: device.device_type_key,
    region_id: device.region_id,
    pop_id: device.pop_id,
    status: device.status,
  };
}

function buildPortRef(port) {
  if (!port) return null;
  return {
    id: port.id,
    port_id: port.port_id,
    device_id: port.device_id,
    port_index: port.port_index,
    port_label: port.port_label,
    port_type: port.port_type,
    direction: port.direction,
    status: port.status,
  };
}

function buildCableRef(device) {
  if (!device) return null;
  return {
    id: device.id,
    device_id: device.device_id,
    device_name: device.device_name,
    device_type_key: device.device_type_key,
    status: device.status,
  };
}

function buildRouteRef(route) {
  if (!route) return null;
  return {
    id: route.id,
    route_id: route.route_id,
    route_code: route.route_code,
    route_name: route.route_name,
    route_type: route.route_type,
    status: route.status,
  };
}

function buildOdcConnectionItem(connection, direction, odcPort, peerPort, peerDevice) {
  const hasCoreRange = connection.core_start != null && connection.core_end != null;
  return {
    id: connection.id,
    connection_id: connection.connection_id,
    direction,
    status: connection.status,
    connection_type: connection.connection_type,
    odc_port: buildPortRef(odcPort),
    peer_port: buildPortRef(peerPort),
    peer_device: buildDeviceRef(peerDevice),
    cable_device: buildCableRef(connection.cable_device),
    route: buildRouteRef(connection.route),
    core_start: connection.core_start,
    core_end: connection.core_end,
    fiber_count: connection.fiber_count,
    labels: {
      title: connection.labels?.title || null,
      peer: peerDevice?.device_name || peerDevice?.device_id || null,
      odc_port: odcPort?.port_label || odcPort?.port_id || null,
      peer_port: peerPort?.port_label || peerPort?.port_id || null,
      cable: connection.labels?.cable || null,
      route: connection.labels?.route || null,
      core_range: hasCoreRange ? `${connection.core_start}-${connection.core_end}` : null,
    },
  };
}

function summarizeOdcBucket(items) {
  return {
    total: items.length,
    by_status: countBy(items, 'status'),
    with_cable: items.filter((item) => item.cable_device).length,
    with_core_range: items.filter((item) => item.core_start != null && item.core_end != null).length,
  };
}

async function buildOdcRelationSummary(device, ports, enrichedConnections) {
  const typeKey = String(device?.device_type_key || '').toUpperCase();
  if (typeKey !== 'ODC') return null;

  const odcPortIds = new Set(ports.map((port) => port.id).filter(Boolean));
  const upstream = [];
  const downstream = [];

  enrichedConnections.forEach((connection) => {
    const fromPortIsOdc = odcPortIds.has(connection.from_port_id);
    const toPortIsOdc = odcPortIds.has(connection.to_port_id);

    if (toPortIsOdc) {
      upstream.push(buildOdcConnectionItem(
        connection,
        'upstream',
        connection.to_port,
        connection.from_port,
        connection.from_device,
      ));
    }

    if (fromPortIsOdc) {
      downstream.push(buildOdcConnectionItem(
        connection,
        'downstream',
        connection.from_port,
        connection.to_port,
        connection.to_device,
      ));
    }
  });

  // Collect cable references from upstream/downstream ODC connections
  const cableUsage = [...upstream, ...downstream].filter((item) => item.cable_device);
  // Count unique downstream ODP devices and their customer assignments
  let downstreamOdpCount = 0;
  let affectedCustomerCount = 0;
  const odpDeviceIds = Array.from(
    new Set(
      downstream
        .filter((item) => String(item.peer_device?.device_type_key || "").toUpperCase() === "ODP")
        .map((item) => item.peer_device?.id)
        .filter(Boolean),
    ),
  );
  if (odpDeviceIds.length > 0) {
    const odpPorts = await loadPortsByDeviceIds(odpDeviceIds);
    downstreamOdpCount = odpDeviceIds.length;
    affectedCustomerCount = odpPorts.filter((port) => port.is_active !== false && !port.deleted_at && port.customer_id).length;
  }

  return {
    device_type_key: typeKey,
    splitter_ratio: device?.splitter_ratio || null,
    summary: {
      upstream: summarizeOdcBucket(upstream),
      downstream: summarizeOdcBucket(downstream),
      cable_usage: summarizeOdcBucket(cableUsage),
      has_upstream: upstream.length > 0,
      has_downstream: downstream.length > 0,
      has_trace_ready_relation: upstream.length > 0 && downstream.length > 0,
    },
    upstream,
    downstream,
    cable_usage: cableUsage,
    readiness: {
      has_upstream_source: upstream.length > 0,
      has_downstream_odp: downstream.some((item) => String(item.peer_device?.device_type_key || '').toUpperCase() === 'ODP'),
      has_cable_context: [...upstream, ...downstream].some((item) => item.cable_device),
      has_core_mapping: [...upstream, ...downstream].some((item) => item.core_start != null && item.core_end != null),
    },
  };
}

function buildFiberCoreSummary(fiberCores) {
  return {
    total: fiberCores.length,
    by_status: countBy(fiberCores, 'status'),
    by_tube_color: fiberCores.reduce((acc, item) => {
      if (!item.tube_color_name) return acc;
      acc[item.tube_color_name] = (acc[item.tube_color_name] || 0) + 1;
      return acc;
    }, {}),
    by_core_color: fiberCores.reduce((acc, item) => {
      if (!item.color_name) return acc;
      acc[item.color_name] = (acc[item.color_name] || 0) + 1;
      return acc;
    }, {}),
    loss_warnings: fiberCores.filter((item) => Number(item.last_loss_db) > 0.2).length,
    damaged: fiberCores.filter((item) => String(item.status || '').toLowerCase() === 'damaged').length,
  };
}

function buildCoreManagementSummary(rows) {
  return {
    total: rows.length,
    by_status: countBy(rows, 'status'),
    core_count: sumNumber(rows, 'core_count'),
    used_count: sumNumber(rows, 'used_count'),
    reserved_count: sumNumber(rows, 'reserved_count'),
  };
}

async function submitDevicePortAssignmentRequest({ req, port, changes, operation, context }) {
  const payloadSnapshot = {
    source: 'adminregion-update-resource',
    operation: 'update',
    resource_name: 'devicePorts',
    resource_label: 'Device Port',
    devicePort: {
      ...port,
      ...changes,
    },
    before: port,
    resource_payload: changes,
    context,
  };

  const approvalRequest = await createValidationRequest({
    entityType: 'devicePort',
    entityId: port.id,
    regionId: port.region_id,
    submittedByUserId: req.auth.appUser.id,
    currentStatus: VALIDATION_STATUS.PENDING_ASYNC,
    payloadSnapshot,
    checklist: {},
    findingNote: `${operation} port assignment request by adminregion.`,
  });

  await insertValidationRequestLog({
    requestId: approvalRequest.id,
    actionType: VALIDATION_ACTION.RESUBMIT_ADMINREGION,
    actorUserId: req.auth.appUser.id,
    actorRole: 'adminregion',
    beforeStatus: VALIDATION_STATUS.UNVALIDATED,
    afterStatus: VALIDATION_STATUS.PENDING_ASYNC,
    note: `${operation} port assignment request submitted to superadmin.`,
    payloadPatch: payloadSnapshot,
  });

  await createAuditLog({
    actorUserId: req.auth.appUser.id,
    actionName: `port_assignment_${operation}_request_submitted_by_adminregion`,
    entityType: 'validation_requests',
    entityId: approvalRequest.id,
    beforeData: {
      port_id: port.id,
      status: port.status,
      customer_id: port.customer_id,
      ont_device_id: port.ont_device_id,
    },
    afterData: {
      request_id: approvalRequest.request_id,
      status: VALIDATION_STATUS.PENDING_ASYNC,
      port_id: port.id,
      device_id: port.device_id,
      ...changes,
      context,
    },
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });

  return approvalRequest;
}

async function loadPortById(portId) {
  const query = `
    query LoadPortById($id: uuid!) {
      item: device_ports_by_pk(id: $id) {
        id
        port_id
        region_id
        device_id
        port_index
        port_label
        port_type
        direction
        status
        customer_id
        ont_device_id
        occupied_at
        notes
        deleted_at
      }
    }
  `;
  const data = await executeHasura(query, { id: portId });
  return data.item || null;
}

async function loadCustomerById(customerId) {
  if (!customerId) return null;
  const query = `
    query LoadCustomerById($id: uuid!) {
      item: customers_by_pk(id: $id) {
        id
        customer_id
        customer_number
        customer_name
        region_id
        pop_id
        project_id
        status
      }
    }
  `;
  const data = await executeHasura(query, { id: customerId });
  return data.item || null;
}

async function loadCustomersByIds(customerIds) {
  if (!customerIds.length) return [];
  const query = `
    query LoadCustomersByIds($ids: [uuid!]!) {
      items: customers(where: { id: { _in: $ids } }) {
        id
        customer_id
        customer_number
        customer_name
        region_id
        pop_id
        project_id
        status
      }
    }
  `;
  const data = await executeHasura(query, { ids: customerIds });
  return data.items || [];
}

async function loadActivePortByCustomerId(customerId) {
  if (!customerId) return null;
  const query = `
    query LoadActivePortByCustomerId($customerId: uuid!) {
      items: device_ports(
        where: {
          customer_id: { _eq: $customerId }
          deleted_at: { _is_null: true }
          _or: [
            { status: { _neq: "idle" } }
            { status: { _is_null: true } }
          ]
        }
        order_by: [{ occupied_at: desc_nulls_last }, { updated_at: desc }]
        limit: 1
      ) {
        id
        port_id
        region_id
        device_id
        port_index
        port_label
        port_type
        direction
        status
        customer_id
        ont_device_id
        occupied_at
        notes
        deleted_at
      }
    }
  `;
  const data = await executeHasura(query, { customerId });
  return data.items?.[0] || null;
}

async function resolveTraceEndpoint({ deviceId, portId, customerId, label }) {
  if (deviceId) {
    const device = await loadDeviceById(deviceId);
    if (!device) throw createHttpError(404, `${label} device not found`);
    return {
      type: 'device',
      device,
      port: null,
      customer: null,
      warnings: [],
    };
  }

  if (portId) {
    const port = await loadPortById(portId);
    if (!port) throw createHttpError(404, `${label} port not found`);
    if (port.deleted_at) throw createHttpError(400, `${label} port is deleted`);
    const device = await loadDeviceById(port.device_id);
    if (!device) throw createHttpError(404, `${label} port device not found`);
    return {
      type: 'port',
      device,
      port,
      customer: null,
      warnings: [],
    };
  }

  if (customerId) {
    const customer = await loadCustomerById(customerId);
    if (!customer) throw createHttpError(404, `${label} customer not found`);
    const port = await loadActivePortByCustomerId(customerId);
    if (!port) {
      return {
        type: 'customer',
        device: null,
        port: null,
        customer,
        warnings: ['Customer has no active port assignment'],
      };
    }
    const device = await loadDeviceById(port.device_id);
    if (!device) throw createHttpError(404, `${label} customer port device not found`);
    return {
      type: 'customer',
      device,
      port,
      customer,
      warnings: [],
    };
  }

  return null;
}

async function findActivePortAssignmentByField(fieldName, value, excludePortId = null) {
  if (!value) return null;
  const where = {
    deleted_at: { _is_null: true },
    [fieldName]: { _eq: value },
    _or: [
      { status: { _neq: 'idle' } },
      { status: { _is_null: true } },
    ],
  };
  if (excludePortId) {
    where.id = { _neq: excludePortId };
  }

  const query = `
    query FindActivePortAssignment($where: device_ports_bool_exp!) {
      items: device_ports(where: $where, limit: 1) {
        id
        port_id
        device_id
        port_index
        port_label
        status
        customer_id
        ont_device_id
      }
    }
  `;
  const data = await executeHasura(query, { where });
  return data.items?.[0] || null;
}

async function updateDevicePortAssignmentById(portId, changes) {
  const query = `
    mutation UpdateDevicePortAssignment($id: uuid!, $changes: device_ports_set_input!) {
      item: update_device_ports_by_pk(pk_columns: { id: $id }, _set: $changes) {
        id
        port_id
        region_id
        device_id
        port_index
        port_label
        port_type
        direction
        status
        customer_id
        ont_device_id
        occupied_at
        notes
        deleted_at
        updated_at
      }
    }
  `;
  const data = await executeHasura(query, { id: portId, changes });
  return data.item || null;
}

async function loadConnectionByPortPair(portA, portB) {
  const query = `
    query LoadConnectionByPortPair($portA: uuid!, $portB: uuid!) {
      items: port_connections(
        where: {
          _or: [
            { _and: [{ from_port_id: { _eq: $portA } }, { to_port_id: { _eq: $portB } }] }
            { _and: [{ from_port_id: { _eq: $portB } }, { to_port_id: { _eq: $portA } }] }
          ]
        }
        limit: 1
      ) {
        id
        connection_id
        from_port_id
        to_port_id
        status
      }
    }
  `;
  const data = await executeHasura(query, { portA, portB });
  return data.items?.[0] || null;
}

async function loadFiberCoresByConnectionIds(connectionIds) {
  if (!connectionIds.length) return [];
  const query = `
    query LoadFiberCoresByConnectionIds($ids: [uuid!]!) {
      items: fiber_cores(where: { connection_id: { _in: $ids } }) {
        id
        connection_id
        status
        core_no
        tube_no
        tube_color_name
        tube_color_hex
        color_name
        color_hex
        color_standard
        cores_per_tube
        last_loss_db
      }
    }
  `;
  const data = await executeHasura(query, { ids: connectionIds });
  return data.items || [];
}

async function loadPortsByDeviceIds(deviceIds) {
  if (!deviceIds.length) return [];
  const query = `
    query LoadPortsByDeviceIds($deviceIds: [uuid!]!) {
      items: device_ports(
        where: { device_id: { _in: $deviceIds } }
        order_by: [{ device_id: asc }, { port_index: asc }]
      ) {
        id
        device_id
        region_id
        port_index
        port_label
        port_id
        port_type
        direction
        status
        speed_profile
        core_capacity
        core_used
        splitter_ratio
        customer_id
        ont_device_id
        occupied_at
        is_active
        deleted_at
        notes
      }
    }
  `;
  const data = await executeHasura(query, { deviceIds });
  return data.items || [];
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    const value = String(item?.[key] || 'unknown').toLowerCase();
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function sumNumber(items, key) {
  return items.reduce((total, item) => {
    const value = Number(item?.[key]);
    return Number.isFinite(value) ? total + value : total;
  }, 0);
}

function parseMapLimit(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function toNumberOrNull(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasGeoCoordinates(item) {
  return toNumberOrNull(item?.longitude) != null && toNumberOrNull(item?.latitude) != null;
}

function hasRouteGeometry(route) {
  const geometry = route?.path_geojson;
  if (!geometry || typeof geometry !== 'object') return false;
  if (Array.isArray(geometry)) return geometry.length > 0;
  return Object.keys(geometry).length > 0;
}

function buildMapScopeWhere({ allowedRegionIds = [], requestedRegionId = null, projectId = null, popId = null }) {
  const filters = [];
  if (requestedRegionId) {
    filters.push({ region_id: { _eq: requestedRegionId } });
  } else if (allowedRegionIds.length) {
    filters.push({ region_id: { _in: allowedRegionIds } });
  }
  if (projectId) filters.push({ project_id: { _eq: projectId } });
  if (popId) filters.push({ pop_id: { _eq: popId } });
  return filters;
}

async function loadMapDevices({
  allowedRegionIds = [],
  requestedRegionId = null,
  projectId = null,
  popId = null,
  deviceTypeKey = null,
  tenantId = null,
  limit = 1000,
}) {
  const filters = [
    { deleted_at: { _is_null: true } },
    ...buildMapScopeWhere({ allowedRegionIds, requestedRegionId, projectId, popId }),
  ];
  if (deviceTypeKey) filters.push({ device_type_key: { _eq: deviceTypeKey } });
  if (tenantId) filters.push({ tenant_id: { _eq: tenantId } });

  const query = `
    query LoadMapDevices($where: devices_bool_exp!, $limit: Int!) {
      items: devices(where: $where, limit: $limit, order_by: [{ device_type_key: asc }, { device_name: asc }]) {
        id
        device_id
        device_name
        device_type_key
        status
        validation_status
        longitude
        latitude
        region_id
        pop_id
        project_id
        tenant_id
        total_ports
        used_ports
        capacity_core
        used_core
        updated_at
      }
    }
  `;
  const data = await executeHasura(query, { where: { _and: filters }, limit });
  return data.items || [];
}

async function loadMapRoutes({
  allowedRegionIds = [],
  requestedRegionId = null,
  projectId = null,
  popId = null,
  limit = 500,
}) {
  const filters = [
    ...buildMapScopeWhere({ allowedRegionIds, requestedRegionId, projectId, popId }),
    {
      _or: [
        { status: { _neq: 'inactive' } },
        { status: { _is_null: true } },
      ],
    },
  ];

  const query = `
    query LoadMapRoutes($where: network_routes_bool_exp!, $limit: Int!) {
      items: network_routes(where: $where, limit: $limit, order_by: [{ updated_at: desc }]) {
        id
        route_id
        route_code
        route_name
        route_type
        status
        region_id
        pop_id
        project_id
        start_asset_id
        end_asset_id
        distance_meters
        path_geojson
        updated_at
      }
    }
  `;
  const data = await executeHasura(query, { where: filters.length ? { _and: filters } : {}, limit });
  return data.items || [];
}

async function loadMapPortConnections({
  allowedRegionIds = [],
  requestedRegionId = null,
  limit = 1000,
}) {
  const filters = [
    {
      _or: [
        { status: { _neq: 'inactive' } },
        { status: { _is_null: true } },
      ],
    },
    ...buildMapScopeWhere({ allowedRegionIds, requestedRegionId }),
  ];
  const query = `
    query LoadMapPortConnections($where: port_connections_bool_exp!, $limit: Int!) {
      items: port_connections(where: $where, limit: $limit, order_by: [{ updated_at: desc }]) {
        id
        connection_id
        region_id
        from_port_id
        to_port_id
        connection_type
        status
        route_id
        cable_device_id
        core_start
        core_end
        fiber_count
        installed_at
        updated_at
      }
    }
  `;
  const data = await executeHasura(query, { where: { _and: filters }, limit });
  return data.items || [];
}

function buildMapDeviceItem(device) {
  const totalPorts = Number(device.total_ports);
  const usedPorts = Number(device.used_ports);
  const portOccupancy = Number.isFinite(totalPorts) && totalPorts > 0 && Number.isFinite(usedPorts)
    ? Math.round((usedPorts / totalPorts) * 1000) / 10
    : null;
  const totalCores = Number(device.capacity_core);
  const usedCores = Number(device.used_core);
  const coreOccupancy = Number.isFinite(totalCores) && totalCores > 0 && Number.isFinite(usedCores)
    ? Math.round((usedCores / totalCores) * 1000) / 10
    : null;
  const validationStatus = String(device.validation_status || 'unvalidated').toLowerCase();
  const deviceStatus = String(device.status || 'unknown').toLowerCase();
  const markerStatus = validationStatus === 'invalid' || deviceStatus === 'inactive'
    ? 'critical'
    : validationStatus === 'warning'
      ? 'warning'
      : validationStatus === 'valid'
        ? 'healthy'
        : 'unvalidated';

  return {
    id: device.id,
    device_id: device.device_id,
    device_name: device.device_name,
    device_type_key: device.device_type_key,
    status: device.status,
    validation_status: device.validation_status,
    region_id: device.region_id,
    pop_id: device.pop_id,
    project_id: device.project_id,
    tenant_id: device.tenant_id,
    longitude: toNumberOrNull(device.longitude),
    latitude: toNumberOrNull(device.latitude),
    has_coordinates: hasGeoCoordinates(device),
    marker_status: markerStatus,
    occupancy: {
      total_ports: Number.isFinite(totalPorts) ? totalPorts : null,
      used_ports: Number.isFinite(usedPorts) ? usedPorts : null,
      port_percent: portOccupancy,
      capacity_core: Number.isFinite(totalCores) ? totalCores : null,
      used_core: Number.isFinite(usedCores) ? usedCores : null,
      core_percent: coreOccupancy,
    },
    updated_at: device.updated_at,
  };
}

function buildMapRouteItem(route, deviceMap) {
  const startDevice = deviceMap.get(route.start_asset_id) || null;
  const endDevice = deviceMap.get(route.end_asset_id) || null;
  return {
    id: route.id,
    route_id: route.route_id,
    route_code: route.route_code,
    route_name: route.route_name,
    route_type: route.route_type,
    status: route.status,
    region_id: route.region_id,
    pop_id: route.pop_id,
    project_id: route.project_id,
    start_asset_id: route.start_asset_id,
    end_asset_id: route.end_asset_id,
    start_device: startDevice ? buildMapDeviceItem(startDevice) : null,
    end_device: endDevice ? buildMapDeviceItem(endDevice) : null,
    distance_meters: toNumberOrNull(route.distance_meters),
    path_geojson: route.path_geojson || null,
    has_geometry: hasRouteGeometry(route),
    updated_at: route.updated_at,
  };
}

function buildMapConnectionItem(connection, portMap, deviceMap, routeMap, cableDeviceMap) {
  const fromPort = portMap.get(connection.from_port_id) || null;
  const toPort = portMap.get(connection.to_port_id) || null;
  const fromDevice = fromPort ? deviceMap.get(fromPort.device_id) || null : null;
  const toDevice = toPort ? deviceMap.get(toPort.device_id) || null : null;
  const route = routeMap.get(connection.route_id) || null;
  const cableDevice = cableDeviceMap.get(connection.cable_device_id) || null;
  const hasEndpointCoordinates = hasGeoCoordinates(fromDevice) && hasGeoCoordinates(toDevice);

  return {
    id: connection.id,
    connection_id: connection.connection_id,
    region_id: connection.region_id,
    connection_type: connection.connection_type,
    status: connection.status,
    route_id: connection.route_id,
    cable_device_id: connection.cable_device_id,
    core_start: connection.core_start,
    core_end: connection.core_end,
    fiber_count: connection.fiber_count,
    installed_at: connection.installed_at,
    from_port: fromPort,
    to_port: toPort,
    from_device: fromDevice ? buildMapDeviceItem(fromDevice) : null,
    to_device: toDevice ? buildMapDeviceItem(toDevice) : null,
    cable_device: cableDevice ? buildMapDeviceItem(cableDevice) : null,
    route: route ? buildMapRouteItem(route, deviceMap) : null,
    has_geometry_context: Boolean(route && hasRouteGeometry(route)) || hasEndpointCoordinates,
    updated_at: connection.updated_at,
  };
}

async function buildFiberCutImpactLayer({ connections, deviceMap, cutConnectionId, cutCableDeviceId }) {
  if (!cutConnectionId && !cutCableDeviceId) {
    return {
      active: false,
      source: 'approved_inventory_simulation',
      selector: null,
      summary: {
        cut_connections: 0,
        affected_devices: 0,
        affected_connections: 0,
        affected_routes: 0,
        affected_customers: 0,
        affected_onts: 0,
      },
      cut_connections: [],
      devices: [],
      connections: [],
      routes: [],
      customer_assignments: [],
      customers: [],
      onts: [],
      warnings: [],
    };
  }

  const cutConnections = connections.filter((connection) => {
    if (cutConnectionId) {
      return connection.id === cutConnectionId || connection.connection_id === cutConnectionId;
    }
    return connection.cable_device_id === cutCableDeviceId
      || connection.cable_device?.device_id === cutCableDeviceId;
  });

  if (!cutConnections.length) {
    return {
      active: true,
      source: 'approved_inventory_simulation',
      selector: cutConnectionId
        ? { type: 'connection', value: cutConnectionId }
        : { type: 'cable', value: cutCableDeviceId },
      summary: {
        cut_connections: 0,
        affected_devices: 0,
        affected_connections: 0,
        affected_routes: 0,
        affected_customers: 0,
        affected_onts: 0,
      },
      cut_connections: [],
      devices: [],
      connections: [],
      routes: [],
      customer_assignments: [],
      customers: [],
      onts: [],
      warnings: ['No approved connection matches the requested fiber-cut selector in this map scope'],
    };
  }

  const cutConnectionIds = new Set(cutConnections.map((connection) => connection.id));
  const downstreamAdjacency = new Map();
  connections.forEach((connection) => {
    const fromDeviceId = connection.from_device?.id;
    const toDeviceId = connection.to_device?.id;
    if (!fromDeviceId || !toDeviceId || cutConnectionIds.has(connection.id)) return;
    if (!downstreamAdjacency.has(fromDeviceId)) downstreamAdjacency.set(fromDeviceId, []);
    downstreamAdjacency.get(fromDeviceId).push({ deviceId: toDeviceId, connection });
  });

  const affectedDeviceIds = new Set(cutConnections.map((connection) => connection.to_device?.id).filter(Boolean));
  const affectedConnectionIds = new Set(cutConnectionIds);
  const queue = Array.from(affectedDeviceIds);
  while (queue.length) {
    const currentDeviceId = queue.shift();
    const downstream = downstreamAdjacency.get(currentDeviceId) || [];
    downstream.forEach(({ deviceId, connection }) => {
      affectedConnectionIds.add(connection.id);
      if (affectedDeviceIds.has(deviceId)) return;
      affectedDeviceIds.add(deviceId);
      queue.push(deviceId);
    });
  }

  const affectedConnections = connections.filter((connection) => affectedConnectionIds.has(connection.id));
  const affectedDevices = Array.from(affectedDeviceIds)
    .map((deviceId) => deviceMap.get(deviceId))
    .filter(Boolean)
    .map(buildMapDeviceItem);
  const affectedRoutes = Array.from(new Map(
    affectedConnections
      .map((connection) => connection.route)
      .filter(Boolean)
      .map((route) => [route.id, route]),
  ).values());

  const affectedPorts = (await loadPortsByDeviceIds(Array.from(affectedDeviceIds)))
    .filter((port) => !port.deleted_at && port.is_active === true && (port.customer_id || port.ont_device_id));
  const customerIds = Array.from(new Set(affectedPorts.map((port) => port.customer_id).filter(Boolean)));
  const ontDeviceIds = Array.from(new Set(affectedPorts.map((port) => port.ont_device_id).filter(Boolean)));
  const [customers, missingOntDevices] = await Promise.all([
    loadCustomersByIds(customerIds),
    loadDevicesByIds(ontDeviceIds.filter((deviceId) => !deviceMap.has(deviceId))),
  ]);
  const ontDeviceMap = new Map([
    ...Array.from(deviceMap.entries()),
    ...missingOntDevices.map((device) => [device.id, device]),
  ]);
  const onts = ontDeviceIds.map((deviceId) => ontDeviceMap.get(deviceId)).filter(Boolean).map(buildMapDeviceItem);

  return {
    active: true,
    source: 'approved_inventory_simulation',
    selector: cutConnectionId
      ? { type: 'connection', value: cutConnectionId }
      : { type: 'cable', value: cutCableDeviceId },
    summary: {
      cut_connections: cutConnections.length,
      affected_devices: affectedDevices.length,
      affected_connections: affectedConnections.length,
      affected_routes: affectedRoutes.length,
      affected_customers: customers.length,
      affected_onts: onts.length,
    },
    cut_connections: cutConnections,
    devices: affectedDevices,
    connections: affectedConnections,
    routes: affectedRoutes,
    customer_assignments: affectedPorts.map((port) => ({
      port_id: port.id,
      port_inventory_id: port.port_id,
      device_id: port.device_id,
      port_index: port.port_index,
      port_label: port.port_label,
      customer_id: port.customer_id,
      ont_device_id: port.ont_device_id,
    })),
    customers,
    onts,
    warnings: affectedDevices.length
      ? []
      : ['The selected cut connection has no downstream device in the approved topology'],
  };
}

async function loadPortsByRegion({ allowedRegionIds = [], requestedRegionId = null }) {
  const regionFilters = [];
  if (requestedRegionId) {
    regionFilters.push({ region_id: { _eq: requestedRegionId } });
  } else if (allowedRegionIds.length) {
    regionFilters.push({ region_id: { _in: allowedRegionIds } });
  }
  const where = regionFilters.length ? { _and: [...regionFilters] } : {};
  const query = `
    query LoadPortsByRegion($where: device_ports_bool_exp!) {
      items: device_ports(where: $where, order_by: [{ device_id: asc }, { port_index: asc }]) {
        id
        device_id
        region_id
        port_index
        port_label
        port_type
        status
        core_capacity
        core_used
        is_active
      }
    }
  `;
  const data = await executeHasura(query, { where });
  return data.items || [];
}

async function loadFiberCoresByRegion({ allowedRegionIds = [], requestedRegionId = null }) {
  const regionFilters = [];
  if (requestedRegionId) {
    regionFilters.push({ region_id: { _eq: requestedRegionId } });
  } else if (allowedRegionIds.length) {
    regionFilters.push({ region_id: { _in: allowedRegionIds } });
  }
  const where = regionFilters.length ? { _and: [...regionFilters] } : {};
  const query = `
    query LoadFiberCoresByRegion($where: fiber_cores_bool_exp!) {
      items: fiber_cores(where: $where) {
        id
        region_id
        cable_device_id
        tray_no
        tube_no
        tube_color_name
        tube_color_hex
        core_no
        status
        connection_id
        from_port_id
        to_port_id
        color_name
        color_hex
        color_standard
        cores_per_tube
        last_loss_db
        last_loss_measured_at
        last_loss_method
        health_notes
      }
    }
  `;
  const data = await executeHasura(query, { where });
  return data.items || [];
}

async function loadDeviceLinksByRegion({ allowedRegionIds = [], requestedRegionId = null, limit = 2000 }) {
  const regionFilters = [];
  if (requestedRegionId) {
    regionFilters.push({ region_id: { _eq: requestedRegionId } });
  } else if (allowedRegionIds.length) {
    regionFilters.push({ region_id: { _in: allowedRegionIds } });
  }
  const where = {
    _and: [
      {
        _or: [
          { status: { _neq: 'inactive' } },
          { status: { _is_null: true } },
        ],
      },
      ...regionFilters,
    ],
  };
  const query = `
    query LoadDeviceLinksByRegion($where: device_links_bool_exp!, $limit: Int!) {
      items: device_links(where: $where, limit: $limit, order_by: [{ created_at: desc }]) {
        id
        region_id
        from_device_id
        to_device_id
        link_type
        route_id
        cable_device_id
        core_start
        core_end
        fiber_count
        status
        notes
        created_at
      }
    }
  `;
  const data = await executeHasura(query, { where, limit });
  return data.items || [];
}

async function loadDeviceLinkTransitionMapByLinkIds(linkIds) {
  if (!linkIds.length) return [];
  const query = `
    query LoadDeviceLinkTransitionMapByLinkIds($linkIds: [uuid!]!) {
      items: device_link_transition_map(where: { link_id: { _in: $linkIds } }) {
        id
        link_id
        connection_id
        migrated_at
      }
    }
  `;
  const data = await executeHasura(query, { linkIds });
  return data.items || [];
}

function pickTransitionPort(portRows, preferredType = 'fiber') {
  if (!portRows.length) return null;
  const activeRows = portRows.filter((row) => row.is_active !== false);
  const rows = activeRows.length ? activeRows : portRows;
  const preferredRows = rows.filter((row) => row.port_type === preferredType);
  const base = preferredRows.length ? preferredRows : rows;
  const idle = base.find((row) => row.status === 'idle');
  if (idle) return idle;
  const reserved = base.find((row) => row.status === 'reserved');
  if (reserved) return reserved;
  return base[0];
}

function parseMigratedLinkIdFromNotes(notes) {
  if (!notes) return null;
  const match = String(notes).match(/\[migrated_from_device_link:([0-9a-f-]{36})\]/i);
  return match?.[1] || null;
}

function normalizeLegacyLinkTypeToConnectionType(linkType) {
  const value = String(linkType || '').toLowerCase();
  if (['fiber', 'patch', 'uplink', 'crossconnect', 'other'].includes(value)) return value;
  if (value === 'ethernet') return 'uplink';
  return 'other';
}

function detectCoreOverlapConflicts(connections) {
  const byCable = new Map();
  connections.forEach((conn) => {
    if (!conn.cable_device_id) return;
    if (conn.core_start == null || conn.core_end == null) return;
    if (!byCable.has(conn.cable_device_id)) byCable.set(conn.cable_device_id, []);
    byCable.get(conn.cable_device_id).push(conn);
  });

  const conflicts = [];
  byCable.forEach((items, cableDeviceId) => {
    const sorted = items
      .slice()
      .sort((a, b) => Number(a.core_start || 0) - Number(b.core_start || 0));
    for (let i = 0; i < sorted.length; i += 1) {
      const current = sorted[i];
      for (let j = i + 1; j < sorted.length; j += 1) {
        const next = sorted[j];
        const currentStart = Number(current.core_start);
        const currentEnd = Number(current.core_end);
        const nextStart = Number(next.core_start);
        const nextEnd = Number(next.core_end);
        if (nextStart > currentEnd) break;
        if (Math.max(currentStart, nextStart) <= Math.min(currentEnd, nextEnd)) {
          conflicts.push({
            cable_device_id: cableDeviceId,
            first_connection_id: current.id,
            second_connection_id: next.id,
            first_range: `${currentStart}-${currentEnd}`,
            second_range: `${nextStart}-${nextEnd}`,
          });
        }
      }
    }
  });

  return conflicts;
}

function normalizeColorValue(value) {
  return String(value || '').trim().toLowerCase();
}

function detectFiberCoreColorMismatches(fiberCores) {
  return fiberCores.filter((core) => {
    if (!core.core_no) return false;
    if (!core.color_name || !core.color_hex || !core.tube_no || !core.tube_color_name || !core.tube_color_hex) {
      return false;
    }

    const expected = buildFiberCorePhysicalFields(core.core_no, { coresPerTube: core.cores_per_tube });
    return (
      Number(core.tube_no) !== Number(expected.tube_no)
      || normalizeColorValue(core.color_name) !== normalizeColorValue(expected.color_name)
      || normalizeColorValue(core.color_hex) !== normalizeColorValue(expected.color_hex)
      || normalizeColorValue(core.tube_color_name) !== normalizeColorValue(expected.tube_color_name)
      || normalizeColorValue(core.tube_color_hex) !== normalizeColorValue(expected.tube_color_hex)
    );
  });
}

function getConnectionCoreNumbers(connection) {
  const start = Number(connection.core_start);
  const end = Number(connection.core_end);
  if (!connection.cable_device_id || !Number.isInteger(start) || !Number.isInteger(end) || start <= 0 || end < start) {
    return [];
  }

  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function buildFiberCoreLookup(fiberCores) {
  return new Map(fiberCores.map((core) => [`${core.cable_device_id}:${core.core_no}`, core]));
}

function collectByDirection({ startId, adjacency, nodeMap, maxDepth }) {
  const queue = [{ id: startId, depth: 0 }];
  const seen = new Set([startId]);
  const byType = {};

  while (queue.length) {
    const current = queue.shift();
    if (current.depth >= maxDepth) continue;
    const neighbors = adjacency.get(current.id) || [];

    for (const nextId of neighbors) {
      if (seen.has(nextId)) continue;
      seen.add(nextId);

      const nextDepth = current.depth + 1;
      const node = nodeMap.get(nextId);
      if (node?.device_type_key) {
        if (!byType[node.device_type_key]) byType[node.device_type_key] = [];
        byType[node.device_type_key].push({
          id: node.id,
          device_id: node.device_id,
          device_name: node.device_name,
          depth: nextDepth,
        });
      }

      queue.push({ id: nextId, depth: nextDepth });
    }
  }

  return byType;
}

resourceRouter.get('/exports/pops.xlsx', authenticate, requireRole('admin', 'user_region', 'user_all_region'), async (req, res, next) => {
  try {
    const config = RESOURCE_CONFIG.pops;
    const where = buildWhereClause(config, req.query, req.auth);
    const limit = Math.min(Number(req.query.limit) || 5000, 10000);

    const data = await listResources(config, {
      where,
      limit,
      offset: 0,
      orderBy: [{ created_at: 'desc' }],
    });

    const rows = (data.items || []).map((item, index) => ({
      no: index + 1,
      pop_id: item.pop_id || '',
      pop_code: item.pop_code || '',
      pop_name: item.pop_name || '',
      region_id: item.region_id || '',
      status_pop: item.status_pop || '',
      validation_status: item.validation_status || '',
      validation_date: item.validation_date || '',
      pop_type: item.pop_type || '',
      longitude: item.longitude ?? '',
      latitude: item.latitude ?? '',
      address: item.address || '',
      city: item.city || '',
      province: item.province || '',
      created_at: item.created_at || '',
    }));

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'POPs');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `syntrix-pops-${timestamp}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    return res.status(200).send(buffer);
  } catch (error) {
    return next(error);
  }
});

function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

async function loadAttachmentById(id) {
  const identifier = String(id || '').trim();
  if (!identifier) return null;

  if (isUuidLike(identifier)) {
    const queryByPk = `
      query LoadAttachmentByPk($id: uuid!) {
        item: attachments_by_pk(id: $id) {
          id
          attachment_id
          storage_file_id
          original_name
          mime_type
          size_bytes
          metadata
          entity_type
          entity_id
          uploaded_by_user_id
          created_at
        }
      }
    `;
    const dataByPk = await executeHasura(queryByPk, { id: identifier });
    if (dataByPk.item) return dataByPk.item;

    const queryByStorageId = `
      query LoadAttachmentByStorageId($storageId: uuid!) {
        items: attachments(
          where: { storage_file_id: { _eq: $storageId } }
          limit: 1
        ) {
          id
          attachment_id
          storage_file_id
          original_name
          mime_type
          size_bytes
          metadata
          entity_type
          entity_id
          uploaded_by_user_id
          created_at
        }
      }
    `;
    const dataByStorageId = await executeHasura(queryByStorageId, { storageId: identifier });
    if (dataByStorageId.items?.[0]) return dataByStorageId.items[0];
  }

  const queryByAttachmentCode = `
    query LoadAttachmentByCode($attachmentCode: String!) {
      items: attachments(
        where: { attachment_id: { _eq: $attachmentCode } }
        limit: 1
      ) {
        id
        attachment_id
        storage_file_id
        original_name
        mime_type
        size_bytes
        metadata
        entity_type
        entity_id
        uploaded_by_user_id
        created_at
      }
    }
  `;
  const dataByCode = await executeHasura(queryByAttachmentCode, { attachmentCode: identifier });
  return dataByCode.items?.[0] || null;
}

function buildAttachmentStorageCandidates(attachment) {
  const candidates = [];
  const seen = new Set();
  const push = (value) => {
    const key = String(value || '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    candidates.push(key);
  };

  push(attachment?.storage_file_id);
  push(attachment?.metadata?.upload_response?.id);
  push(attachment?.metadata?.upload_response?.fileMetadata?.id);
  push(attachment?.metadata?.storage_file_id);
  return candidates;
}

async function fetchAttachmentFromStorage(attachment, token) {
  const candidates = buildAttachmentStorageCandidates(attachment);
  if (!candidates.length) {
    throw createHttpError(400, 'Attachment has no linked storage file');
  }

  async function requestFile(storageId, useAdminSecret = false) {
    const headers = useAdminSecret
      ? { 'x-hasura-admin-secret': env.hasuraAdminSecret }
      : { Authorization: `Bearer ${token}` };
    return nhostStorageClient.get(`/files/${storageId}`, {
      headers,
      responseType: 'arraybuffer',
      validateStatus: (status) => status < 500,
    });
  }

  let lastResponse = null;
  for (const storageId of candidates) {
    let response = await requestFile(storageId, false);
    if ([401, 403, 404].includes(response.status)) {
      // Fallback for cross-user/private files: backend already authorized access by attachment record.
      response = await requestFile(storageId, true);
    }
    if (response.status < 400) {
      return { response, resolvedStorageId: storageId };
    }
    lastResponse = response;
  }

  if (lastResponse?.status === 404) {
    throw createHttpError(404, 'Storage file not found (attachment exists but file missing in storage)');
  }
  throw createHttpError(lastResponse?.status || 502, 'Failed to fetch file from storage', lastResponse?.data);
}

function getAccountManagerScope(auth) {
  const role = normalizeRoleName(auth?.role);
  if (isSuperAdminRole(role)) {
    return { role, allowedRegions: [], isSuperAdmin: true };
  }

  if (role !== 'adminregion') {
    throw createHttpError(403, 'You do not have permission to manage accounts');
  }

  const allowedRegions = Array.from(new Set(auth?.regions || []));
  if (!allowedRegions.length) {
    throw createHttpError(403, 'This adminregion user does not have any assigned region');
  }

  return { role, allowedRegions, isSuperAdmin: false };
}

function buildManagedUsersWhere(req) {
  const scope = getAccountManagerScope(req.auth);
  const filters = [];

  if (!scope.isSuperAdmin) {
    filters.push({ role_name: { _eq: 'user_region' } });
    filters.push({ default_region_id: { _in: scope.allowedRegions } });
  }

  const role = String(req.query.role_name || '').trim();
  if (role && role !== '__all__') {
    if (!scope.isSuperAdmin && role !== 'user_region') {
      throw createHttpError(403, 'Adminregion can only view validator accounts');
    }
    filters.push({ role_name: { _eq: role } });
  }

  const regionId = String(req.query.default_region_id || req.query.region_id || '').trim();
  if (regionId && regionId !== '__all__') {
    if (regionId === '__none__') {
      if (!scope.isSuperAdmin) {
        throw createHttpError(403, 'Adminregion can only view accounts with assigned region');
      }
      filters.push({ default_region_id: { _is_null: true } });
    } else {
      if (!scope.isSuperAdmin && !scope.allowedRegions.includes(regionId)) {
        throw createHttpError(403, 'You do not have access to this region');
      }
      filters.push({ default_region_id: { _eq: regionId } });
    }
  }

  const isActive = String(req.query.is_active || '').trim();
  if (isActive === 'true' || isActive === 'false') {
    filters.push({ is_active: { _eq: isActive === 'true' } });
  }

  const keyword = String(req.query.q || req.query.search || '').trim();
  if (keyword) {
    filters.push({
      _or: [
        { full_name: { _ilike: `%${keyword}%` } },
        { email: { _ilike: `%${keyword}%` } },
        { user_code: { _ilike: `%${keyword}%` } },
      ],
    });
  }

  return filters.length ? { _and: filters } : {};
}

async function loadAuthVerificationMap(authUserIds) {
  const ids = Array.from(new Set((authUserIds || []).filter(Boolean)));
  if (!ids.length) return new Map();

  const query = `
    query LoadAuthVerification($ids: [uuid!]!) {
      users(where: { id: { _in: $ids } }) {
        id
        emailVerified
      }
    }
  `;
  const data = await executeHasura(query, { ids });
  return new Map((data.users || []).map((item) => [item.id, Boolean(item.emailVerified)]));
}

function enrichUsersWithVerification(users, verificationMap) {
  return (users || []).map((user) => {
    const emailVerified = verificationMap.get(user.auth_user_id) || false;
    return {
      ...user,
      email_verified: emailVerified,
      verification_status: emailVerified
        ? 'verified'
        : user.metadata?.pending_email_verification
        ? 'pending'
        : 'unverified',
    };
  });
}

async function listManagedUsers(req, res, next) {
  try {
    const { page, limit, offset } = getPagination(req.query);
    const where = buildManagedUsersWhere(req);

    const query = `
      query ListManagedUsers($where: app_users_bool_exp!, $limit: Int!, $offset: Int!) {
        items: app_users(
          where: $where
          order_by: [{ created_at: desc }]
          limit: $limit
          offset: $offset
        ) {
          id
          user_code
          auth_user_id
          full_name
          email
          role_name
          avatar_attachment_id
          is_active
          default_region_id
          metadata
          created_at
          updated_at
        }
        aggregate: app_users_aggregate(where: $where) {
          aggregate {
            count
          }
        }
      }
    `;
    const data = await executeHasura(query, { where, limit, offset });
    const verificationMap = await loadAuthVerificationMap((data.items || []).map((item) => item.auth_user_id));
    return sendSuccess(
      res,
      enrichUsersWithVerification(data.items || [], verificationMap),
      'Users fetched successfully',
      200,
      { page, limit, total: data.aggregate?.aggregate?.count || 0 },
    );
  } catch (error) {
    return next(error);
  }
}

async function loadManagedUserById(userId) {
  const query = `
    query LoadManagedUserById($id: uuid!) {
      item: app_users_by_pk(id: $id) {
        id
        user_code
        auth_user_id
        full_name
        email
        role_name
        avatar_attachment_id
        is_active
        default_region_id
        metadata
        created_at
        updated_at
      }
    }
  `;
  const data = await executeHasura(query, { id: userId });
  return data.item || null;
}

function assertCanManageUser(auth, user) {
  const scope = getAccountManagerScope(auth);
  if (scope.isSuperAdmin) {
    if (user.role_name === 'admin') {
      throw createHttpError(403, 'Superadmin accounts cannot be edited from Account Management');
    }
    return scope;
  }

  if (user.role_name !== 'user_region') {
    throw createHttpError(403, 'Adminregion can only manage validator accounts');
  }
  if (!user.default_region_id || !scope.allowedRegions.includes(user.default_region_id)) {
    throw createHttpError(403, 'You do not have access to this user region');
  }
  return scope;
}

function assertCanViewManagedUser(auth, user) {
  const scope = getAccountManagerScope(auth);
  if (scope.isSuperAdmin) return scope;
  if (user.role_name !== 'user_region') {
    throw createHttpError(403, 'Adminregion can only view validator accounts');
  }
  if (!user.default_region_id || !scope.allowedRegions.includes(user.default_region_id)) {
    throw createHttpError(403, 'You do not have access to this user region');
  }
  return scope;
}

async function getManagedUser(req, res, next) {
  try {
    const user = await loadManagedUserById(req.params.id);
    if (!user) throw createHttpError(404, 'User not found');
    assertCanViewManagedUser(req.auth, user);
    const verificationMap = await loadAuthVerificationMap([user.auth_user_id]);
    return sendSuccess(res, enrichUsersWithVerification([user], verificationMap)[0], 'User fetched successfully');
  } catch (error) {
    return next(error);
  }
}

function normalizeManagedUserPayload(auth, body, existingUser) {
  const scope = assertCanManageUser(auth, existingUser);
  const changes = {};

  if (body.full_name !== undefined) {
    const name = String(body.full_name || '').trim();
    if (!name) throw createHttpError(400, 'full_name cannot be empty');
    changes.full_name = name;
  }

  const requestedRole = body.role_name !== undefined ? String(body.role_name) : existingUser.role_name;
  if (!scope.isSuperAdmin && requestedRole !== 'user_region') {
    throw createHttpError(403, 'Adminregion can only assign validator role');
  }
  if (body.role_name !== undefined) {
    const normalizedRole = normalizeRoleName(requestedRole);
    changes.role_name =
      normalizedRole === 'adminregion'
        ? 'user_all_region'
        : normalizedRole === 'validator'
        ? 'user_region'
        : normalizedRole === 'superadmin'
        ? 'admin'
        : requestedRole;
    if (!['admin', 'user_all_region', 'user_region'].includes(changes.role_name)) {
      throw createHttpError(400, 'role_name must be admin/user_all_region/user_region');
    }
  }

  if (body.default_region_id !== undefined) {
    const nextRegionId = body.default_region_id || null;
    if (!scope.isSuperAdmin && (!nextRegionId || !scope.allowedRegions.includes(nextRegionId))) {
      throw createHttpError(403, 'Adminregion can only assign users to assigned regions');
    }
    changes.default_region_id = nextRegionId;
  }

  if (!scope.isSuperAdmin) {
    const nextRegionId = changes.default_region_id !== undefined ? changes.default_region_id : existingUser.default_region_id;
    if (!nextRegionId || !scope.allowedRegions.includes(nextRegionId)) {
      throw createHttpError(403, 'Validator account must stay inside assigned adminregion scope');
    }
  }

  if (body.is_active !== undefined) {
    changes.is_active = Boolean(body.is_active);
  }

  return { changes, scope };
}

async function syncUserRegionScopes(userId, regionId) {
  const deleteMutation = `
    mutation DeleteUserRegionScopes($userId: uuid!) {
      delete_user_region_scopes(where: { app_user_id: { _eq: $userId } }) {
        affected_rows
      }
    }
  `;
  await executeHasura(deleteMutation, { userId });

  if (!regionId) return [];

  const insertMutation = `
    mutation InsertUserRegionScope($object: user_region_scopes_insert_input!) {
      inserted: insert_user_region_scopes_one(object: $object) {
        id
        app_user_id
        region_id
      }
    }
  `;
  const data = await executeHasura(insertMutation, {
    object: {
      app_user_id: userId,
      region_id: regionId,
    },
  });
  return data.inserted ? [data.inserted] : [];
}

async function updateManagedUser(req, res, next) {
  try {
    const existingUser = await loadManagedUserById(req.params.id);
    if (!existingUser) throw createHttpError(404, 'User not found');

    const { changes } = normalizeManagedUserPayload(req.auth, req.body || {}, existingUser);
    if (!Object.keys(changes).length) {
      const verificationMap = await loadAuthVerificationMap([existingUser.auth_user_id]);
      return sendSuccess(res, enrichUsersWithVerification([existingUser], verificationMap)[0], 'No user changes submitted');
    }

    const mutation = `
      mutation UpdateManagedUser($id: uuid!, $changes: app_users_set_input!) {
        item: update_app_users_by_pk(pk_columns: { id: $id }, _set: $changes) {
          id
          user_code
          auth_user_id
          full_name
          email
          role_name
          avatar_attachment_id
          is_active
          default_region_id
          metadata
          created_at
          updated_at
        }
      }
    `;
    const data = await executeHasura(mutation, { id: existingUser.id, changes });
    const updatedUser = data.item;

    if (changes.default_region_id !== undefined || changes.role_name !== undefined) {
      const nextRegionId =
        updatedUser.role_name === 'user_region' || updatedUser.role_name === 'user_all_region'
          ? updatedUser.default_region_id
          : null;
      await syncUserRegionScopes(updatedUser.id, nextRegionId);
    }

    await createAuditLog({
      actorUserId: req.auth.appUser.id,
      actionName: 'account:user_update',
      entityType: 'app_user',
      entityId: existingUser.id,
      beforeData: existingUser,
      afterData: updatedUser,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    const verificationMap = await loadAuthVerificationMap([updatedUser.auth_user_id]);
    return sendSuccess(res, enrichUsersWithVerification([updatedUser], verificationMap)[0], 'User updated successfully');
  } catch (error) {
    return next(error);
  }
}

async function deleteManagedUser(req, res, next) {
  try {
    const existingUser = await loadManagedUserById(req.params.id);
    if (!existingUser) throw createHttpError(404, 'User not found');
    assertCanManageUser(req.auth, existingUser);

    if (existingUser.id === req.auth.appUser?.id) {
      throw createHttpError(400, 'You cannot delete your own account');
    }

    await syncUserRegionScopes(existingUser.id, null);

    const mutation = `
      mutation DeleteManagedUser($id: uuid!) {
        item: delete_app_users_by_pk(id: $id) {
          id
          user_code
          auth_user_id
          full_name
          email
          role_name
          default_region_id
          is_active
          metadata
        }
      }
    `;
    const data = await executeHasura(mutation, { id: existingUser.id });

    await createAuditLog({
      actorUserId: req.auth.appUser.id,
      actionName: 'account:user_delete',
      entityType: 'app_user',
      entityId: existingUser.id,
      beforeData: existingUser,
      afterData: null,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return sendSuccess(res, data.item, 'User deleted successfully');
  } catch (error) {
    return next(error);
  }
}

async function markVerificationEmailSent(userId, metadata = {}) {
  const sentAt = new Date().toISOString();
  const mutation = `
    mutation MarkVerificationEmailSent($id: uuid!, $metadata: jsonb!) {
      item: update_app_users_by_pk(
        pk_columns: { id: $id }
        _set: { metadata: $metadata }
      ) {
        id
        metadata
      }
    }
  `;
  const data = await executeHasura(mutation, {
    id: userId,
    metadata: {
      ...(metadata || {}),
      pending_email_verification: true,
      verification_email_sent_at: sentAt,
    },
  });
  return { item: data.item || null, sentAt };
}

async function resendManagedUserVerification(req, res, next) {
  try {
    const existingUser = await loadManagedUserById(req.params.id);
    if (!existingUser) throw createHttpError(404, 'User not found');
    assertCanManageUser(req.auth, existingUser);

    const verificationMap = await loadAuthVerificationMap([existingUser.auth_user_id]);
    if (verificationMap.get(existingUser.auth_user_id)) {
      throw createHttpError(400, 'Email is already verified');
    }

    const payload = {
      email: existingUser.email,
      options: {},
    };
    if (env.nhostEmailRedirectTo) {
      payload.options.redirectTo = env.nhostEmailRedirectTo;
    }

    try {
      await nhostAuthClient.post('/user/email/send-verification-email', payload);
    } catch (error) {
      if (env.nhostEmailRedirectTo && isRedirectToNotAllowed(error)) {
        throw createRedirectToNotAllowedError(env.nhostEmailRedirectTo);
      }
      throw error;
    }
    const { sentAt } = await markVerificationEmailSent(existingUser.id, existingUser.metadata);

    await createAuditLog({
      actorUserId: req.auth.appUser.id,
      actionName: 'account:verification_email_resend',
      entityType: 'app_user',
      entityId: existingUser.id,
      beforeData: { email: existingUser.email, verification_status: 'unverified' },
      afterData: { email: existingUser.email, verification_email_sent_at: sentAt },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return sendSuccess(res, { id: existingUser.id, email: existingUser.email }, 'Verification email sent successfully');
  } catch (error) {
    return next(createHttpError(error.response?.status || error.statusCode || 400, error.response?.data?.message || error.message));
  }
}

resourceRouter.get('/users', authenticate, requireRole('admin', 'user_all_region'), listManagedUsers);
resourceRouter.get('/users/:id', authenticate, requireRole('admin', 'user_all_region'), getManagedUser);
resourceRouter.post('/users/:id/resend-verification', authenticate, requireRole('admin', 'user_all_region'), resendManagedUserVerification);
resourceRouter.patch('/users/:id', authenticate, requireRole('admin', 'user_all_region'), updateManagedUser);
resourceRouter.delete('/users/:id', authenticate, requireRole('admin', 'user_all_region'), deleteManagedUser);

resourceRouter.get('/public/qr/devices/:id', async (req, res, next) => {
  try {
    const deviceId = String(req.params.id || '').trim();
    if (!isUuidLike(deviceId)) {
      throw createHttpError(404, 'Device not found');
    }

    const device = await loadPublicQrDeviceContext(deviceId);
    if (!device) {
      throw createHttpError(404, 'Device not found');
    }

    return sendSuccess(res, device, 'QR device context fetched successfully');
  } catch (error) {
    return next(error);
  }
});

resourceRouter.get('/reference-data', authenticate, requireRole('admin', 'user_region', 'user_all_region'), async (req, res, next) => {
  try {
    const groups = parseReferenceGroups(req.query.groups);
    const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 1000);
    const cacheKey = buildReferenceDataCacheKey(req, groups, limit);
    const cachedPayload = getCachedReferenceData(cacheKey);
    if (cachedPayload) {
      return sendSuccess(res, cachedPayload.data, 'Reference data fetched successfully', 200, {
        ...cachedPayload.meta,
        cached: true,
      });
    }

    const result = {};
    const meta = {};

    await Promise.all(groups.map(async (group) => {
      const groupConfig = REFERENCE_DATA_GROUPS[group];
      const resourceName = groupConfig.resourceName;
      const config = getResourceConfig(resourceName);
      if (!config) {
        result[group] = [];
        meta[group] = { total: 0, skipped: true };
        return;
      }

      const query = { ...req.query };
      delete query.groups;
      delete query.limit;
      delete query.page;

      if (group !== 'pops' && group !== 'projects' && group !== 'customers') {
        delete query.region_id;
      }

      const where = buildReferenceDataWhere(config, query, req.auth);
      const data = await listResources(config, {
        where,
        limit,
        offset: 0,
        orderBy: config.defaultOrderBy,
      });

      result[group] = data.items || [];
      meta[group] = {
        total: Number(data.aggregate?.aggregate?.count || 0),
        limit,
        resource: resourceName,
      };
    }));

    const responseMeta = {
      groups,
      ...meta,
      cached: false,
      cache_ttl_ms: REFERENCE_DATA_CACHE_TTL_MS,
    };
    setCachedReferenceData(cacheKey, { data: result, meta: responseMeta });

    return sendSuccess(res, result, 'Reference data fetched successfully', 200, responseMeta);
  } catch (error) {
    return next(error);
  }
});

function bindResource(resourceName, config) {
  const router = express.Router();

  router.use(authenticate);
  router.use((req, _res, next) => {
    req.resourceName = resourceName;
    req.resourceConfig = config;
    next();
  });

  router.get('/', requireRole(...config.auth.read), controller.list);
  router.get('/:id', requireRole(...config.auth.read), controller.getById);
  if (!config.readOnly) {
    router.post('/', requireRole(...config.auth.write), controller.create);
    router.patch('/:id', requireRole(...config.auth.write), controller.update);
    router.delete('/:id', requireRole(...config.auth.write), controller.remove);
    if (config.softDelete) {
      router.post('/:id/restore', requireRole(...config.auth.write), controller.restore);
      router.post('/:id/purge', requireRole('admin'), controller.purge);
    }
  }

  resourceRouter.use(`/${resourceName}`, router);
}

Object.entries(RESOURCE_CONFIG).forEach(([resourceName, config]) => bindResource(resourceName, config));

resourceRouter.get('/devices/:id/trace', authenticate, requireRole('admin', 'user_region', 'user_all_region'), async (req, res, next) => {
  try {
    const startDevice = await loadDeviceById(req.params.id);
    if (!startDevice) {
      throw createHttpError(404, 'Device not found');
    }

    const scope = getRegionalTopologyScope(req.auth);
    assertTopologyRegionAccess(scope, startDevice.region_id, 'You do not have access to this device region');
    const requestedRegionId = req.query.region_id ? String(req.query.region_id) : null;
    assertTopologyRegionAccess(scope, requestedRegionId);
    const maxDepth = Math.min(Math.max(Number(req.query.max_depth) || 6, 1), 24);
    const allowedRegionIds = scope.allowedRegionIds;

    const connections = await loadPortConnections({ allowedRegionIds, requestedRegionId });
    const portIds = Array.from(
      new Set(
        connections
          .flatMap((item) => [item.from_port_id, item.to_port_id])
          .filter(Boolean),
      ),
    );
    const ports = await loadPortsByIds(portIds);
    const portMap = new Map(ports.map((port) => [port.id, port]));

    const graphEdges = [];
    const adjacency = new Map();
    const incomingAdj = new Map();
    const outgoingAdj = new Map();

    for (const connection of connections) {
      const fromPort = portMap.get(connection.from_port_id);
      const toPort = portMap.get(connection.to_port_id);
      if (!fromPort || !toPort) continue;

      const fromDeviceId = fromPort.device_id;
      const toDeviceId = toPort.device_id;
      if (!fromDeviceId || !toDeviceId) continue;

      const edge = {
        id: connection.id,
        connection_id: connection.connection_id,
        region_id: connection.region_id,
        from_device_id: fromDeviceId,
        to_device_id: toDeviceId,
        from_port_id: fromPort.id,
        to_port_id: toPort.id,
        from_port_label: fromPort.port_label,
        to_port_label: toPort.port_label,
        connection_type: connection.connection_type,
        status: connection.status,
        route_id: connection.route_id,
        cable_device_id: connection.cable_device_id,
        core_start: connection.core_start,
        core_end: connection.core_end,
        fiber_count: connection.fiber_count,
      };
      graphEdges.push(edge);

      if (!adjacency.has(fromDeviceId)) adjacency.set(fromDeviceId, []);
      if (!adjacency.has(toDeviceId)) adjacency.set(toDeviceId, []);
      adjacency.get(fromDeviceId).push({ next: toDeviceId, edgeId: edge.id });
      adjacency.get(toDeviceId).push({ next: fromDeviceId, edgeId: edge.id });

      if (!incomingAdj.has(toDeviceId)) incomingAdj.set(toDeviceId, []);
      if (!outgoingAdj.has(fromDeviceId)) outgoingAdj.set(fromDeviceId, []);
      incomingAdj.get(toDeviceId).push(fromDeviceId);
      outgoingAdj.get(fromDeviceId).push(toDeviceId);
    }

    const visited = new Set([startDevice.id]);
    const queue = [{ id: startDevice.id, depth: 0 }];
    const relevantEdgeIds = new Set();

    while (queue.length) {
      const current = queue.shift();
      if (current.depth >= maxDepth) continue;
      const neighbors = adjacency.get(current.id) || [];

      for (const neighbor of neighbors) {
        relevantEdgeIds.add(neighbor.edgeId);
        if (visited.has(neighbor.next)) continue;
        visited.add(neighbor.next);
        queue.push({ id: neighbor.next, depth: current.depth + 1 });
      }
    }

    const filteredEdges = graphEdges.filter((edge) => relevantEdgeIds.has(edge.id));
    const deviceIds = Array.from(
      new Set(filteredEdges.flatMap((edge) => [edge.from_device_id, edge.to_device_id]).filter(Boolean)),
    );
    if (!deviceIds.includes(startDevice.id)) {
      deviceIds.push(startDevice.id);
    }
    const nodes = await loadDevicesByIds(deviceIds);
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));

    const fiberCores = await loadFiberCoresByConnectionIds(filteredEdges.map((edge) => edge.id));
    const fiberByConnection = fiberCores.reduce((acc, item) => {
      const key = item.connection_id;
      if (!key) return acc;
      if (!acc[key]) {
        acc[key] = { total: 0, used: 0, statuses: {}, colors: {}, tube_colors: {}, loss_warnings: 0 };
      }
      acc[key].total += 1;
      if (item.status === 'used') acc[key].used += 1;
      acc[key].statuses[item.status] = (acc[key].statuses[item.status] || 0) + 1;
      if (item.color_name) {
        acc[key].colors[item.color_name] = (acc[key].colors[item.color_name] || 0) + 1;
      }
      if (item.tube_color_name) {
        acc[key].tube_colors[item.tube_color_name] = (acc[key].tube_colors[item.tube_color_name] || 0) + 1;
      }
      if (Number(item.last_loss_db) > 0.2) acc[key].loss_warnings += 1;
      return acc;
    }, {});

    const edges = filteredEdges.map((edge) => ({
      ...edge,
      fiber_cores: fiberByConnection[edge.id] || { total: 0, used: 0, statuses: {}, colors: {}, tube_colors: {}, loss_warnings: 0 },
    }));

    const upstreamByType = collectByDirection({
      startId: startDevice.id,
      adjacency: incomingAdj,
      nodeMap,
      maxDepth,
    });
    const downstreamByType = collectByDirection({
      startId: startDevice.id,
      adjacency: outgoingAdj,
      nodeMap,
      maxDepth,
    });

    return sendSuccess(
      res,
      {
        start_device: startDevice,
        trace_source: 'port_connections',
        graph: {
          nodes,
          links: edges,
        },
        summary: {
          max_depth: maxDepth,
          node_count: nodes.length,
          link_count: edges.length,
          upstream_by_type: upstreamByType,
          downstream_by_type: downstreamByType,
        },
      },
      'Device trace fetched successfully',
    );
  } catch (error) {
    return next(error);
  }
});

resourceRouter.get('/devices/:id/core-chain-summary', authenticate, requireRole('admin', 'user_region', 'user_all_region'), async (req, res, next) => {
  try {
    const device = await loadDeviceById(req.params.id);
    if (!device) throw createHttpError(404, 'Device not found');

    const scope = getRegionalTopologyScope(req.auth);
    assertTopologyRegionAccess(scope, device.region_id, 'You do not have access to this device region');

    const summary = await buildOdpCoreChainSummary(req.params.id);
    if (!summary) throw createHttpError(404, 'Device not found');

    return sendSuccess(res, summary, 'ODP core chain summary fetched successfully');
  } catch (error) {
    return next(error);
  }
});

resourceRouter.get('/devices/:id/core-chain-draft', authenticate, requireRole('admin', 'user_region', 'user_all_region'), async (req, res, next) => {
  try {
    const device = await loadDeviceById(req.params.id);
    if (!device) throw createHttpError(404, 'Device not found');

    const scope = getRegionalTopologyScope(req.auth);
    assertTopologyRegionAccess(scope, device.region_id, 'You do not have access to this device region');

    const draft = await buildOdpCoreChainDraft(req.params.id);
    if (!draft) throw createHttpError(404, 'Device not found');

    return sendSuccess(res, draft, 'ODP core chain draft fetched successfully');
  } catch (error) {
    return next(error);
  }
});

resourceRouter.post('/devices/:id/core-chain-draft-link', authenticate, requireRole('admin', 'user_region', 'user_all_region'), async (req, res, next) => {
  try {
    const odpDevice = await loadDeviceById(req.params.id);
    if (!odpDevice) throw createHttpError(404, 'Device not found');

    const scope = getRegionalTopologyScope(req.auth);
    assertTopologyRegionAccess(scope, odpDevice.region_id, 'You do not have access to this device region');

    if (String(odpDevice.device_type_key || '').toUpperCase() !== 'ODP') {
      throw createHttpError(400, 'Draft link endpoint only supports ODP device');
    }

    const upstreamPortId = String(req.body?.upstream_port_id || '').trim();
    const odpPortId = String(req.body?.odp_port_id || '').trim();
    const cableDeviceId = String(req.body?.cable_device_id || '').trim() || null;
    const coreStartRaw = req.body?.core_start;
    const coreEndRaw = req.body?.core_end;
    const fiberCountRaw = req.body?.fiber_count;
    if (!upstreamPortId || !odpPortId) {
      throw createHttpError(400, 'upstream_port_id and odp_port_id are required');
    }

    const [upstreamPort, odpPort] = await Promise.all([loadPortById(upstreamPortId), loadPortById(odpPortId)]);
    if (!upstreamPort || !odpPort) throw createHttpError(404, 'Port not found');
    if (upstreamPort.deleted_at || odpPort.deleted_at) throw createHttpError(400, 'Cannot connect deleted port');

    if (odpPort.device_id !== odpDevice.id) {
      throw createHttpError(400, 'odp_port_id is not part of the requested ODP device');
    }

    if (upstreamPort.device_id === odpPort.device_id) {
      throw createHttpError(400, 'Upstream and ODP port cannot be from same device');
    }

    if (upstreamPort.region_id && odpPort.region_id && upstreamPort.region_id !== odpPort.region_id) {
      throw createHttpError(400, 'Port region mismatch');
    }

    const hasCoreStart = coreStartRaw != null && coreStartRaw !== '';
    const hasCoreEnd = coreEndRaw != null && coreEndRaw !== '';
    if (hasCoreStart !== hasCoreEnd) {
      throw createHttpError(400, 'core_start and core_end must be provided together');
    }

    let coreStart = null;
    let coreEnd = null;
    let fiberCount = null;
    if (hasCoreStart && hasCoreEnd) {
      coreStart = Number(coreStartRaw);
      coreEnd = Number(coreEndRaw);
      if (!Number.isInteger(coreStart) || coreStart <= 0) throw createHttpError(400, 'core_start must be integer >= 1');
      if (!Number.isInteger(coreEnd) || coreEnd <= 0) throw createHttpError(400, 'core_end must be integer >= 1');
      if (coreEnd < coreStart) throw createHttpError(400, 'core_end cannot be smaller than core_start');
      fiberCount = coreEnd - coreStart + 1;
    }

    if (fiberCountRaw != null && fiberCountRaw !== '') {
      const parsed = Number(fiberCountRaw);
      if (!Number.isInteger(parsed) || parsed < 1) {
        throw createHttpError(400, 'fiber_count must be integer >= 1');
      }
      fiberCount = parsed;
    }

    if ((hasCoreStart || hasCoreEnd || fiberCount != null) && !cableDeviceId) {
      throw createHttpError(400, 'cable_device_id is required when core range or fiber_count is provided');
    }

    if (cableDeviceId) {
      const cable = await loadDeviceById(cableDeviceId);
      if (!cable) throw createHttpError(404, 'Cable device not found');
      if (String(cable.device_type_key || '').toUpperCase() !== 'CABLE') {
        throw createHttpError(400, 'cable_device_id must reference device_type_key CABLE');
      }
      if (cable.region_id && cable.region_id !== odpDevice.region_id) {
        throw createHttpError(400, 'Cable device region must match ODP region');
      }
    }

    await validateFiberCoreRangeForConnection({
      cable_device_id: cableDeviceId,
      core_start: coreStart,
      core_end: coreEnd,
    });

    const existing = await loadConnectionByPortPair(upstreamPort.id, odpPort.id);
    if (existing) {
      return sendSuccess(
        res,
        {
          created: false,
          existing_connection: existing,
        },
        'Draft link already exists',
      );
    }

    const upstreamDevice = await loadDeviceById(upstreamPort.device_id);

    const mutation = `
      mutation InsertDraftPortConnection($object: port_connections_insert_input!) {
        inserted: insert_port_connections_one(object: $object) {
          id
          connection_id
          region_id
          from_port_id
          to_port_id
          connection_type
          status
          notes
          created_at
        }
      }
    `;
    const object = {
      region_id: odpDevice.region_id,
      from_port_id: upstreamPort.id,
      to_port_id: odpPort.id,
      connection_type: 'fiber',
      status: 'planned',
      cable_device_id: cableDeviceId,
      core_start: coreStart,
      core_end: coreEnd,
      fiber_count: fiberCount,
      notes: '[auto-draft] ODP core chain link suggestion',
    };

    if (req.auth.role !== 'admin') {
      const existingRequest = await findActivePortConnectionCreateRequest({
        regionId: odpDevice.region_id,
        fromPortId: upstreamPort.id,
        toPortId: odpPort.id,
      });
      if (existingRequest) {
        return sendSuccess(
          res,
          {
            created: false,
            approval_request: existingRequest,
          },
          'Draft link request is already waiting for superadmin approval',
          200,
        );
      }

      const pendingConnectionId = randomUUID();
      const payloadSnapshot = {
        source: 'adminregion-create-resource',
        operation: 'create',
        resource_name: 'portConnections',
        resource_label: 'Port Connection',
        portConnection: {
          id: pendingConnectionId,
          ...object,
        },
        resource_payload: object,
        context: {
          source: 'core-chain-draft-link',
          odp_device_id: odpDevice.id,
          odp_device_name: odpDevice.device_name || odpDevice.device_id || null,
          upstream_device_id: upstreamDevice?.id || upstreamPort.device_id,
          upstream_device_name: upstreamDevice?.device_name || upstreamDevice?.device_id || null,
          upstream_port_id: upstreamPort.id,
          upstream_port_label: upstreamPort.port_label || `#${upstreamPort.port_index}`,
          odp_port_id: odpPort.id,
          odp_port_label: odpPort.port_label || `#${odpPort.port_index}`,
          cable_device_id: cableDeviceId,
        },
      };

      const approvalRequest = await createValidationRequest({
        entityType: 'portConnection',
        entityId: pendingConnectionId,
        regionId: odpDevice.region_id,
        submittedByUserId: req.auth.appUser.id,
        currentStatus: VALIDATION_STATUS.PENDING_ASYNC,
        payloadSnapshot,
        checklist: {},
        findingNote: 'Create port connection request by adminregion.',
      });

      await insertValidationRequestLog({
        requestId: approvalRequest.id,
        actionType: VALIDATION_ACTION.RESUBMIT_ADMINREGION,
        actorUserId: req.auth.appUser.id,
        actorRole: req.auth.role === 'user_region' ? 'validator' : 'adminregion',
        beforeStatus: VALIDATION_STATUS.UNVALIDATED,
        afterStatus: VALIDATION_STATUS.PENDING_ASYNC,
        note: 'Create port connection request submitted to superadmin.',
        payloadPatch: payloadSnapshot,
      });

      await createAuditLog({
        actorUserId: req.auth.appUser.id,
        actionName: 'asset_create_request_submitted_by_adminregion',
        entityType: 'validation_requests',
        entityId: approvalRequest.id,
        beforeData: null,
        afterData: {
          request_id: approvalRequest.request_id,
          source: payloadSnapshot.source,
          operation: payloadSnapshot.operation,
          resource_name: payloadSnapshot.resource_name,
          entity_type: 'portConnection',
          entity_id: pendingConnectionId,
          from_port_id: upstreamPort.id,
          to_port_id: odpPort.id,
          cable_device_id: cableDeviceId,
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      return sendSuccess(
        res,
        {
          created: false,
          approval_request: approvalRequest,
        },
        'Draft link request sent to superadmin approval',
        201,
      );
    }

    const result = await executeHasura(mutation, { object });
    const inserted = result.inserted;

    await createAuditLog({
      actorUserId: req.auth.appUser.id,
      actionName: 'create:core_chain_draft_link',
      entityType: 'portConnections',
      entityId: inserted?.id || null,
      beforeData: null,
      afterData: {
        odp_device_id: odpDevice.id,
        upstream_port_id: upstreamPort.id,
        odp_port_id: odpPort.id,
        connection: inserted,
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return sendSuccess(
      res,
      {
        created: true,
        connection: inserted,
      },
      'ODP draft link created successfully',
      201,
    );
  } catch (error) {
    return next(error);
  }
});

resourceRouter.post('/devices/:id/provision-ports', authenticate, requireRole('admin', 'user_region', 'user_all_region'), async (req, res, next) => {
  try {
    const device = await loadDeviceById(req.params.id);
    if (!device) throw createHttpError(404, 'Device not found');

    const scope = getRegionalTopologyScope(req.auth);
    assertTopologyRegionAccess(scope, device.region_id, 'You do not have access to this device region');

    const profileName = String(req.body?.profile_name || 'default').trim() || 'default';
    const dryRun = String(req.body?.dry_run || '').toLowerCase() === 'true';

    const template = await loadDevicePortTemplate(device.device_type_key, profileName);
    if (!template) {
      throw createHttpError(404, `No active port template found for ${device.device_type_key} (${profileName})`);
    }

    const existingPorts = await loadDevicePortsByDeviceId(device.id);
    const existingIndexes = new Set(existingPorts.map((item) => Number(item.port_index)));

    const requestedTotalPorts = Number(device.total_ports);
    const totalPorts = Number.isInteger(requestedTotalPorts) && requestedTotalPorts > 0
      ? requestedTotalPorts
      : (Number(template.total_ports) || 0);
    const splitterPortCount = parseSplitterRatioPorts(device.splitter_ratio);
    if (String(device.device_type_key || '').toUpperCase() === 'ODP' && device.splitter_ratio) {
      if (!splitterPortCount) {
        throw createHttpError(400, 'ODP splitter_ratio must use format 1:8, 1:16, or 1/16 before provisioning ports');
      }
      if (totalPorts !== splitterPortCount) {
        throw createHttpError(400, 'ODP total_ports must match splitter_ratio output capacity before provisioning ports');
      }
    }
    const startPortIndex = Number(template.start_port_index) || 1;

    const missingIndexes = [];
    for (let i = 0; i < totalPorts; i += 1) {
      const portIndex = startPortIndex + i;
      if (!existingIndexes.has(portIndex)) {
        missingIndexes.push(portIndex);
      }
    }

    if (dryRun) {
      return sendSuccess(
        res,
        {
          device_id: device.id,
          template_id: template.id,
          profile_name: template.profile_name,
          existing_port_count: existingPorts.length,
          missing_port_indexes: missingIndexes,
          create_count: missingIndexes.length,
        },
        'Port provisioning dry-run completed',
      );
    }

    if (!missingIndexes.length) {
      return sendSuccess(
        res,
        {
          device_id: device.id,
          template_id: template.id,
          profile_name: template.profile_name,
          existing_port_count: existingPorts.length,
          created_count: 0,
        },
        'All ports already provisioned',
      );
    }

    const objects = missingIndexes.map((portIndex) => ({
      region_id: device.region_id,
      device_id: device.id,
      port_index: portIndex,
      port_label: `#${portIndex}`,
      port_type: template.default_port_type || 'fiber',
      direction: template.default_direction || 'bidirectional',
      status: 'idle',
      speed_profile: template.default_speed_profile || null,
      core_capacity: template.default_core_capacity ?? null,
      core_used: 0,
      splitter_ratio: String(device.device_type_key || '').toUpperCase() === 'ODP' ? device.splitter_ratio || null : null,
      is_active: true,
    }));

    if (req.auth.role !== 'admin') {
      const existingRequest = await findActiveProvisionPortsRequest(device.id, template.profile_name);
      if (existingRequest) {
        return sendSuccess(
          res,
          {
            device_id: device.id,
            template_id: template.id,
            profile_name: template.profile_name,
            existing_port_count: existingPorts.length,
            create_count: missingIndexes.length,
            approval_request: existingRequest,
          },
          'Port provisioning request is already waiting for superadmin approval',
          200,
        );
      }

      const payloadSnapshot = {
        source: 'adminregion-provision-device-ports',
        operation: 'provision_ports',
        profile_name: template.profile_name,
        device: {
          id: device.id,
          device_id: device.device_id || null,
          device_name: device.device_name || null,
          device_type_key: device.device_type_key || null,
          region_id: device.region_id || null,
          pop_id: device.pop_id || null,
          project_id: device.project_id || null,
        },
        template: {
          id: template.id,
          template_id: template.template_id || null,
          profile_name: template.profile_name,
          total_ports: template.total_ports,
          start_port_index: template.start_port_index,
        },
        existing_port_count: existingPorts.length,
        missing_port_indexes: missingIndexes,
        port_objects: objects,
      };

      const approvalRequest = await createValidationRequest({
        entityType: 'device',
        entityId: device.id,
        regionId: device.region_id,
        submittedByUserId: req.auth.appUser.id,
        currentStatus: VALIDATION_STATUS.PENDING_ASYNC,
        payloadSnapshot,
        checklist: {},
        findingNote: 'Provision device ports request by adminregion.',
      });

      await insertValidationRequestLog({
        requestId: approvalRequest.id,
        actionType: VALIDATION_ACTION.RESUBMIT_ADMINREGION,
        actorUserId: req.auth.appUser.id,
        actorRole: 'adminregion',
        beforeStatus: VALIDATION_STATUS.UNVALIDATED,
        afterStatus: VALIDATION_STATUS.PENDING_ASYNC,
        note: 'Provision device ports request submitted to superadmin.',
        payloadPatch: payloadSnapshot,
      });

      await createAuditLog({
        actorUserId: req.auth.appUser.id,
        actionName: 'asset_provision_ports_request_submitted_by_adminregion',
        entityType: 'validation_requests',
        entityId: approvalRequest.id,
        beforeData: { existing_port_count: existingPorts.length },
        afterData: {
          request_id: approvalRequest.request_id,
          source: payloadSnapshot.source,
          device_id: device.id,
          profile_name: template.profile_name,
          create_count: missingIndexes.length,
          missing_port_indexes: missingIndexes,
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      });

      return sendSuccess(
        res,
        {
          device_id: device.id,
          template_id: template.id,
          profile_name: template.profile_name,
          existing_port_count: existingPorts.length,
          create_count: missingIndexes.length,
          approval_request: approvalRequest,
        },
        'Port provisioning request sent to superadmin approval',
        201,
      );
    }

    const mutation = `
      mutation ProvisionPorts($objects: [device_ports_insert_input!]!) {
        inserted: insert_device_ports(objects: $objects) {
          affected_rows
          returning {
            id
            port_id
            port_index
            port_label
            port_type
            direction
            status
          }
        }
      }
    `;
    const result = await executeHasura(mutation, { objects });
    const createdRows = result.inserted?.returning || [];
    const usage = await syncDevicePortUsage(device.id);

    await createAuditLog({
      actorUserId: req.auth.appUser.id,
      actionName: 'provision_ports:devices',
      entityType: 'devices',
      entityId: device.id,
      beforeData: { existing_port_count: existingPorts.length },
      afterData: {
        profile_name: template.profile_name,
        created_count: createdRows.length,
        created_port_indexes: createdRows.map((row) => row.port_index),
        usage,
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return sendSuccess(
      res,
      {
        device_id: device.id,
        template_id: template.id,
        profile_name: template.profile_name,
        existing_port_count: existingPorts.length,
        created_count: createdRows.length,
        created_ports: createdRows,
        usage,
      },
      'Ports provisioned successfully',
    );
  } catch (error) {
    return next(error);
  }
});

resourceRouter.post('/device-ports/:id/assignment', authenticate, requireRole('admin', 'user_all_region'), async (req, res, next) => {
  try {
    const port = await loadPortById(req.params.id);
    if (!port) throw createHttpError(404, 'Device port not found');
    if (port.deleted_at) throw createHttpError(400, 'Cannot assign deleted port');

    if (req.auth.role === 'user_all_region' && !req.auth.regions.includes(port.region_id)) {
      throw createHttpError(403, 'You do not have access to this port region');
    }

    const customerId = req.body?.customer_id ? String(req.body.customer_id) : null;
    const ontDeviceId = req.body?.ont_device_id ? String(req.body.ont_device_id) : null;
    if (!customerId && !ontDeviceId) {
      throw createHttpError(400, 'customer_id or ont_device_id is required');
    }

    const currentStatus = String(port.status || '').toLowerCase();
    if (!['idle', 'reserved'].includes(currentStatus)) {
      throw createHttpError(400, 'Port must be idle or reserved before assignment');
    }

    const [device, customer, ontDevice] = await Promise.all([
      loadDeviceById(port.device_id),
      customerId ? loadCustomerById(customerId) : Promise.resolve(null),
      ontDeviceId ? loadDeviceById(ontDeviceId) : Promise.resolve(null),
    ]);
    if (!device) throw createHttpError(404, 'Port device not found');
    if (customerId && !customer) throw createHttpError(404, 'Customer not found');
    if (ontDeviceId && !ontDevice) throw createHttpError(404, 'ONT device not found');
    if (customer?.region_id && customer.region_id !== port.region_id) {
      throw createHttpError(400, 'Customer region must match port region');
    }
    if (ontDevice?.region_id && ontDevice.region_id !== port.region_id) {
      throw createHttpError(400, 'ONT device region must match port region');
    }

    const [customerAssignment, ontAssignment] = await Promise.all([
      customerId ? findActivePortAssignmentByField('customer_id', customerId, port.id) : Promise.resolve(null),
      ontDeviceId ? findActivePortAssignmentByField('ont_device_id', ontDeviceId, port.id) : Promise.resolve(null),
    ]);
    if (customerAssignment) throw createHttpError(400, 'Customer is already assigned to another active port');
    if (ontAssignment) throw createHttpError(400, 'ONT device is already assigned to another active port');

    const changes = {
      status: 'used',
      customer_id: customerId,
      ont_device_id: ontDeviceId,
      occupied_at: port.occupied_at || new Date().toISOString().slice(0, 10),
      notes: req.body?.notes !== undefined ? req.body.notes : port.notes,
    };
    const context = {
      device_id: device.id,
      device_name: device.device_name || device.device_id || null,
      port_label: port.port_label || `#${port.port_index}`,
      customer_name: customer?.customer_name || null,
      customer_number: customer?.customer_number || null,
      ont_device_name: ontDevice?.device_name || ontDevice?.device_id || null,
    };

    if (req.auth.role !== 'admin') {
      const approvalRequest = await submitDevicePortAssignmentRequest({
        req,
        port,
        changes,
        operation: 'assign',
        context,
      });
      return sendSuccess(res, { approval_request: approvalRequest }, 'Port assignment request sent to superadmin approval', 201);
    }

    const item = await updateDevicePortAssignmentById(port.id, changes);
    await syncDevicePortUsage(port.device_id);
    await createAuditLog({
      actorUserId: req.auth.appUser.id,
      actionName: 'port_assignment_assigned_by_superadmin',
      entityType: 'device_ports',
      entityId: port.id,
      beforeData: port,
      afterData: { ...item, context },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return sendSuccess(res, item, 'Port assignment saved successfully');
  } catch (error) {
    return next(error);
  }
});

resourceRouter.delete('/device-ports/:id/assignment', authenticate, requireRole('admin', 'user_all_region'), async (req, res, next) => {
  try {
    const port = await loadPortById(req.params.id);
    if (!port) throw createHttpError(404, 'Device port not found');
    if (port.deleted_at) throw createHttpError(400, 'Cannot release deleted port');

    if (req.auth.role === 'user_all_region' && !req.auth.regions.includes(port.region_id)) {
      throw createHttpError(403, 'You do not have access to this port region');
    }

    const device = await loadDeviceById(port.device_id);
    if (!device) throw createHttpError(404, 'Port device not found');

    const releaseStatus = String(req.body?.status || 'idle').toLowerCase();
    if (!['idle', 'reserved'].includes(releaseStatus)) {
      throw createHttpError(400, 'Release status must be idle or reserved');
    }

    const changes = {
      status: releaseStatus,
      customer_id: null,
      ont_device_id: null,
      occupied_at: null,
      notes: req.body?.notes !== undefined ? req.body.notes : port.notes,
    };
    const context = {
      device_id: device.id,
      device_name: device.device_name || device.device_id || null,
      port_label: port.port_label || `#${port.port_index}`,
    };

    if (req.auth.role !== 'admin') {
      const approvalRequest = await submitDevicePortAssignmentRequest({
        req,
        port,
        changes,
        operation: 'release',
        context,
      });
      return sendSuccess(res, { approval_request: approvalRequest }, 'Port release request sent to superadmin approval', 201);
    }

    const item = await updateDevicePortAssignmentById(port.id, changes);
    await syncDevicePortUsage(port.device_id);
    await createAuditLog({
      actorUserId: req.auth.appUser.id,
      actionName: 'port_assignment_released_by_superadmin',
      entityType: 'device_ports',
      entityId: port.id,
      beforeData: port,
      afterData: { ...item, context },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return sendSuccess(res, item, 'Port assignment released successfully');
  } catch (error) {
    return next(error);
  }
});

resourceRouter.get('/topology/port-connections', authenticate, requireRole('admin', 'user_region', 'user_all_region'), async (req, res, next) => {
  try {
    const requestedRegionId = req.query.region_id ? String(req.query.region_id) : null;
    const requestedStatus = req.query.status ? String(req.query.status) : null;
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);
    const scope = getRegionalTopologyScope(req.auth);
    assertTopologyRegionAccess(scope, requestedRegionId);

    const filters = [];
    if (requestedRegionId) {
      filters.push({ region_id: { _eq: requestedRegionId } });
    } else if (scope.isRegional) {
      filters.push({ region_id: { _in: scope.allowedRegionIds } });
    }

    if (requestedStatus) {
      filters.push({ status: { _eq: requestedStatus } });
    } else {
      filters.push({
        _or: [
          { status: { _neq: 'inactive' } },
          { status: { _is_null: true } },
        ],
      });
    }

    const where = filters.length ? { _and: filters } : {};
    const connections = await loadPortConnectionsByWhere(where, limit);
    const items = await enrichPortConnections(connections);

    return sendSuccess(
      res,
      {
        scope: {
          role: req.auth.role,
          requested_region_id: requestedRegionId,
          status: requestedStatus,
          limit,
        },
        items,
      },
      'Port connections fetched successfully',
    );
  } catch (error) {
    return next(error);
  }
});

resourceRouter.get('/topology/port-connections/:id', authenticate, requireRole('admin', 'user_region', 'user_all_region'), async (req, res, next) => {
  try {
    const filters = [{ id: { _eq: req.params.id } }];
    const scope = getRegionalTopologyScope(req.auth);

    if (scope.isRegional) {
      filters.push({ region_id: { _in: scope.allowedRegionIds } });
    }

    const connections = await loadPortConnectionsByWhere({ _and: filters }, 1);
    const items = await enrichPortConnections(connections);
    const item = items[0] || null;
    if (!item) {
      throw createHttpError(404, 'Port connection not found');
    }

    return sendSuccess(res, item, 'Port connection fetched successfully');
  } catch (error) {
    return next(error);
  }
});

resourceRouter.get('/topology/devices/:id/summary', authenticate, requireRole('admin', 'user_region', 'user_all_region'), async (req, res, next) => {
  try {
    const device = await loadDeviceById(req.params.id);
    if (!device) {
      throw createHttpError(404, 'Device not found');
    }
    // P8: Filter retired/inactive device
    const deviceStatus = String(device.status || '').toLowerCase();
    if (deviceStatus === 'retired' || deviceStatus === 'inactive') {
      throw createHttpError(404, 'Device not found');
    }

    const scope = getRegionalTopologyScope(req.auth);
    assertTopologyRegionAccess(scope, device.region_id, 'You do not have access to this device region');

    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);
    const ports = await loadPortsByDeviceIds([device.id]);

    // P7: Short-circuit non-ODC — skip expensive topology queries
    const deviceTypeKey = String(device.device_type_key || '').toUpperCase();
    if (deviceTypeKey !== 'ODC') {
      const basicPayload = {
        scope: {
          role: req.auth.role,
          region_id: device.region_id,
          device_id: device.id,
          limit,
        },
        device,
        ports: {
          summary: buildPortSummary(ports),
          items: ports,
        },
        connections: { summary: null, items: [] },
        core_management: { summary: null, items: [] },
        odc_relations: null,
        core_overlap_conflicts: [],
        fiber_cores: { summary: null, cable_device_ids: [], items: [] },
        readiness: {
          has_ports: ports.length > 0,
          has_connections: false,
          has_core_summary: false,
          has_fiber_core_inventory: false,
          has_odc_upstream: false,
          has_odc_downstream_odp: false,
          has_odc_cable_context: false,
          has_odc_core_mapping: false,
          has_odc_splitter: false,
          trace_endpoint: `/api/v1/devices/${device.id}/trace`,
        },
      };
      return sendSuccess(res, basicPayload, 'Device topology summary fetched successfully');
    }

    const portIds = ports.map((port) => port.id).filter(Boolean);
    const connectionConditions = [
      { cable_device_id: { _eq: device.id } },
    ];
    if (portIds.length) {
      connectionConditions.push(
        { from_port_id: { _in: portIds } },
        { to_port_id: { _in: portIds } },
      );
    }

    const connectionFilters = [
      { region_id: { _eq: device.region_id } },
      { _or: connectionConditions },
      {
        _or: [
          { status: { _neq: 'inactive' } },
          { status: { _is_null: true } },
        ],
      },
    ];
    const connections = await loadPortConnectionsByWhere({ _and: connectionFilters }, limit);
    const enrichedConnections = await enrichPortConnections(connections);
    const coreManagementRows = await loadCoreManagementByDeviceId(device.id, limit);
    const enrichedCoreManagement = await enrichCoreManagementRows(coreManagementRows);
    const odcRelations = await buildOdcRelationSummary(device, ports, enrichedConnections);

    const cableDeviceIds = Array.from(new Set([
      String(device.device_type_key || '').toUpperCase() === 'CABLE' ? device.id : null,
      ...connections.map((item) => item.cable_device_id),
      ...coreManagementRows.map((item) => item.cable_device_id),
    ].filter(Boolean)));
    const fiberCores = await loadFiberCoresByCableDeviceIds(cableDeviceIds, Math.min(limit * 10, 1000));
    const coreOverlapConflicts = detectCoreOverlapConflicts(enrichedConnections);

    const payload = {
      scope: {
        role: req.auth.role,
        region_id: device.region_id,
        device_id: device.id,
        limit,
      },
      device,
      ports: {
        summary: buildPortSummary(ports),
        items: ports,
      },
      connections: {
        summary: buildConnectionSummary(connections),
        items: enrichedConnections,
      },
      core_management: {
        summary: buildCoreManagementSummary(coreManagementRows),
        items: enrichedCoreManagement,
      },
      odc_relations: odcRelations,
      core_overlap_conflicts: coreOverlapConflicts,
      fiber_cores: {
        summary: buildFiberCoreSummary(fiberCores),
        cable_device_ids: cableDeviceIds,
        items: fiberCores,
      },
      readiness: {
        has_ports: ports.length > 0,
        has_connections: connections.length > 0,
        has_core_summary: coreManagementRows.length > 0,
        has_fiber_core_inventory: fiberCores.length > 0,
        has_odc_upstream: odcRelations?.readiness?.has_upstream_source || false,
        has_odc_downstream_odp: odcRelations?.readiness?.has_downstream_odp || false,
        has_odc_cable_context: odcRelations?.readiness?.has_cable_context || false,
        has_odc_core_mapping: odcRelations?.readiness?.has_core_mapping || false,
        has_odc_splitter: odcRelations?.readiness?.has_splitter_configured || false,
        trace_endpoint: `/api/v1/devices/${device.id}/trace`,
      },
    };

    return sendSuccess(res, payload, 'Device topology summary fetched successfully');
  } catch (error) {
    return next(error);
  }
});

resourceRouter.get('/topology/maps', authenticate, requireRole('admin', 'user_region', 'user_all_region'), async (req, res, next) => {
  try {
    const requestedRegionId = req.query.region_id ? String(req.query.region_id) : null;
    const scope = getRegionalTopologyScope(req.auth);
    assertTopologyRegionAccess(scope, requestedRegionId);
    const allowedRegionIds = scope.allowedRegionIds;
    const projectId = req.query.project_id ? String(req.query.project_id) : null;
    const popId = req.query.pop_id ? String(req.query.pop_id) : null;
    const deviceTypeKey = req.query.device_type_key ? String(req.query.device_type_key).toUpperCase() : null;
    const tenantId = req.query.tenant_id ? String(req.query.tenant_id) : null;
    const cutConnectionId = req.query.cut_connection_id ? String(req.query.cut_connection_id) : null;
    const cutCableDeviceId = req.query.cut_cable_device_id ? String(req.query.cut_cable_device_id) : null;
    if (cutConnectionId && cutCableDeviceId) {
      throw createHttpError(400, 'Use either cut_connection_id or cut_cable_device_id, not both');
    }
    const deviceLimit = parseMapLimit(req.query.device_limit, 1000, 3000);
    const routeLimit = parseMapLimit(req.query.route_limit, 500, 1000);
    const connectionLimit = parseMapLimit(req.query.connection_limit, 1000, 3000);

    const [devices, routes, connections] = await Promise.all([
      loadMapDevices({
        allowedRegionIds,
        requestedRegionId,
        projectId,
        popId,
        deviceTypeKey,
        tenantId,
        limit: deviceLimit,
      }),
      loadMapRoutes({
        allowedRegionIds,
        requestedRegionId,
        projectId,
        popId,
        limit: routeLimit,
      }),
      loadMapPortConnections({
        allowedRegionIds,
        requestedRegionId,
        limit: connectionLimit,
      }),
    ]);

    const portIds = Array.from(new Set(connections.flatMap((item) => [item.from_port_id, item.to_port_id]).filter(Boolean)));
    const connectionRouteIds = Array.from(new Set(connections.map((item) => item.route_id).filter(Boolean)));
    const knownRouteIds = new Set(routes.map((route) => route.id));
    const [ports, connectionRoutes] = await Promise.all([
      loadPortsByIds(portIds),
      loadRoutesByIds(connectionRouteIds.filter((routeId) => !knownRouteIds.has(routeId))),
    ]);

    const routeRows = [...routes, ...connectionRoutes];
    const routeMap = new Map(routeRows.map((route) => [route.id, route]));
    const portMap = new Map(ports.map((port) => [port.id, port]));
    const relatedDeviceIds = Array.from(new Set([
      ...devices.map((device) => device.id),
      ...ports.map((port) => port.device_id).filter(Boolean),
      ...connections.map((connection) => connection.cable_device_id).filter(Boolean),
      ...routeRows.flatMap((route) => [route.start_asset_id, route.end_asset_id]).filter(Boolean),
    ]));
    const existingDeviceIds = new Set(devices.map((device) => device.id));
    const relatedDevices = await loadDevicesByIds(relatedDeviceIds.filter((deviceId) => !existingDeviceIds.has(deviceId)));
    const deviceMap = new Map([...devices, ...relatedDevices].map((device) => [device.id, device]));
    const cableDeviceIds = Array.from(new Set(connections.map((connection) => connection.cable_device_id).filter(Boolean)));
    const cableDeviceMap = new Map(cableDeviceIds.map((deviceId) => [deviceId, deviceMap.get(deviceId)]).filter(([, device]) => device));

    const matchesConnectionFilters = (item) => {
      const candidateDevices = [item.from_device, item.to_device, item.cable_device].filter(Boolean);
      if (projectId && !candidateDevices.some((device) => device.project_id === projectId) && item.route?.project_id !== projectId) return false;
      if (popId && !candidateDevices.some((device) => device.pop_id === popId) && item.route?.pop_id !== popId) return false;
      if (deviceTypeKey && !candidateDevices.some((device) => String(device.device_type_key || '').toUpperCase() === deviceTypeKey)) return false;
      if (tenantId && !candidateDevices.some((device) => device.tenant_id === tenantId)) return false;
      return true;
    };

    const mapDevices = devices.map(buildMapDeviceItem);
    const mapRoutes = routes
      .map((route) => buildMapRouteItem(route, deviceMap))
      .filter((route) => {
        if (!deviceTypeKey && !tenantId) return true;
        const routeDevices = [route.start_device, route.end_device].filter(Boolean);
        if (deviceTypeKey && !routeDevices.some((device) => String(device.device_type_key || '').toUpperCase() === deviceTypeKey)) return false;
        if (tenantId && !routeDevices.some((device) => device.tenant_id === tenantId)) return false;
        return true;
      });
    const mapConnections = connections
      .map((connection) => buildMapConnectionItem(connection, portMap, deviceMap, routeMap, cableDeviceMap))
      .filter(matchesConnectionFilters);

    const devicesWithoutCoordinates = mapDevices.filter((device) => !device.has_coordinates);
    const routesWithoutGeometry = mapRoutes.filter((route) => !route.has_geometry);
    const connectionsWithoutGeometryContext = mapConnections.filter((connection) => !connection.has_geometry_context);
    const fiberCutImpact = await buildFiberCutImpactLayer({
      connections: mapConnections,
      deviceMap,
      cutConnectionId,
      cutCableDeviceId,
    });

    return sendSuccess(
      res,
      {
        scope: {
          source: 'approved_inventory',
          role: req.auth.role,
          requested_region_id: requestedRegionId,
          effective_region_ids: allowedRegionIds.length ? allowedRegionIds : null,
          filters: {
            project_id: projectId,
            pop_id: popId,
            device_type_key: deviceTypeKey,
            tenant_id: tenantId,
            cut_connection_id: cutConnectionId,
            cut_cable_device_id: cutCableDeviceId,
          },
          limits: {
            devices: deviceLimit,
            routes: routeLimit,
            connections: connectionLimit,
          },
        },
        layers: {
          devices: {
            items: mapDevices,
            summary: {
              total: mapDevices.length,
              with_coordinates: mapDevices.length - devicesWithoutCoordinates.length,
              without_coordinates: devicesWithoutCoordinates.length,
              by_type: countBy(mapDevices, 'device_type_key'),
              by_status: countBy(mapDevices, 'status'),
              by_validation_status: countBy(mapDevices, 'validation_status'),
              by_marker_status: countBy(mapDevices, 'marker_status'),
            },
          },
          routes: {
            items: mapRoutes,
            summary: {
              total: mapRoutes.length,
              with_geometry: mapRoutes.length - routesWithoutGeometry.length,
              without_geometry: routesWithoutGeometry.length,
              by_type: countBy(mapRoutes, 'route_type'),
              by_status: countBy(mapRoutes, 'status'),
            },
          },
          connections: {
            items: mapConnections,
            summary: {
              total: mapConnections.length,
              with_route: mapConnections.filter((item) => item.route_id).length,
              with_cable: mapConnections.filter((item) => item.cable_device_id).length,
              with_core_range: mapConnections.filter((item) => item.core_start != null && item.core_end != null).length,
              with_geometry_context: mapConnections.length - connectionsWithoutGeometryContext.length,
              without_geometry_context: connectionsWithoutGeometryContext.length,
              by_type: countBy(mapConnections, 'connection_type'),
              by_status: countBy(mapConnections, 'status'),
            },
          },
          fiber_cut_impact: fiberCutImpact,
        },
        issues: {
          devices_without_coordinates: devicesWithoutCoordinates.slice(0, 100),
          routes_without_geometry: routesWithoutGeometry.slice(0, 100),
          connections_without_geometry_context: connectionsWithoutGeometryContext.slice(0, 100),
        },
        meta: {
          source: 'approved_inventory',
          generated_at: new Date().toISOString(),
        },
      },
      'Topology map layers fetched successfully',
    );
  } catch (error) {
    return next(error);
  }
});

resourceRouter.get('/topology/quality', authenticate, requireRole('admin', 'user_region', 'user_all_region'), async (req, res, next) => {
  try {
    const requestedRegionId = req.query.region_id ? String(req.query.region_id) : null;
    let regionWhere = {};
    const scope = getRegionalTopologyScope(req.auth);
    assertTopologyRegionAccess(scope, requestedRegionId);

    if (scope.isRegional) {
      regionWhere = requestedRegionId
        ? { region_id: { _eq: requestedRegionId } }
        : { region_id: { _in: scope.allowedRegionIds } };
    } else if (requestedRegionId) {
      regionWhere = { region_id: { _eq: requestedRegionId } };
    }

    const query = `
      query TopologyQuality(
        $portWhere: device_ports_bool_exp!
        $idlePortWhere: device_ports_bool_exp!
        $connectionWhere: port_connections_bool_exp!
        $fiberWhere: fiber_cores_bool_exp!
        $usedFiberWhere: fiber_cores_bool_exp!
        $orphanFiberWhere: fiber_cores_bool_exp!
        $inconsistentFiberWhere: fiber_cores_bool_exp!
      ) {
        ports: device_ports_aggregate(where: $portWhere) { aggregate { count } }
        idle_ports: device_ports_aggregate(where: $idlePortWhere) { aggregate { count } }
        connections: port_connections_aggregate(where: $connectionWhere) { aggregate { count } }
        fibers: fiber_cores_aggregate(where: $fiberWhere) { aggregate { count } }
        used_fibers: fiber_cores_aggregate(where: $usedFiberWhere) { aggregate { count } }
        orphan_fibers: fiber_cores_aggregate(where: $orphanFiberWhere) { aggregate { count } }
        inconsistent_fibers: fiber_cores_aggregate(where: $inconsistentFiberWhere) { aggregate { count } }
      }
    `;

    const andWhere = Object.keys(regionWhere).length ? [regionWhere] : [];
    const data = await executeHasura(query, {
      portWhere: andWhere.length ? { _and: andWhere } : {},
      idlePortWhere: { _and: [...andWhere, { status: { _eq: 'idle' } }] },
      connectionWhere: andWhere.length ? { _and: andWhere } : {},
      fiberWhere: andWhere.length ? { _and: andWhere } : {},
      usedFiberWhere: { _and: [...andWhere, { status: { _eq: 'used' } }] },
      orphanFiberWhere: {
        _and: [
          ...andWhere,
          { from_port_id: { _is_null: true } },
          { to_port_id: { _is_null: true } },
          { connection_id: { _is_null: true } },
        ],
      },
      inconsistentFiberWhere: {
        _and: [
          ...andWhere,
          { connection_id: { _is_null: false } },
          {
            _or: [
              { from_port_id: { _is_null: true } },
              { to_port_id: { _is_null: true } },
            ],
          },
        ],
      },
    });

    const payload = {
      scope: {
        role: req.auth.role,
        requested_region_id: requestedRegionId,
        effective_region_filter: regionWhere,
      },
      metrics: {
        total_ports: data.ports?.aggregate?.count || 0,
        idle_ports: data.idle_ports?.aggregate?.count || 0,
        total_connections: data.connections?.aggregate?.count || 0,
        total_fiber_cores: data.fibers?.aggregate?.count || 0,
        used_fiber_cores: data.used_fibers?.aggregate?.count || 0,
        orphan_fiber_cores: data.orphan_fibers?.aggregate?.count || 0,
        inconsistent_fiber_cores: data.inconsistent_fibers?.aggregate?.count || 0,
      },
    };

    return sendSuccess(res, payload, 'Topology quality fetched successfully');
  } catch (error) {
    return next(error);
  }
});

resourceRouter.get('/topology/integrity', authenticate, requireRole('admin', 'user_region', 'user_all_region'), async (req, res, next) => {
  try {
    const requestedRegionId = req.query.region_id ? String(req.query.region_id) : null;
    const scope = getRegionalTopologyScope(req.auth);
    assertTopologyRegionAccess(scope, requestedRegionId);
    const allowedRegionIds = scope.allowedRegionIds;
    const [connections, ports, fiberCores, deviceLinks, routes, devices] = await Promise.all([
      loadPortConnections({ allowedRegionIds, requestedRegionId }),
      loadPortsByRegion({ allowedRegionIds, requestedRegionId }),
      loadFiberCoresByRegion({ allowedRegionIds, requestedRegionId }),
      loadDeviceLinksByRegion({ allowedRegionIds, requestedRegionId, limit: 5000 }),
      loadRoutesByRegion({ allowedRegionIds, requestedRegionId }),
      loadDevicesByRegion({ allowedRegionIds, requestedRegionId }),
    ]);

    const connectionPortIds = Array.from(
      new Set(connections.flatMap((item) => [item.from_port_id, item.to_port_id]).filter(Boolean)),
    );
    const connectionPorts = await loadPortsByIds(connectionPortIds);
    const connectionPortMap = new Map(connectionPorts.map((port) => [port.id, port]));
    const portIdSet = new Set(connectionPorts.map((item) => item.id));
    const connectionIdSet = new Set(connections.map((item) => item.id));

    const orphanConnections = connections.filter((conn) => !portIdSet.has(conn.from_port_id) || !portIdSet.has(conn.to_port_id));
    const sameDeviceConnections = connections.filter((conn) => {
      const fromPort = connectionPortMap.get(conn.from_port_id);
      const toPort = connectionPortMap.get(conn.to_port_id);
      return fromPort && toPort && fromPort.device_id === toPort.device_id;
    });
    const crossRegionConnections = connections.filter((conn) => {
      const fromPort = connectionPortMap.get(conn.from_port_id);
      const toPort = connectionPortMap.get(conn.to_port_id);
      if (!fromPort || !toPort) return false;
      return fromPort.region_id !== toPort.region_id || conn.region_id !== fromPort.region_id || conn.region_id !== toPort.region_id;
    });
    const overlapConflicts = detectCoreOverlapConflicts(connections);
    const orphanFiberCores = fiberCores.filter((core) => core.connection_id && !connectionIdSet.has(core.connection_id));
    const overCapacityPorts = ports.filter((port) => {
      if (port.deleted_at) return false;
      const capacity = Number(port.core_capacity);
      const used = Number(port.core_used);
      if (!Number.isFinite(capacity) || capacity < 0) return false;
      if (!Number.isFinite(used) || used < 0) return false;
      return used > capacity;
    });
    const customerAssignedToNotUsedPorts = ports.filter((port) => (
      !port.deleted_at
      && port.customer_id
      && String(port.status || '').toLowerCase() !== 'used'
    ));
    const ontAssignments = ports.filter((port) => (
      !port.deleted_at
      && port.ont_device_id
      && !['idle', 'down'].includes(String(port.status || '').toLowerCase())
    ));
    const ontAssignmentCounts = ontAssignments.reduce((acc, port) => {
      acc[port.ont_device_id] = (acc[port.ont_device_id] || 0) + 1;
      return acc;
    }, {});
    const duplicateOntAssignments = ontAssignments.filter((port) => ontAssignmentCounts[port.ont_device_id] > 1);
    const routeWithoutEndpointAssets = routes.filter((route) => !route.start_asset_id || !route.end_asset_id);
    const portsByDevice = ports.reduce((acc, port) => {
      if (port.deleted_at) return acc;
      acc[port.device_id] = (acc[port.device_id] || 0) + 1;
      return acc;
    }, {});
    const odpDevices = devices.filter((device) => String(device.device_type_key || '').toUpperCase() === 'ODP');
    const odpInvalidSplitterRatios = odpDevices.filter((device) => device.splitter_ratio && !parseSplitterRatioPorts(device.splitter_ratio));
    const odpSplitterTotalPortMismatches = odpDevices.filter((device) => {
      const splitterPorts = parseSplitterRatioPorts(device.splitter_ratio);
      if (!splitterPorts || device.total_ports == null) return false;
      return Number(device.total_ports) !== splitterPorts;
    });
    const deviceActualPortMismatches = devices.filter((device) => {
      if (device.total_ports == null) return false;
      const actual = Number(portsByDevice[device.id] || 0);
      return actual !== Number(device.total_ports);
    });
    const fiberCoresByCable = fiberCores.reduce((acc, core) => {
      acc[core.cable_device_id] = (acc[core.cable_device_id] || 0) + 1;
      return acc;
    }, {});
    const cableDevices = devices.filter((device) => String(device.device_type_key || '').toUpperCase() === 'CABLE');
    const cableFiberCoreCountMismatches = cableDevices.filter((device) => {
      if (device.capacity_core == null) return false;
      const expected = Number(device.capacity_core);
      if (!Number.isInteger(expected) || expected < 0) return false;
      return Number(fiberCoresByCable[device.id] || 0) !== expected;
    });
    const fiberCoresMissingTubeColor = fiberCores.filter((core) => (
      core.tube_no == null
      || !core.tube_color_name
      || !core.tube_color_hex
    ));
    const fiberCoresMissingCoreColor = fiberCores.filter((core) => !core.color_name || !core.color_hex);
    const fiberCoreColorMismatches = detectFiberCoreColorMismatches(fiberCores);
    const fiberCoresLossWarnings = fiberCores.filter((core) => Number(core.last_loss_db) > 0.2);
    const damagedActiveFiberCores = fiberCores.filter((core) => (
      String(core.status || '').toLowerCase() === 'damaged'
      && (core.connection_id || core.from_port_id || core.to_port_id)
    ));
    const fiberCoreByCableCore = buildFiberCoreLookup(fiberCores);
    const activeCoreConnections = connections.filter((connection) => (
      ['active', 'cutover'].includes(String(connection.status || '').toLowerCase())
      && getConnectionCoreNumbers(connection).length > 0
    ));
    const activeCoreConnectionIds = new Set(activeCoreConnections.map((connection) => connection.id));
    const activeConnectionMissingFiberCores = [];
    const activeConnectionFiberCoreStatusMismatches = [];
    activeCoreConnections.forEach((connection) => {
      getConnectionCoreNumbers(connection).forEach((coreNo) => {
        const core = fiberCoreByCableCore.get(`${connection.cable_device_id}:${coreNo}`);
        if (!core) {
          activeConnectionMissingFiberCores.push({ connection, core_no: coreNo });
          return;
        }
        const coreStatus = String(core.status || '').toLowerCase();
        if (
          coreStatus !== 'used'
          || core.connection_id !== connection.id
          || core.from_port_id !== connection.from_port_id
          || core.to_port_id !== connection.to_port_id
        ) {
          activeConnectionFiberCoreStatusMismatches.push({ connection, core });
        }
      });
    });
    const usedFiberCoresWithoutActiveConnection = fiberCores.filter((core) => (
      String(core.status || '').toLowerCase() === 'used'
      && (!core.connection_id || !activeCoreConnectionIds.has(core.connection_id))
    ));
    const cableCapacityById = cableDevices.reduce((acc, device) => {
      const capacity = Number(device.capacity_core);
      if (Number.isInteger(capacity) && capacity >= 0) {
        acc[device.id] = capacity;
      }
      return acc;
    }, {});
    const fiberCoresOutOfCableCapacity = fiberCores.filter((core) => {
      const capacity = cableCapacityById[core.cable_device_id];
      if (capacity == null) return false;
      return Number(core.core_no) > capacity;
    });

    const transitioned = await loadDeviceLinkTransitionMapByLinkIds(deviceLinks.map((item) => item.id));
    const transitionedLinkIdSet = new Set(transitioned.map((item) => item.link_id));
    const pendingLegacyLinks = deviceLinks.filter((item) => !transitionedLinkIdSet.has(item.id));
    const issues = [];
    const addIssue = (type, severity, entityType, entityId, title, message, actionHint, extra = {}) => {
      issues.push({
        type,
        severity,
        entity_type: entityType,
        entity_id: entityId,
        title,
        message,
        action_hint: actionHint,
        ...extra,
      });
    };

    orphanConnections.forEach((item) => addIssue(
      'orphan_port_connection',
      'critical',
      'port_connection',
      item.id,
      'Port connection endpoint missing',
      'Connection references a from/to port that is not available in port inventory.',
      'Review the connection endpoints or archive the broken connection.',
      { connection_id: item.connection_id, from_port_id: item.from_port_id, to_port_id: item.to_port_id },
    ));
    sameDeviceConnections.forEach((item) => addIssue(
      'same_device_connection',
      'warning',
      'port_connection',
      item.id,
      'Connection uses ports on the same device',
      'The from/to ports belong to the same device, which is usually not a network topology edge.',
      'Check whether this should be an internal patch record or archive the connection.',
      { connection_id: item.connection_id, from_port_id: item.from_port_id, to_port_id: item.to_port_id },
    ));
    crossRegionConnections.forEach((item) => addIssue(
      'cross_region_connection',
      'critical',
      'port_connection',
      item.id,
      'Connection crosses region boundaries',
      'Connection region does not match one or both endpoint port regions.',
      'Move the connection to the correct region or recreate it with same-region ports.',
      { connection_id: item.connection_id, region_id: item.region_id, from_port_id: item.from_port_id, to_port_id: item.to_port_id },
    ));
    overlapConflicts.forEach((item) => addIssue(
      'overlap_core_conflict',
      'critical',
      'port_connection',
      item.connection_id || item.id || null,
      'Cable core range overlaps',
      'Two or more connections use an overlapping core range on the same cable.',
      'Adjust the cable core range so every connection owns a unique core span.',
      item,
    ));
    orphanFiberCores.forEach((item) => addIssue(
      'orphan_fiber_core',
      'warning',
      'fiber_core',
      item.id,
      'Fiber core points to missing connection',
      'Fiber core has a connection_id that is not found in active port connections.',
      'Clear the connection_id or restore the related port connection.',
      { cable_device_id: item.cable_device_id, core_no: item.core_no, connection_id: item.connection_id },
    ));
    overCapacityPorts.forEach((item) => addIssue(
      'port_over_capacity',
      'critical',
      'device_port',
      item.id,
      'Port core usage exceeds capacity',
      'Port core_used is greater than core_capacity.',
      'Review core usage calculation or reduce assigned connections.',
      { device_id: item.device_id, port_index: item.port_index, core_capacity: item.core_capacity, core_used: item.core_used },
    ));
    customerAssignedToNotUsedPorts.forEach((item) => addIssue(
      'customer_assigned_to_not_used_port',
      'warning',
      'device_port',
      item.id,
      'Customer assigned to non-used port',
      'Port has customer_id but status is not used.',
      'Set port status to used or release the customer assignment.',
      { device_id: item.device_id, port_index: item.port_index, status: item.status, customer_id: item.customer_id },
    ));
    duplicateOntAssignments.forEach((item) => addIssue(
      'duplicate_ont_assignment',
      'critical',
      'device_port',
      item.id,
      'ONT assigned to multiple active ports',
      'The same ONT device appears on more than one active port.',
      'Keep the ONT on one active port and release the duplicate assignment.',
      { device_id: item.device_id, port_index: item.port_index, ont_device_id: item.ont_device_id },
    ));
    routeWithoutEndpointAssets.forEach((item) => addIssue(
      'route_missing_endpoint_asset',
      'info',
      'network_route',
      item.id,
      'Route has missing start/end asset',
      'Route does not have both start_asset_id and end_asset_id filled.',
      'Complete route endpoints before using it for topology visualization.',
      { route_id: item.route_id, route_name: item.route_name, start_asset_id: item.start_asset_id, end_asset_id: item.end_asset_id },
    ));
    odpInvalidSplitterRatios.forEach((item) => addIssue(
      'odp_invalid_splitter_ratio',
      'warning',
      'device',
      item.id,
      'ODP splitter ratio format invalid',
      'ODP splitter_ratio cannot be parsed into output port capacity.',
      'Use splitter_ratio format like 1:8, 1:16, or 1/16.',
      { device_id: item.device_id, device_name: item.device_name, splitter_ratio: item.splitter_ratio },
    ));
    odpSplitterTotalPortMismatches.forEach((item) => addIssue(
      'odp_splitter_total_ports_mismatch',
      'critical',
      'device',
      item.id,
      'ODP splitter ratio does not match total ports',
      'The ODP splitter output capacity differs from devices.total_ports.',
      'Align total_ports with splitter_ratio before provisioning or validating the ODP.',
      {
        device_id: item.device_id,
        device_name: item.device_name,
        splitter_ratio: item.splitter_ratio,
        expected_total_ports: parseSplitterRatioPorts(item.splitter_ratio),
        total_ports: item.total_ports,
      },
    ));
    deviceActualPortMismatches.forEach((item) => addIssue(
      'device_actual_port_count_mismatch',
      'warning',
      'device',
      item.id,
      'Device port inventory does not match total_ports',
      'The actual active device_ports count differs from devices.total_ports.',
      'Run port provisioning or adjust total_ports after confirming device capacity.',
      {
        device_id: item.device_id,
        device_name: item.device_name,
        device_type_key: item.device_type_key,
        expected_total_ports: item.total_ports,
        actual_port_count: Number(portsByDevice[item.id] || 0),
      },
    ));
    cableFiberCoreCountMismatches.forEach((item) => addIssue(
      'cable_fiber_core_count_mismatch',
      'warning',
      'device',
      item.id,
      'Cable fiber core inventory does not match capacity_core',
      'The actual fiber_cores count differs from the cable device capacity_core.',
      'Run fiber core sync or adjust capacity_core after confirming physical cable capacity.',
      {
        device_id: item.device_id,
        device_name: item.device_name,
        expected_capacity_core: item.capacity_core,
        actual_fiber_core_count: Number(fiberCoresByCable[item.id] || 0),
      },
    ));
    fiberCoresMissingTubeColor.forEach((item) => addIssue(
      'fiber_core_missing_tube_color',
      'warning',
      'fiber_core',
      item.id,
      'Fiber core missing tube/color data',
      'Fiber core does not have complete tube number and tube color metadata.',
      'Run tray/tube/color backfill or resync the related cable device.',
      {
        cable_device_id: item.cable_device_id,
        core_no: item.core_no,
        tube_no: item.tube_no,
        tube_color_name: item.tube_color_name,
      },
    ));
    fiberCoresMissingCoreColor.forEach((item) => addIssue(
      'fiber_core_missing_core_color',
      'warning',
      'fiber_core',
      item.id,
      'Fiber core missing core color data',
      'Fiber core does not have complete core color metadata.',
      'Run core color backfill or resync the related cable device.',
      {
        cable_device_id: item.cable_device_id,
        core_no: item.core_no,
        color_name: item.color_name,
      },
    ));
    fiberCoreColorMismatches.forEach((item) => {
      const expected = buildFiberCorePhysicalFields(item.core_no, { coresPerTube: item.cores_per_tube });
      addIssue(
        'fiber_core_color_mismatch',
        'warning',
        'fiber_core',
        item.id,
        'Fiber core color does not match standard',
        'Fiber core tube/core color differs from the configured 12-color cycle.',
        'Run tray/tube/color backfill or correct the fiber core color metadata after confirming physical cable standard.',
        {
          cable_device_id: item.cable_device_id,
          core_no: item.core_no,
          actual: {
            tube_no: item.tube_no,
            tube_color_name: item.tube_color_name,
            tube_color_hex: item.tube_color_hex,
            color_name: item.color_name,
            color_hex: item.color_hex,
          },
          expected,
        },
      );
    });
    fiberCoresLossWarnings.forEach((item) => addIssue(
      'fiber_core_loss_warning',
      'warning',
      'fiber_core',
      item.id,
      'Fiber core attenuation exceeds threshold',
      'The last recorded loss is greater than the operational warning threshold.',
      'Review the measurement evidence and schedule field recheck if needed.',
      {
        cable_device_id: item.cable_device_id,
        core_no: item.core_no,
        last_loss_db: item.last_loss_db,
        last_loss_measured_at: item.last_loss_measured_at,
        last_loss_method: item.last_loss_method,
      },
    ));
    damagedActiveFiberCores.forEach((item) => addIssue(
      'damaged_fiber_core_active_connection',
      'critical',
      'fiber_core',
      item.id,
      'Damaged fiber core is still connected',
      'A fiber core marked damaged still has an active connection or endpoint mapping.',
      'Move traffic to another core or clear the active mapping after approval.',
      {
        cable_device_id: item.cable_device_id,
        core_no: item.core_no,
        connection_id: item.connection_id,
        from_port_id: item.from_port_id,
        to_port_id: item.to_port_id,
      },
    ));
    activeConnectionMissingFiberCores.forEach((item) => addIssue(
      'active_connection_missing_fiber_core',
      'critical',
      'port_connection',
      item.connection.id,
      'Active connection references missing fiber core',
      'Connection has a cable/core range, but one or more fiber_cores rows do not exist for that range.',
      'Run fiber core sync for the related cable or correct the connection core range.',
      {
        connection_id: item.connection.connection_id,
        cable_device_id: item.connection.cable_device_id,
        core_no: item.core_no,
        core_start: item.connection.core_start,
        core_end: item.connection.core_end,
      },
    ));
    activeConnectionFiberCoreStatusMismatches.forEach((item) => addIssue(
      'active_connection_fiber_core_status_mismatch',
      'warning',
      'fiber_core',
      item.core.id,
      'Active connection core status is not synchronized',
      'An active/cutover connection uses this core, but fiber_cores status or endpoint mapping is not aligned.',
      'Run fiber core status sync after confirming the active connection is correct.',
      {
        connection_id: item.connection.connection_id,
        connection_uuid: item.connection.id,
        cable_device_id: item.connection.cable_device_id,
        core_no: item.core.core_no,
        fiber_core_status: item.core.status,
        fiber_core_connection_id: item.core.connection_id,
      },
    ));
    usedFiberCoresWithoutActiveConnection.forEach((item) => addIssue(
      'used_fiber_core_without_active_connection',
      'warning',
      'fiber_core',
      item.id,
      'Fiber core is marked used without active connection',
      'Fiber core status is used, but it is not tied to an active/cutover port connection.',
      'Release the core to available or restore the related active connection after checking inventory evidence.',
      {
        cable_device_id: item.cable_device_id,
        core_no: item.core_no,
        connection_id: item.connection_id,
      },
    ));
    fiberCoresOutOfCableCapacity.forEach((item) => addIssue(
      'fiber_core_out_of_cable_capacity',
      'critical',
      'fiber_core',
      item.id,
      'Fiber core number exceeds cable capacity',
      'Fiber core core_no is greater than the related cable device capacity_core.',
      'Adjust capacity_core or archive the over-capacity core after confirming the physical cable.',
      {
        cable_device_id: item.cable_device_id,
        core_no: item.core_no,
        capacity_core: cableCapacityById[item.cable_device_id],
      },
    ));
    pendingLegacyLinks.forEach((item) => addIssue(
      'pending_legacy_device_link',
      'info',
      'device_link',
      item.id,
      'Legacy device link not migrated',
      'Legacy device_links row has not been mapped into port_connections yet.',
      'Run transition dry-run/apply after confirming source and target ports.',
      { from_device_id: item.from_device_id, to_device_id: item.to_device_id, link_type: item.link_type },
    ));
    const issueSummary = issues.reduce((acc, issue) => {
      acc.total += 1;
      acc.by_severity[issue.severity] = (acc.by_severity[issue.severity] || 0) + 1;
      acc.by_type[issue.type] = (acc.by_type[issue.type] || 0) + 1;
      return acc;
    }, { total: 0, by_severity: {}, by_type: {} });

    return sendSuccess(
      res,
      {
        scope: {
          role: req.auth.role,
          requested_region_id: requestedRegionId,
          effective_regions: allowedRegionIds.length ? allowedRegionIds : null,
        },
        metrics: {
          overlap_core_conflicts: overlapConflicts.length,
          orphan_port_connections: orphanConnections.length,
          same_device_connections: sameDeviceConnections.length,
          cross_region_connections: crossRegionConnections.length,
          orphan_fiber_cores: orphanFiberCores.length,
          over_capacity_ports: overCapacityPorts.length,
          customer_assigned_to_not_used_ports: customerAssignedToNotUsedPorts.length,
          duplicate_ont_assignments: duplicateOntAssignments.length,
          routes_missing_endpoint_assets: routeWithoutEndpointAssets.length,
          odp_invalid_splitter_ratios: odpInvalidSplitterRatios.length,
          odp_splitter_total_port_mismatches: odpSplitterTotalPortMismatches.length,
          device_actual_port_count_mismatches: deviceActualPortMismatches.length,
          cable_fiber_core_count_mismatches: cableFiberCoreCountMismatches.length,
          fiber_cores_missing_tube_color: fiberCoresMissingTubeColor.length,
          fiber_cores_missing_core_color: fiberCoresMissingCoreColor.length,
          fiber_core_color_mismatches: fiberCoreColorMismatches.length,
          fiber_cores_loss_warnings: fiberCoresLossWarnings.length,
          damaged_active_fiber_cores: damagedActiveFiberCores.length,
          active_connection_missing_fiber_cores: activeConnectionMissingFiberCores.length,
          active_connection_fiber_core_status_mismatches: activeConnectionFiberCoreStatusMismatches.length,
          used_fiber_cores_without_active_connection: usedFiberCoresWithoutActiveConnection.length,
          fiber_cores_out_of_cable_capacity: fiberCoresOutOfCableCapacity.length,
          pending_legacy_device_links: pendingLegacyLinks.length,
        },
        issue_summary: issueSummary,
        issues,
        samples: {
          overlap_core_conflicts: overlapConflicts.slice(0, 25),
          orphan_port_connections: orphanConnections.slice(0, 25).map((item) => ({
            id: item.id,
            from_port_id: item.from_port_id,
            to_port_id: item.to_port_id,
            cable_device_id: item.cable_device_id,
            core_start: item.core_start,
            core_end: item.core_end,
          })),
          cross_region_connections: crossRegionConnections.slice(0, 25).map((item) => ({
            id: item.id,
            connection_id: item.connection_id,
            region_id: item.region_id,
            from_port_id: item.from_port_id,
            to_port_id: item.to_port_id,
          })),
          orphan_fiber_cores: orphanFiberCores.slice(0, 25).map((item) => ({
            id: item.id,
            cable_device_id: item.cable_device_id,
            core_no: item.core_no,
            connection_id: item.connection_id,
          })),
          customer_assigned_to_not_used_ports: customerAssignedToNotUsedPorts.slice(0, 25).map((item) => ({
            id: item.id,
            device_id: item.device_id,
            port_index: item.port_index,
            status: item.status,
            customer_id: item.customer_id,
          })),
          duplicate_ont_assignments: duplicateOntAssignments.slice(0, 25).map((item) => ({
            id: item.id,
            device_id: item.device_id,
            port_index: item.port_index,
            status: item.status,
            ont_device_id: item.ont_device_id,
          })),
          routes_missing_endpoint_assets: routeWithoutEndpointAssets.slice(0, 25).map((item) => ({
            id: item.id,
            route_id: item.route_id,
            route_name: item.route_name,
            start_asset_id: item.start_asset_id,
            end_asset_id: item.end_asset_id,
          })),
          odp_invalid_splitter_ratios: odpInvalidSplitterRatios.slice(0, 25).map((item) => ({
            id: item.id,
            device_id: item.device_id,
            device_name: item.device_name,
            splitter_ratio: item.splitter_ratio,
          })),
          odp_splitter_total_port_mismatches: odpSplitterTotalPortMismatches.slice(0, 25).map((item) => ({
            id: item.id,
            device_id: item.device_id,
            device_name: item.device_name,
            splitter_ratio: item.splitter_ratio,
            expected_total_ports: parseSplitterRatioPorts(item.splitter_ratio),
            total_ports: item.total_ports,
          })),
          device_actual_port_count_mismatches: deviceActualPortMismatches.slice(0, 25).map((item) => ({
            id: item.id,
            device_id: item.device_id,
            device_name: item.device_name,
            device_type_key: item.device_type_key,
            expected_total_ports: item.total_ports,
            actual_port_count: Number(portsByDevice[item.id] || 0),
          })),
          cable_fiber_core_count_mismatches: cableFiberCoreCountMismatches.slice(0, 25).map((item) => ({
            id: item.id,
            device_id: item.device_id,
            device_name: item.device_name,
            expected_capacity_core: item.capacity_core,
            actual_fiber_core_count: Number(fiberCoresByCable[item.id] || 0),
          })),
          fiber_cores_missing_tube_color: fiberCoresMissingTubeColor.slice(0, 25).map((item) => ({
            id: item.id,
            cable_device_id: item.cable_device_id,
            core_no: item.core_no,
            tube_no: item.tube_no,
            tube_color_name: item.tube_color_name,
          })),
          fiber_cores_missing_core_color: fiberCoresMissingCoreColor.slice(0, 25).map((item) => ({
            id: item.id,
            cable_device_id: item.cable_device_id,
            core_no: item.core_no,
            color_name: item.color_name,
          })),
          fiber_core_color_mismatches: fiberCoreColorMismatches.slice(0, 25).map((item) => ({
            id: item.id,
            cable_device_id: item.cable_device_id,
            core_no: item.core_no,
            actual_tube_no: item.tube_no,
            actual_tube_color_name: item.tube_color_name,
            actual_color_name: item.color_name,
            expected: buildFiberCorePhysicalFields(item.core_no, { coresPerTube: item.cores_per_tube }),
          })),
          fiber_cores_loss_warnings: fiberCoresLossWarnings.slice(0, 25).map((item) => ({
            id: item.id,
            cable_device_id: item.cable_device_id,
            core_no: item.core_no,
            last_loss_db: item.last_loss_db,
            last_loss_measured_at: item.last_loss_measured_at,
          })),
          damaged_active_fiber_cores: damagedActiveFiberCores.slice(0, 25).map((item) => ({
            id: item.id,
            cable_device_id: item.cable_device_id,
            core_no: item.core_no,
            connection_id: item.connection_id,
          })),
          active_connection_missing_fiber_cores: activeConnectionMissingFiberCores.slice(0, 25).map((item) => ({
            connection_id: item.connection.connection_id,
            connection_uuid: item.connection.id,
            cable_device_id: item.connection.cable_device_id,
            core_no: item.core_no,
            core_start: item.connection.core_start,
            core_end: item.connection.core_end,
          })),
          active_connection_fiber_core_status_mismatches: activeConnectionFiberCoreStatusMismatches.slice(0, 25).map((item) => ({
            fiber_core_id: item.core.id,
            connection_id: item.connection.connection_id,
            connection_uuid: item.connection.id,
            cable_device_id: item.connection.cable_device_id,
            core_no: item.core.core_no,
            fiber_core_status: item.core.status,
            fiber_core_connection_id: item.core.connection_id,
          })),
          used_fiber_cores_without_active_connection: usedFiberCoresWithoutActiveConnection.slice(0, 25).map((item) => ({
            id: item.id,
            cable_device_id: item.cable_device_id,
            core_no: item.core_no,
            connection_id: item.connection_id,
          })),
          fiber_cores_out_of_cable_capacity: fiberCoresOutOfCableCapacity.slice(0, 25).map((item) => ({
            id: item.id,
            cable_device_id: item.cable_device_id,
            core_no: item.core_no,
            capacity_core: cableCapacityById[item.cable_device_id],
          })),
          pending_legacy_device_links: pendingLegacyLinks.slice(0, 25).map((item) => ({
            id: item.id,
            from_device_id: item.from_device_id,
            to_device_id: item.to_device_id,
            link_type: item.link_type,
            cable_device_id: item.cable_device_id,
            core_start: item.core_start,
            core_end: item.core_end,
          })),
        },
      },
      'Topology integrity report fetched successfully',
    );
  } catch (error) {
    return next(error);
  }
});

resourceRouter.post('/topology/transition/device-links', authenticate, requireRole('admin', 'user_region', 'user_all_region'), async (req, res, next) => {
  try {
    const requestedRegionId = req.body?.region_id ? String(req.body.region_id) : null;
    const apply = String(req.body?.apply || '').toLowerCase() === 'true';
    const limit = Math.min(Math.max(Number(req.body?.limit) || 200, 1), 1000);

    const scope = getRegionalTopologyScope(req.auth);
    assertTopologyRegionAccess(scope, requestedRegionId);
    const allowedRegionIds = scope.allowedRegionIds;
    const links = await loadDeviceLinksByRegion({ allowedRegionIds, requestedRegionId, limit });
    if (!links.length) {
      return sendSuccess(res, { apply, processed: 0, migrated: 0, skipped: 0, items: [] }, 'No legacy device links to process');
    }

    const existingMap = await loadDeviceLinkTransitionMapByLinkIds(links.map((item) => item.id));
    const migratedLinkIds = new Set(existingMap.map((item) => item.link_id));
    const targetLinks = links.filter((item) => !migratedLinkIds.has(item.id));
    const deviceIds = Array.from(new Set(targetLinks.flatMap((item) => [item.from_device_id, item.to_device_id]).filter(Boolean)));
    const allPorts = await loadPortsByDeviceIds(deviceIds);
    const portsByDevice = allPorts.reduce((acc, row) => {
      if (!acc[row.device_id]) acc[row.device_id] = [];
      acc[row.device_id].push(row);
      return acc;
    }, {});

    const candidates = targetLinks.map((link) => {
      const fromPorts = portsByDevice[link.from_device_id] || [];
      const toPorts = portsByDevice[link.to_device_id] || [];
      const fromPort = pickTransitionPort(fromPorts, link.link_type === 'fiber' ? 'fiber' : 'ethernet');
      const toPort = pickTransitionPort(toPorts, link.link_type === 'fiber' ? 'fiber' : 'ethernet');

      if (!fromPort || !toPort) {
        return {
          link_id: link.id,
          status: 'skipped',
          reason: 'missing_port_inventory',
        };
      }

      return {
        link_id: link.id,
        status: 'ready',
        payload: {
          region_id: link.region_id,
          from_port_id: fromPort.id,
          to_port_id: toPort.id,
          connection_type: normalizeLegacyLinkTypeToConnectionType(link.link_type),
          status: link.status || 'planned',
          route_id: link.route_id || null,
          cable_device_id: link.cable_device_id || null,
          core_start: link.core_start ?? null,
          core_end: link.core_end ?? null,
          fiber_count: link.fiber_count ?? null,
          notes: `${link.notes || ''} [migrated_from_device_link:${link.id}]`.trim(),
        },
      };
    });

    if (!apply) {
      const ready = candidates.filter((item) => item.status === 'ready').length;
      return sendSuccess(
        res,
        {
          apply,
          processed: candidates.length,
          ready,
          skipped: candidates.length - ready,
          items: candidates,
        },
        'Legacy device link transition dry-run completed',
      );
    }

    const readyCandidates = candidates.filter((item) => item.status === 'ready');
    if (!readyCandidates.length) {
      return sendSuccess(
        res,
        {
          apply,
          processed: candidates.length,
          migrated: 0,
          skipped: candidates.length,
          items: candidates,
        },
        'No eligible links were migrated',
      );
    }

    const insertConnectionsMutation = `
      mutation InsertPortConnections($objects: [port_connections_insert_input!]!) {
        inserted: insert_port_connections(objects: $objects) {
          returning {
            id
            notes
          }
        }
      }
    `;
    const insertedConnections = await executeHasura(insertConnectionsMutation, {
      objects: readyCandidates.map((item) => item.payload),
    });
    const rows = insertedConnections.inserted?.returning || [];

    const mappingObjects = rows
      .map((row) => ({
        link_id: parseMigratedLinkIdFromNotes(row.notes),
        connection_id: row.id,
      }))
      .filter((item) => item.link_id && item.connection_id)
      .map((item) => ({
        link_id: item.link_id,
        connection_id: item.connection_id,
        migration_mode: 'auto',
        migration_notes: 'Auto migrated from legacy device_links',
        migrated_by_user_id: req.auth.appUser.id,
      }));

    if (mappingObjects.length) {
      const mappingMutation = `
        mutation InsertTransitionMap($objects: [device_link_transition_map_insert_input!]!) {
          inserted: insert_device_link_transition_map(
            objects: $objects
            on_conflict: {
              constraint: device_link_transition_map_link_id_key
              update_columns: [connection_id, migration_mode, migration_notes, migrated_by_user_id, migrated_at, updated_at]
            }
          ) {
            affected_rows
          }
        }
      `;
      await executeHasura(mappingMutation, { objects: mappingObjects });
    }

    await createAuditLog({
      actorUserId: req.auth.appUser.id,
      actionName: 'transition:device_links_to_port_connections',
      entityType: 'topology',
      entityId: requestedRegionId || null,
      beforeData: { candidate_count: candidates.length },
      afterData: { migrated_count: mappingObjects.length },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return sendSuccess(
      res,
      {
        apply,
        processed: candidates.length,
        migrated: mappingObjects.length,
        skipped: candidates.length - readyCandidates.length,
        items: candidates,
      },
      'Legacy device links migrated to port connections',
    );
  } catch (error) {
    return next(error);
  }
});

resourceRouter.get('/topology/trace', authenticate, requireRole('admin', 'user_region', 'user_all_region'), async (req, res, next) => {
  try {
    const startDeviceId = String(req.query.start_device_id || req.query.from_device_id || req.query.device_id || '').trim();
    const startPortId = String(req.query.start_port_id || req.query.from_port_id || req.query.port_id || '').trim();
    const startCustomerId = String(req.query.start_customer_id || req.query.from_customer_id || req.query.customer_id || '').trim();
    const endDeviceId = String(req.query.end_device_id || req.query.to_device_id || '').trim();
    const endPortId = String(req.query.end_port_id || req.query.to_port_id || '').trim();
    const endCustomerId = String(req.query.end_customer_id || req.query.to_customer_id || '').trim();
    const requestedRegionId = req.query.region_id ? String(req.query.region_id) : null;
    const maxDepth = Math.min(Math.max(Number(req.query.max_depth) || 12, 1), 64);
    const direction = ['upstream', 'downstream', 'both'].includes(String(req.query.direction || '').toLowerCase())
      ? String(req.query.direction).toLowerCase()
      : 'both';
    const targetRequested = Boolean(endDeviceId || endPortId || endCustomerId);

    if (!startDeviceId && !startPortId && !startCustomerId) {
      throw createHttpError(400, 'device_id, port_id, or customer_id is required');
    }

    const [startEndpoint, endEndpoint] = await Promise.all([
      resolveTraceEndpoint({
        deviceId: startDeviceId,
        portId: startDeviceId ? null : startPortId,
        customerId: startDeviceId || startPortId ? null : startCustomerId,
        label: 'Start',
      }),
      resolveTraceEndpoint({
        deviceId: endDeviceId,
        portId: endDeviceId ? null : endPortId,
        customerId: endDeviceId || endPortId ? null : endCustomerId,
        label: 'End',
      }),
    ]);
    const startDevice = startEndpoint?.device || null;
    const endDevice = endEndpoint?.device || null;
    const resolvedStartDeviceId = startDevice?.id || null;
    const resolvedEndDeviceId = endDevice?.id || null;

    const scope = getRegionalTopologyScope(req.auth);
    if (startDevice) assertTopologyRegionAccess(scope, startDevice.region_id, 'You do not have access to the start device region');
    if (endDevice) assertTopologyRegionAccess(scope, endDevice.region_id, 'You do not have access to the end device region');
    assertTopologyRegionAccess(scope, requestedRegionId);

    if (!startDevice) {
      return sendSuccess(
        res,
        {
          request: {
            start: startEndpoint,
            end: endEndpoint,
            direction,
            region_id: requestedRegionId,
            max_depth: maxDepth,
          },
          graph: { nodes: [], edges: [] },
          trace: {
            found: false,
            hop_count: 0,
            path: [],
            warnings: startEndpoint?.warnings || ['Start endpoint cannot be traced'],
          },
        },
        'Topology trace fetched successfully',
      );
    }

    const allowedRegionIds = scope.allowedRegionIds;
    const connections = await loadPortConnections({ allowedRegionIds, requestedRegionId });
    const portIds = Array.from(
      new Set(
        connections
          .flatMap((item) => [item.from_port_id, item.to_port_id])
          .filter(Boolean),
      ),
    );
    const ports = await loadPortsByIds(portIds);
    const portMap = new Map(ports.map((port) => [port.id, port]));

    const graphEdges = [];
    const undirectedAdjacency = new Map();
    const upstreamAdjacency = new Map();
    const downstreamAdjacency = new Map();

    for (const connection of connections) {
      const fromPort = portMap.get(connection.from_port_id);
      const toPort = portMap.get(connection.to_port_id);
      if (!fromPort || !toPort) continue;

      const fromDeviceId = fromPort.device_id;
      const toDeviceId = toPort.device_id;
      if (!fromDeviceId || !toDeviceId) continue;

      const edge = {
        id: connection.id,
        connection_id: connection.connection_id,
        region_id: connection.region_id,
        from_device_id: fromDeviceId,
        to_device_id: toDeviceId,
        from_port_id: fromPort.id,
        to_port_id: toPort.id,
        from_port_label: fromPort.port_label,
        to_port_label: toPort.port_label,
        connection_type: connection.connection_type,
        status: connection.status,
        route_id: connection.route_id,
        cable_device_id: connection.cable_device_id,
        core_start: connection.core_start,
        core_end: connection.core_end,
        fiber_count: connection.fiber_count,
      };
      graphEdges.push(edge);

      if (!undirectedAdjacency.has(fromDeviceId)) undirectedAdjacency.set(fromDeviceId, []);
      if (!undirectedAdjacency.has(toDeviceId)) undirectedAdjacency.set(toDeviceId, []);
      undirectedAdjacency.get(fromDeviceId).push({ next: toDeviceId, edgeId: edge.id });
      undirectedAdjacency.get(toDeviceId).push({ next: fromDeviceId, edgeId: edge.id });

      if (!downstreamAdjacency.has(fromDeviceId)) downstreamAdjacency.set(fromDeviceId, []);
      if (!upstreamAdjacency.has(toDeviceId)) upstreamAdjacency.set(toDeviceId, []);
      downstreamAdjacency.get(fromDeviceId).push({ next: toDeviceId, edgeId: edge.id });
      upstreamAdjacency.get(toDeviceId).push({ next: fromDeviceId, edgeId: edge.id });
    }

    const adjacency = direction === 'upstream'
      ? upstreamAdjacency
      : direction === 'downstream'
        ? downstreamAdjacency
        : undirectedAdjacency;
    const visited = new Set([resolvedStartDeviceId]);
    const queue = [{ id: resolvedStartDeviceId, depth: 0 }];
    const parent = new Map();
    let endFound = targetRequested ? false : true;

    while (queue.length) {
      const current = queue.shift();
      if (current.depth >= maxDepth) continue;
      const neighbors = adjacency.get(current.id) || [];

      for (const neighbor of neighbors) {
        if (visited.has(neighbor.next)) continue;
        visited.add(neighbor.next);
        parent.set(neighbor.next, { prev: current.id, edgeId: neighbor.edgeId });
        if (resolvedEndDeviceId && neighbor.next === resolvedEndDeviceId) {
          endFound = true;
          queue.length = 0;
          break;
        }
        queue.push({ id: neighbor.next, depth: current.depth + 1 });
      }
    }

    const deviceIds = Array.from(visited);
    const devices = await loadDevicesByIds(deviceIds);
    const devicesMap = new Map(devices.map((device) => [device.id, device]));

    const relevantEdgeIds = new Set();
    if (resolvedEndDeviceId && endFound) {
      let cursor = resolvedEndDeviceId;
      while (cursor !== resolvedStartDeviceId) {
        const info = parent.get(cursor);
        if (!info) break;
        relevantEdgeIds.add(info.edgeId);
        cursor = info.prev;
      }
    } else {
      graphEdges.forEach((edge) => {
        if (visited.has(edge.from_device_id) && visited.has(edge.to_device_id)) {
          relevantEdgeIds.add(edge.id);
        }
      });
    }

    const filteredEdges = graphEdges.filter((edge) => relevantEdgeIds.has(edge.id));
    const fiberCores = await loadFiberCoresByConnectionIds(filteredEdges.map((edge) => edge.id));
    const routeIds = Array.from(new Set(filteredEdges.map((edge) => edge.route_id).filter(Boolean)));
    const cableDeviceIds = Array.from(new Set(filteredEdges.map((edge) => edge.cable_device_id).filter(Boolean)));
    const [routes, cableDevices] = await Promise.all([
      loadRoutesByIds(routeIds),
      loadDevicesByIds(cableDeviceIds),
    ]);
    const routeMap = new Map(routes.map((route) => [route.id, route]));
    const cableDeviceMap = new Map(cableDevices.map((device) => [device.id, device]));
    const fiberByConnection = fiberCores.reduce((acc, item) => {
      const key = item.connection_id;
      if (!key) return acc;
      if (!acc[key]) {
        acc[key] = { total: 0, used: 0, statuses: {}, colors: {}, tube_colors: {}, loss_warnings: 0 };
      }
      acc[key].total += 1;
      if (item.status === 'used') acc[key].used += 1;
      acc[key].statuses[item.status] = (acc[key].statuses[item.status] || 0) + 1;
      if (item.color_name) {
        acc[key].colors[item.color_name] = (acc[key].colors[item.color_name] || 0) + 1;
      }
      if (item.tube_color_name) {
        acc[key].tube_colors[item.tube_color_name] = (acc[key].tube_colors[item.tube_color_name] || 0) + 1;
      }
      if (Number(item.last_loss_db) > 0.2) acc[key].loss_warnings += 1;
      return acc;
    }, {});

    const edges = filteredEdges.map((edge) => {
      const fromPort = portMap.get(edge.from_port_id) || null;
      const toPort = portMap.get(edge.to_port_id) || null;
      const fromDevice = devicesMap.get(edge.from_device_id) || null;
      const toDevice = devicesMap.get(edge.to_device_id) || null;
      const route = routeMap.get(edge.route_id) || null;
      const cableDevice = cableDeviceMap.get(edge.cable_device_id) || null;
      return {
        ...edge,
        from_port: fromPort ? { ...fromPort, device: fromDevice } : null,
        to_port: toPort ? { ...toPort, device: toDevice } : null,
        from_device: fromDevice,
        to_device: toDevice,
        route,
        cable_device: cableDevice,
        labels: buildPortConnectionLabel(edge, fromPort ? { ...fromPort, device: fromDevice } : null, toPort ? { ...toPort, device: toDevice } : null, cableDevice, route),
        fiber_cores: fiberByConnection[edge.id] || { total: 0, used: 0, statuses: {}, colors: {}, tube_colors: {}, loss_warnings: 0 },
      };
    });

    const nodes = Array.from(
      new Set([resolvedStartDeviceId, ...edges.flatMap((edge) => [edge.from_device_id, edge.to_device_id]).filter(Boolean)]),
    )
      .map((id) => devicesMap.get(id))
      .filter(Boolean);

    const path = [];
    if (resolvedEndDeviceId && endFound) {
      let cursor = resolvedEndDeviceId;
      const reversed = [cursor];
      while (cursor !== resolvedStartDeviceId) {
        const info = parent.get(cursor);
        if (!info) break;
        cursor = info.prev;
        reversed.push(cursor);
      }
      reversed.reverse().forEach((id) => {
        const node = devicesMap.get(id);
        path.push({
          id,
          device_id: node?.device_id || null,
          device_name: node?.device_name || null,
          device_type_key: node?.device_type_key || null,
        });
      });
    }

    return sendSuccess(
      res,
      {
        request: {
          start: {
            type: startEndpoint.type,
            device_id: resolvedStartDeviceId,
            port_id: startEndpoint.port?.id || null,
            customer_id: startEndpoint.customer?.id || null,
          },
          end: endEndpoint
            ? {
              type: endEndpoint.type,
              device_id: resolvedEndDeviceId,
              port_id: endEndpoint.port?.id || null,
              customer_id: endEndpoint.customer?.id || null,
            }
            : null,
          direction,
          region_id: requestedRegionId,
          max_depth: maxDepth,
        },
        graph: {
          nodes,
          edges,
        },
        trace: {
          found: endFound,
          hop_count: path.length ? Math.max(0, path.length - 1) : 0,
          path,
          warnings: [
            ...(startEndpoint.warnings || []),
            ...(endEndpoint?.warnings || []),
          ],
        },
      },
      'Topology trace fetched successfully',
    );
  } catch (error) {
    return next(error);
  }
});

resourceRouter.get('/qr-label-settings', authenticate, requireRole('admin', 'user_all_region'), async (_req, res, next) => {
  try {
    const setting = await getQrLabelSetting();
    return sendSuccess(res, setting, 'QR label settings fetched successfully');
  } catch (error) {
    return next(createHttpError(error.statusCode || 500, error.message || 'QR label settings fetch failed', error.details));
  }
});

resourceRouter.patch('/qr-label-settings', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const before = await getQrLabelSetting();
    const footerText = String(req.body.footer_text || DEFAULT_QR_LABEL_FOOTER).trim() || DEFAULT_QR_LABEL_FOOTER;
    const resetLogo = Boolean(req.body.reset_logo);
    const logoAttachmentId = resetLogo ? null : normalizeNullableUuid(req.body.qr_logo_attachment_id);

    if (logoAttachmentId) {
      const attachment = await loadAttachmentById(logoAttachmentId);
      if (!attachment) {
        throw createHttpError(404, 'QR logo attachment not found');
      }
      if (!String(attachment.mime_type || '').toLowerCase().startsWith('image/')) {
        throw createHttpError(400, 'QR logo must be an image file');
      }
      const maxImageSize = env.imageUploadMaxSizeMb * 1024 * 1024;
      if (Number(attachment.size_bytes || 0) > maxImageSize) {
        throw createHttpError(400, `QR logo exceeds ${env.imageUploadMaxSizeMb}MB image limit`);
      }
    }

    await executeHasuraSql(`
      insert into public.qr_label_settings (
        setting_key,
        qr_logo_attachment_id,
        footer_text,
        is_active,
        updated_by_user_id
      )
      values (
        'default',
        ${logoAttachmentId ? `${sqlLiteral(logoAttachmentId)}::uuid` : 'null'},
        ${sqlLiteral(footerText)},
        ${sqlBoolean(req.body.is_active)},
        ${sqlLiteral(req.auth.appUser.id)}::uuid
      )
      on conflict (setting_key)
      do update set
        qr_logo_attachment_id = excluded.qr_logo_attachment_id,
        footer_text = excluded.footer_text,
        is_active = excluded.is_active,
        updated_by_user_id = excluded.updated_by_user_id,
        updated_at = now();
    `);

    const after = await getQrLabelSetting();
    await createAuditLog({
      actorUserId: req.auth.appUser.id,
      actionName: 'qr_label_settings.updated',
      entityType: 'qr_label_settings',
      entityId: after.id,
      beforeData: before,
      afterData: after,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || null,
    });

    return sendSuccess(res, after, 'QR label settings updated successfully');
  } catch (error) {
    return next(createHttpError(error.statusCode || 500, error.message || 'QR label settings update failed', error.details));
  }
});

resourceRouter.post('/attachments/upload', authenticate, requireRole('admin', 'user_region', 'user_all_region'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      throw createHttpError(400, 'file is required');
    }

    const fileCategory = String(req.body.file_category || 'document').toLowerCase();
    if (fileCategory === 'image') {
      const maxImageSize = env.imageUploadMaxSizeMb * 1024 * 1024;
      if (req.file.size > maxImageSize) {
        throw createHttpError(400, `Image file exceeds ${env.imageUploadMaxSizeMb}MB limit`);
      }
    }

    const bucketId = req.body.bucket_id || env.defaultStorageBucket;
    const formData = new FormData();
    formData.append('file[]', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype,
    });
    formData.append('bucket-id', bucketId);

    const uploadResponse = await nhostStorageClient.post('/files', formData, {
      headers: {
        ...formData.getHeaders(),
        Authorization: `Bearer ${req.auth.token}`,
      },
    });

    const storageFile = uploadResponse.data?.processedFiles?.[0] || uploadResponse.data;
    const extension = req.file.originalname.includes('.') ? req.file.originalname.split('.').pop().toLowerCase() : null;

    const mutation = `
      mutation InsertAttachment($object: attachments_insert_input!) {
        item: insert_attachments_one(object: $object) {
          id
          attachment_id
          bucket_id
          storage_file_id
          entity_type
          entity_id
          file_category
          original_name
          stored_name
          mime_type
          extension
          size_bytes
          is_public
          metadata
          uploaded_by_user_id
          created_at
        }
      }
    `;

    const record = await executeHasura(mutation, {
      object: {
        bucket_id: bucketId,
        storage_file_id: storageFile.id,
        entity_type: req.body.entity_type || null,
        entity_id: req.body.entity_id || null,
        file_category: req.body.file_category || 'document',
        original_name: req.file.originalname,
        stored_name: storageFile.name || req.file.originalname,
        mime_type: req.file.mimetype,
        extension,
        size_bytes: req.file.size,
        is_public: String(req.body.is_public || 'false') === 'true',
        metadata: {
          source: 'nhost-storage',
          upload_response: storageFile,
        },
        uploaded_by_user_id: req.auth.appUser.id,
      },
    });

    await createAuditLog({
      actorUserId: req.auth.appUser.id,
      actionName: 'attachment:upload',
      entityType: 'attachments',
      entityId: record.item.id,
      beforeData: null,
      afterData: {
        id: record.item.id,
        attachment_id: record.item.attachment_id,
        entity_type: record.item.entity_type,
        entity_id: record.item.entity_id,
        file_category: record.item.file_category,
        original_name: record.item.original_name,
        mime_type: record.item.mime_type,
        size_bytes: record.item.size_bytes,
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent') || null,
    });

    return sendSuccess(res, record.item, 'File uploaded successfully', 201);
  } catch (error) {
    return next(createHttpError(error.statusCode || error.response?.status || 500, error.response?.data?.message || error.message || 'File upload failed', error.response?.data));
  }
});

resourceRouter.get('/attachments/:id/preview', authenticate, requireRole('admin', 'user_region', 'user_all_region'), async (req, res, next) => {
  try {
    const attachment = await loadAttachmentById(req.params.id);
    if (!attachment) {
      throw createHttpError(404, 'Attachment not found');
    }

    const { response, resolvedStorageId } = await fetchAttachmentFromStorage(attachment, req.auth.token);

    res.setHeader('Content-Type', attachment.mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', String(response.data.byteLength));
    res.setHeader('X-Resolved-Storage-File-Id', resolvedStorageId);
    res.setHeader('Content-Disposition', `inline; filename="${attachment.original_name || 'attachment'}"`);
    return res.status(200).send(Buffer.from(response.data));
  } catch (error) {
    return next(
      createHttpError(
        error.statusCode || error.response?.status || 500,
        error.response?.data?.message || error.message || 'Attachment preview failed',
        error.response?.data || error.details,
      ),
    );
  }
});

resourceRouter.get('/attachments/resolve/:identifier', authenticate, requireRole('admin', 'user_region', 'user_all_region'), async (req, res, next) => {
  try {
    const identifier = String(req.params.identifier || '').trim();
    if (!identifier) {
      throw createHttpError(400, 'Attachment identifier is required');
    }
    const attachment = await loadAttachmentById(identifier);
    if (!attachment) {
      throw createHttpError(404, 'Attachment not found');
    }
    return sendSuccess(
      res,
      {
        id: attachment.id,
        attachment_id: attachment.attachment_id,
        storage_file_id: attachment.storage_file_id,
        original_name: attachment.original_name,
        mime_type: attachment.mime_type,
        size_bytes: attachment.size_bytes,
      },
      'Attachment resolved successfully',
    );
  } catch (error) {
    return next(
      createHttpError(
        error.statusCode || 500,
        error.message || 'Attachment resolve failed',
        error.details,
      ),
    );
  }
});

resourceRouter.get('/attachments/:id/download', authenticate, requireRole('admin', 'user_region', 'user_all_region'), async (req, res, next) => {
  try {
    const attachment = await loadAttachmentById(req.params.id);
    if (!attachment) {
      throw createHttpError(404, 'Attachment not found');
    }

    const { response, resolvedStorageId } = await fetchAttachmentFromStorage(attachment, req.auth.token);

    res.setHeader('Content-Type', attachment.mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', String(response.data.byteLength));
    res.setHeader('X-Resolved-Storage-File-Id', resolvedStorageId);
    res.setHeader('Content-Disposition', `attachment; filename="${attachment.original_name || 'attachment'}"`);
    return res.status(200).send(Buffer.from(response.data));
  } catch (error) {
    return next(
      createHttpError(
        error.statusCode || error.response?.status || 500,
        error.response?.data?.message || error.message || 'Attachment download failed',
        error.response?.data || error.details,
      ),
    );
  }
});

resourceRouter.get('/resource-config/:resourceName', authenticate, requireRole('admin'), (req, res, next) => {
  try {
    const config = getResourceConfig(req.params.resourceName);

    if (!config) {
      throw createHttpError(404, 'Resource config not found');
    }

    return sendSuccess(res, config, 'Resource config fetched successfully');
  } catch (error) {
    return next(error);
  }
});

module.exports = { resourceRouter };

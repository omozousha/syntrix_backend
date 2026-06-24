const { randomUUID } = require('crypto');
const { getPagination } = require('../../utils/pagination');
const { sendSuccess } = require('../../utils/response');
const { createHttpError } = require('../../utils/httpError');
const { nhostStorageClient } = require('../../config/nhost');
const { executeHasura } = require('../../config/hasura');
const { createAuditLog } = require('../../shared/audit.service');
const { applyResourceNameNormalization } = require('../../utils/nameNormalization');
const {
  buildFiberCorePhysicalFields,
  getDeviceCoresPerTube,
  needsFiberCorePhysicalRepair,
} = require('../../utils/fiberColor');
const {
  buildWhereClause,
  sanitizePayload,
  listResources,
  getResourceById,
  createResource,
  updateResource,
  deleteResource,
} = require('../../shared/resource.service');
const { validateDevicePayload } = require('../device/device.validation');
const { validatePopPayload } = require('../pop/pop.validation');
const {
  validateDeviceLinkPayload,
  validateDevicePortPayload,
  validatePortConnectionPayload,
  validatePortDirectionForConnection,
} = require('../device/connectivity.validation');
const { validateFiberCoreRangeForConnection } = require('../device/fiber-core-policy.service');
const { buildOdpCoreChainSummary } = require('../device/odp-chain.service');
const {
  STATUS: VALIDATION_STATUS,
  ACTION: VALIDATION_ACTION,
  createRequest: createValidationRequest,
  insertRequestLog: insertValidationRequestLog,
} = require('../validation/validation.service');
const { notifyValidationTaskCreated } = require('../notifications/notification.service');

const ADMINREGION_CREATE_APPROVAL_RESOURCES = new Set(['devices', 'pops', 'routes', 'projects', 'portConnections']);
const REQUEST_ENTITY_TYPE_BY_RESOURCE = {
  devices: 'device',
  pops: 'pop',
  routes: 'route',
  projects: 'project',
  portConnections: 'portConnection',
};
const REQUEST_LABEL_BY_RESOURCE = {
  devices: 'Device',
  pops: 'POP',
  routes: 'Route',
  projects: 'Project',
  portConnections: 'Port Connection',
};

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
        where: { device_id: { _eq: $deviceId }, deleted_at: { _is_null: true } }
        order_by: [{ port_index: asc }]
      ) {
        id
        port_index
        status
        customer_id
        ont_device_id
      }
    }
  `;

  const data = await executeHasura(query, { deviceId });
  return data.items || [];
}

async function provisionPortsFromTemplate(device) {
  const template = await loadDevicePortTemplate(device.device_type_key, 'default');
  if (!template) {
    return { enabled: false, createdCount: 0, reason: 'template_not_found' };
  }

  const requestedTotalPorts = Number(device.total_ports);
  const totalPorts = Number.isInteger(requestedTotalPorts) && requestedTotalPorts > 0
    ? requestedTotalPorts
    : (Number(template.total_ports) || 0);
  const startPortIndex = Number(template.start_port_index) || 1;
  if (totalPorts <= 0) {
    return { enabled: false, createdCount: 0, reason: 'invalid_template_total_ports' };
  }

  const existingPorts = await loadDevicePortsByDeviceId(device.id);
  const existingIndexes = new Set(existingPorts.map((item) => Number(item.port_index)));
  const missingIndexes = [];
  for (let index = 0; index < totalPorts; index += 1) {
    const portIndex = startPortIndex + index;
    if (!existingIndexes.has(portIndex)) {
      missingIndexes.push(portIndex);
    }
  }

  const desiredMaxPortIndex = startPortIndex + totalPorts - 1;
  const overCapacityPorts = existingPorts.filter((item) => Number(item.port_index) > desiredMaxPortIndex);
  const protectedOverCapacityCount = overCapacityPorts.filter((item) => (
    String(item.status || '').toLowerCase() !== 'idle'
    || item.customer_id
    || item.ont_device_id
  )).length;

  if (!missingIndexes.length) {
    return {
      enabled: true,
      templateId: template.id,
      profileName: template.profile_name,
      requestedTotalPorts: totalPorts,
      existingCount: existingPorts.length,
      createdCount: 0,
      overCapacityCount: overCapacityPorts.length,
      protectedOverCapacityCount,
    };
  }

  const objects = missingIndexes.map((portIndex) => {
    const object = {
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
      is_active: true,
    };
    if (String(device.device_type_key || '').toUpperCase() === 'ODP' && device.splitter_ratio) {
      object.splitter_ratio = device.splitter_ratio;
    }
    return object;
  });

  const mutation = `
    mutation ProvisionPorts($objects: [device_ports_insert_input!]!) {
      inserted: insert_device_ports(objects: $objects) {
        affected_rows
      }
    }
  `;

  const result = await executeHasura(mutation, { objects });
  return {
    enabled: true,
    templateId: template.id,
    profileName: template.profile_name,
    requestedTotalPorts: totalPorts,
    existingCount: existingPorts.length,
    createdCount: result.inserted?.affected_rows || 0,
    missingIndexes,
    overCapacityCount: overCapacityPorts.length,
    protectedOverCapacityCount,
  };
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

async function loadFiberCoresByCableDeviceId(cableDeviceId) {
  const query = `
    query LoadFiberCoresByCableDeviceId($cableDeviceId: uuid!) {
      items: fiber_cores(
        where: { cable_device_id: { _eq: $cableDeviceId } }
        order_by: [{ core_no: asc }]
      ) {
        id
        core_no
        status
        from_port_id
        to_port_id
        connection_id
        color_name
        color_hex
        color_standard
        cores_per_tube
        tube_no
        tube_color_name
        tube_color_hex
      }
    }
  `;

  const data = await executeHasura(query, { cableDeviceId });
  return data.items || [];
}

async function syncFiberCoresForCableDevice(device) {
  if (String(device.device_type_key || '').toUpperCase() !== 'CABLE') {
    return { enabled: false, reason: 'not_cable_device' };
  }

  const desired = Math.max(0, Number(device.capacity_core) || 0);
  const coresPerTube = getDeviceCoresPerTube(device);
  const existing = await loadFiberCoresByCableDeviceId(device.id);
  const byCoreNo = new Map(existing.map((row) => [Number(row.core_no), row]));

  const createObjects = [];
  const repairObjects = [];
  for (let coreNo = 1; coreNo <= desired; coreNo += 1) {
    const physicalFields = buildFiberCorePhysicalFields(coreNo, { coresPerTube });
    const existingCore = byCoreNo.get(coreNo);
    if (!existingCore) {
      createObjects.push({
        region_id: device.region_id,
        cable_device_id: device.id,
        core_no: coreNo,
        status: 'available',
        ...physicalFields,
      });
    } else if (needsFiberCorePhysicalRepair(existingCore, physicalFields)) {
      repairObjects.push({
        id: existingCore.id,
        region_id: device.region_id,
        cable_device_id: device.id,
        core_no: coreNo,
        status: existingCore.status || 'available',
        updated_at: new Date().toISOString(),
        ...physicalFields,
      });
    }
  }

  if (createObjects.length) {
    const mutation = `
      mutation InsertFiberCores($objects: [fiber_cores_insert_input!]!) {
        inserted: insert_fiber_cores(objects: $objects) {
          affected_rows
        }
      }
    `;
    await executeHasura(mutation, { objects: createObjects });
  }

  if (repairObjects.length) {
    const mutation = `
      mutation RepairFiberCorePhysicalFields($objects: [fiber_cores_insert_input!]!) {
        repaired: insert_fiber_cores(
          objects: $objects
          on_conflict: {
            constraint: fiber_cores_pkey
            update_columns: [
              color_name
              color_hex
              color_standard
              cores_per_tube
              tube_no
              tube_color_name
              tube_color_hex
              updated_at
            ]
          }
        ) {
          affected_rows
        }
      }
    `;
    await executeHasura(mutation, { objects: repairObjects });
  }

  const overCapacity = existing.filter((row) => Number(row.core_no) > desired);
  const unassignedOverCapacityIds = overCapacity
    .filter((row) => !row.from_port_id && !row.to_port_id && !row.connection_id && row.status !== 'inactive')
    .map((row) => row.id);
  const assignedOverCapacityCount = overCapacity.length - unassignedOverCapacityIds.length;

  if (unassignedOverCapacityIds.length) {
    const mutation = `
      mutation DeactivateFiberCores($ids: [uuid!]!) {
        updated: update_fiber_cores(where: { id: { _in: $ids } }, _set: { status: "inactive" }) {
          affected_rows
        }
      }
    `;
    await executeHasura(mutation, { ids: unassignedOverCapacityIds });
  }

  const restorableInactiveIds = existing
    .filter(
      (row) =>
        Number(row.core_no) <= desired &&
        row.status === 'inactive' &&
        !row.from_port_id &&
        !row.to_port_id &&
        !row.connection_id,
    )
    .map((row) => row.id);

  if (restorableInactiveIds.length) {
    const mutation = `
      mutation ActivateFiberCores($ids: [uuid!]!) {
        updated: update_fiber_cores(where: { id: { _in: $ids } }, _set: { status: "available" }) {
          affected_rows
        }
      }
    `;
    await executeHasura(mutation, { ids: restorableInactiveIds });
  }

  return {
    enabled: true,
    desired_core_count: desired,
    existing_core_count: existing.length,
    created_count: createObjects.length,
    repaired_count: repairObjects.length,
    deactivated_over_capacity_count: unassignedOverCapacityIds.length,
    reactivated_count: restorableInactiveIds.length,
    assigned_over_capacity_count: assignedOverCapacityCount,
  };
}

function hasConnectionCoreRange(connection = {}) {
  return Boolean(
    connection.cable_device_id
    && connection.core_start != null
    && connection.core_end != null
    && Number(connection.core_end) >= Number(connection.core_start)
  );
}

async function releaseFiberCoresForPortConnection(connection) {
  if (!connection?.id) {
    return { enabled: false, released_count: 0, reason: 'connection_not_found' };
  }

  const mutation = `
    mutation ReleaseFiberCoresForConnection($connectionId: uuid!) {
      updated: update_fiber_cores(
        where: {
          connection_id: { _eq: $connectionId }
          status: { _nin: ["damaged", "inactive"] }
        }
        _set: {
          status: "available"
          connection_id: null
          from_port_id: null
          to_port_id: null
        }
      ) {
        affected_rows
      }
    }
  `;

  const result = await executeHasura(mutation, { connectionId: connection.id });
  return {
    enabled: true,
    released_count: result.updated?.affected_rows || 0,
  };
}

async function applyFiberCoresForPortConnection(connection) {
  if (!hasConnectionCoreRange(connection)) {
    return { enabled: false, affected_count: 0, reason: 'core_range_not_provided' };
  }

  const status = String(connection.status || '').toLowerCase();
  if (!['active', 'cutover', 'planned'].includes(status)) {
    return { enabled: false, affected_count: 0, reason: 'connection_status_not_occupying_core' };
  }

  const nextStatus = status === 'planned' ? 'reserved' : 'used';
  const mutation = `
    mutation ApplyFiberCoresForConnection(
      $cableDeviceId: uuid!
      $coreStart: Int!
      $coreEnd: Int!
      $set: fiber_cores_set_input!
    ) {
      updated: update_fiber_cores(
        where: {
          cable_device_id: { _eq: $cableDeviceId }
          core_no: { _gte: $coreStart, _lte: $coreEnd }
          status: { _nin: ["damaged", "inactive"] }
        }
        _set: $set
      ) {
        affected_rows
      }
    }
  `;

  const result = await executeHasura(mutation, {
    cableDeviceId: connection.cable_device_id,
    coreStart: Number(connection.core_start),
    coreEnd: Number(connection.core_end),
    set: {
      status: nextStatus,
      connection_id: connection.id,
      from_port_id: connection.from_port_id,
      to_port_id: connection.to_port_id,
    },
  });

  return {
    enabled: true,
    status: nextStatus,
    expected_count: Number(connection.core_end) - Number(connection.core_start) + 1,
    affected_count: result.updated?.affected_rows || 0,
  };
}

async function syncFiberCoresForPortConnection(connection, previousConnection = null) {
  const released = previousConnection
    ? await releaseFiberCoresForPortConnection(previousConnection)
    : { enabled: false, released_count: 0 };
  const applied = await applyFiberCoresForPortConnection(connection);
  return { enabled: true, released, applied };
}

function validatePayloadByResource(resourceName, payload, mode = 'create') {
  if (resourceName === 'devices') {
    validateDevicePayload(payload, mode);
    return;
  }

  if (resourceName === 'pops') {
    validatePopPayload(payload, mode);
    return;
  }

  if (resourceName === 'deviceLinks') {
    validateDeviceLinkPayload(payload, mode);
    return;
  }

  if (resourceName === 'devicePorts') {
    validateDevicePortPayload(payload, mode);
    return;
  }

  if (resourceName === 'portConnections') {
    validatePortConnectionPayload(payload, mode);
  }
}

function validateUsedPortEndpointState(state) {
  if (String(state.status || '').toLowerCase() !== 'used') return;
  const hasCustomer = state.customer_id != null && String(state.customer_id).trim() !== '';
  const hasOnt = state.ont_device_id != null && String(state.ont_device_id).trim() !== '';
  if (!hasCustomer && !hasOnt) {
    throw createHttpError(400, 'status=used requires customer_id or ont_device_id');
  }
}

async function loadConnectionPortEndpoint(portId) {
  if (!portId) return null;
  const query = `
    query LoadConnectionPortEndpoint($id: uuid!) {
      item: device_ports_by_pk(id: $id) {
        id
        region_id
        device_id
        port_index
        port_label
        status
        deleted_at
      }
    }
  `;
  const data = await executeHasura(query, { id: portId });
  return data.item || null;
}

async function findActiveConnectionByPort(portId, excludeConnectionId = null) {
  if (!portId) return null;
  const where = {
    status: { _in: ['active', 'planned', 'cutover'] },
    _or: [
      { from_port_id: { _eq: portId } },
      { to_port_id: { _eq: portId } },
    ],
  };
  if (excludeConnectionId) {
    where.id = { _neq: excludeConnectionId };
  }

  const query = `
    query FindActiveConnectionByPort($where: port_connections_bool_exp!) {
      items: port_connections(where: $where, limit: 1) {
        id
        connection_id
        from_port_id
        to_port_id
        status
      }
    }
  `;
  const data = await executeHasura(query, { where });
  return data.items?.[0] || null;
}

async function validatePortConnectionOperationalState(payload, existing = null) {
  const fromPortId = payload.from_port_id || existing?.from_port_id;
  const toPortId = payload.to_port_id || existing?.to_port_id;
  const regionId = payload.region_id || existing?.region_id;
  if (!fromPortId || !toPortId) return;

  const [fromPort, toPort] = await Promise.all([
    loadConnectionPortEndpoint(fromPortId),
    loadConnectionPortEndpoint(toPortId),
  ]);
  if (!fromPort || !toPort) throw createHttpError(404, 'Connection port endpoint not found');
  if (fromPort.deleted_at || toPort.deleted_at) throw createHttpError(400, 'Cannot connect deleted port');
  if (fromPort.region_id && toPort.region_id && fromPort.region_id !== toPort.region_id) {
    throw createHttpError(400, 'Connection ports must be in the same region');
  }
  if (regionId && fromPort.region_id && regionId !== fromPort.region_id) {
    throw createHttpError(400, 'Connection region must match port region');
  }

  const [fromActive, toActive] = await Promise.all([
    findActiveConnectionByPort(fromPort.id, existing?.id),
    findActiveConnectionByPort(toPort.id, existing?.id),
  ]);
  if (fromActive) throw createHttpError(400, 'from_port_id is already used by an active/planned connection');
  if (toActive) throw createHttpError(400, 'to_port_id is already used by an active/planned connection');

  await validateFiberCoreRangeForConnection(payload, existing);
  await validatePortDirectionForConnection(payload, existing);
}

function shouldHoldDeviceForSuperadminApproval(req, object) {
  return req.resourceName === 'devices' && req.auth.role === 'user_all_region' && object.region_id;
}

function shouldHoldCreateForSuperadminApproval(req, object) {
  return ADMINREGION_CREATE_APPROVAL_RESOURCES.has(req.resourceName) && req.auth.role === 'user_all_region' && object.region_id;
}

function shouldNotifyValidatorsForDirectDeviceCreate(req, item, approvalRequest) {
  if (approvalRequest) return false;
  if (req.resourceName !== 'devices') return false;
  if (req.auth.role !== 'admin') return false;
  if (!item?.id || !item.region_id || item.deleted_at) return false;
  return String(item.validation_status || '').toLowerCase() !== 'valid';
}

async function loadPortConnectionDeviceContext(object) {
  const fromPortId = object.from_port_id;
  const toPortId = object.to_port_id;
  if (!fromPortId || !toPortId) return {};

  const query = `
    query LoadPortConnectionDeviceContext($fromPortId: uuid!, $toPortId: uuid!) {
      from_port: device_ports_by_pk(id: $fromPortId) {
        id
        port_label
        port_index
        direction
        device {
          id
          device_name
          device_type_key
        }
      }
      to_port: device_ports_by_pk(id: $toPortId) {
        id
        port_label
        port_index
        direction
        device {
          id
          device_name
          device_type_key
        }
      }
    }
  `;

  try {
    const data = await executeHasura(query, { fromPortId, toPortId });
    const fromPort = data.from_port;
    const toPort = data.to_port;

    return {
      upstream_device_name: fromPort?.device?.device_name || null,
      upstream_device_type_key: fromPort?.device?.device_type_key || null,
      upstream_device_id: fromPort?.device?.id || null,
      upstream_port_label: fromPort?.port_label || null,
      upstream_port_direction: fromPort?.direction || null,
      odp_device_name: toPort?.device?.device_name || null,
      odp_device_type_key: toPort?.device?.device_type_key || null,
      odp_device_id: toPort?.device?.id || null,
      odp_port_label: toPort?.port_label || null,
      odp_port_direction: toPort?.direction || null,
    };
  } catch {
    return {};
  }
}

async function loadAssetReferenceContext(payload = {}) {
  const variables = {
    regionIds: payload.region_id ? [payload.region_id] : [],
    popIds: payload.pop_id ? [payload.pop_id] : [],
    projectIds: payload.project_id ? [payload.project_id] : [],
    tenantIds: payload.tenant_id ? [payload.tenant_id] : [],
  };

  const query = `
    query LoadAssetReferenceContext(
      $regionIds: [uuid!]!
      $popIds: [uuid!]!
      $projectIds: [uuid!]!
      $tenantIds: [uuid!]!
    ) {
      regions(where: { id: { _in: $regionIds } }, limit: 1) {
        id
        region_id
        region_name
      }
      pops(where: { id: { _in: $popIds } }, limit: 1) {
        id
        pop_id
        pop_name
        pop_code
      }
      projects(where: { id: { _in: $projectIds } }, limit: 1) {
        id
        project_id
        project_code
        project_name
      }
      tenants(where: { id: { _in: $tenantIds } }, limit: 1) {
        id
        tenant_code
        tenant_name
      }
    }
  `;

  try {
    const data = await executeHasura(query, variables);
    return {
      region: data.regions?.[0] || null,
      pop: data.pops?.[0] || null,
      project: data.projects?.[0] || null,
      tenant: data.tenants?.[0] || null,
    };
  } catch {
    return {
      region: null,
      pop: null,
      project: null,
      tenant: null,
    };
  }
}

function buildAdminRegionCreateRequestPayload(device, relationContext = null) {
  return {
    source: 'adminregion-create-device',
    device: {
      id: device.id,
      region_id: device.region_id || null,
      pop_id: device.pop_id || null,
      project_id: device.project_id || null,
      tenant_id: device.tenant_id || null,
      device_type_key: device.device_type_key || null,
      device_name: device.device_name || null,
      status: device.status || null,
      manufacturer_id: device.manufacturer_id || null,
      brand_id: device.brand_id || null,
      model_id: device.model_id || null,
      serial_number: device.serial_number || null,
      splitter_ratio: device.splitter_ratio || null,
      odp_type: device.odp_type || null,
      installation_type: device.installation_type || null,
      total_ports: device.total_ports ?? null,
      used_ports: device.used_ports ?? null,
      validation_status: device.validation_status || null,
      validation_date: device.validation_date || null,
      image_attachment_id: device.image_attachment_id || null,
      image_attachments: Array.isArray(device.image_attachments) ? device.image_attachments : [],
      address: device.address || null,
      longitude: device.longitude ?? null,
      latitude: device.latitude ?? null,
    },
    relation_context: relationContext,
    device_ports: [],
  };
}

function buildAdminRegionCreateResourcePayload(resourceName, entityId, object, relationContext = null) {
  const resourceLabel = REQUEST_LABEL_BY_RESOURCE[resourceName] || resourceName;
  return {
    source: 'adminregion-create-resource',
    operation: 'create',
    resource_name: resourceName,
    resource_label: resourceLabel,
    [REQUEST_ENTITY_TYPE_BY_RESOURCE[resourceName] || 'resource']: {
      id: entityId,
      ...object,
    },
    resource_payload: object,
    relation_context: relationContext,
  };
}

function getCreateRequestNaturalKey(resourceName, object) {
  if (resourceName === 'devices') {
    const deviceName = String(object.device_name || '').trim();
    if (!deviceName) return null;
    return {
      field: 'device_name',
      value: deviceName,
      extra: object.device_type_key ? { device_type_key: object.device_type_key } : {},
    };
  }

  if (resourceName === 'pops') {
    const popCode = String(object.pop_code || '').trim();
    if (!popCode) return null;
    return { field: 'pop_code', value: popCode };
  }

  if (resourceName === 'routes') {
    const routeName = String(object.route_name || '').trim();
    if (!routeName) return null;
    return { field: 'route_name', value: routeName };
  }

  if (resourceName === 'projects') {
    const projectName = String(object.project_name || '').trim();
    if (!projectName) return null;
    return { field: 'project_name', value: projectName };
  }

  return null;
}

function buildCreateRequestDuplicateMatcher(resourceName, object) {
  const naturalKey = getCreateRequestNaturalKey(resourceName, object);
  if (!naturalKey) return null;

  if (resourceName === 'devices') {
    return {
      source: 'adminregion-create-device',
      device: {
        region_id: object.region_id,
        [naturalKey.field]: naturalKey.value,
        ...naturalKey.extra,
      },
    };
  }

  return {
    source: 'adminregion-create-resource',
    operation: 'create',
    resource_name: resourceName,
    resource_payload: {
      region_id: object.region_id,
      [naturalKey.field]: naturalKey.value,
    },
  };
}

async function findActiveCreateApprovalRequest(req, object) {
  const entityType = REQUEST_ENTITY_TYPE_BY_RESOURCE[req.resourceName];
  const payloadMatcher = buildCreateRequestDuplicateMatcher(req.resourceName, object);
  if (!entityType || !payloadMatcher || !object.region_id) return null;

  const query = `
    query FindActiveCreateApprovalRequest($entityType: String!, $regionId: uuid!, $payloadMatcher: jsonb!) {
      items: validation_requests(
        where: {
          entity_type: { _eq: $entityType }
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
        evidence_attachments
        checklist
        finding_note
        created_at
        updated_at
      }
    }
  `;

  const data = await executeHasura(query, {
    entityType,
    regionId: object.region_id,
    payloadMatcher,
  });
  return data.items?.[0] || null;
}

function buildAdminRegionChangeResourcePayload(resourceName, operation, existing, changes = {}, relationContext = null) {
  const entityType = REQUEST_ENTITY_TYPE_BY_RESOURCE[resourceName] || 'resource';
  const resourceLabel = REQUEST_LABEL_BY_RESOURCE[resourceName] || resourceName;
  const payload = operation === 'update' ? { ...existing, ...changes } : existing;
  return {
    source: operation === 'update' ? 'adminregion-update-resource' : 'adminregion-archive-resource',
    operation,
    resource_name: resourceName,
    resource_label: resourceLabel,
    [entityType]: payload,
    before: existing,
    resource_payload: changes,
    relation_context: relationContext,
  };
}

async function submitAdminRegionAssetRequest({ req, entityId, regionId, operation, payloadSnapshot }) {
  const entityType = REQUEST_ENTITY_TYPE_BY_RESOURCE[req.resourceName];
  const resourceLabel = REQUEST_LABEL_BY_RESOURCE[req.resourceName] || req.resourceName;
  const approvalRequest = await createValidationRequest({
    entityType,
    entityId,
    regionId,
    submittedByUserId: req.auth.appUser.id,
    currentStatus: VALIDATION_STATUS.PENDING_ASYNC,
    payloadSnapshot,
    checklist: {},
    findingNote: `${operation} ${resourceLabel} request by adminregion.`,
  });

  await insertValidationRequestLog({
    requestId: approvalRequest.id,
    actionType: VALIDATION_ACTION.RESUBMIT_ADMINREGION,
    actorUserId: req.auth.appUser.id,
    actorRole: 'adminregion',
    beforeStatus: VALIDATION_STATUS.UNVALIDATED,
    afterStatus: VALIDATION_STATUS.PENDING_ASYNC,
    note: `${operation} ${resourceLabel} request submitted to superadmin.`,
    payloadPatch: payloadSnapshot,
  });

  await createAuditLog({
    actorUserId: req.auth.appUser.id,
    actionName: `asset_${operation}_request_submitted_by_adminregion`,
    entityType: 'validation_requests',
    entityId: approvalRequest.id,
    beforeData: { status: VALIDATION_STATUS.UNVALIDATED },
    afterData: {
      request_id: approvalRequest.request_id,
      status: VALIDATION_STATUS.PENDING_ASYNC,
      source: payloadSnapshot.source,
      operation,
      resource_name: req.resourceName,
      entity_type: entityType,
      entity_id: entityId,
    },
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });

  return approvalRequest;
}

async function list(req, res, next) {
  try {
    const config = req.resourceConfig;
    const { page, limit, offset } = getPagination(req.query);
    const where = buildWhereClause(config, req.query, req.auth);
    const data = await listResources(config, { where, limit, offset, orderBy: config.defaultOrderBy });

    return sendSuccess(res, data.items, `${req.resourceName} fetched successfully`, 200, {
      page,
      limit,
      total: data.aggregate.aggregate.count,
    });
  } catch (error) {
    return next(error);
  }
}

async function getById(req, res, next) {
  try {
    const item = await getResourceById(req.resourceConfig, req.params.id);

    if (!item) {
      throw createHttpError(404, `${req.resourceName} not found`);
    }

    if (req.resourceConfig.regionScoped && req.auth.role === 'user_region') {
      const allowedRegions = new Set(req.auth.regions);
      if (item.region_id && !allowedRegions.has(item.region_id)) {
        throw createHttpError(403, 'You do not have access to this resource region');
      }
    }

    if (req.resourceConfig.softDelete) {
      const includeDeleted = String(req.query.include_deleted || '').toLowerCase() === 'true';
      if (item.deleted_at && (!includeDeleted || req.auth.role !== 'admin')) {
        throw createHttpError(404, `${req.resourceName} not found`);
      }
    }

    return sendSuccess(res, item, `${req.resourceName} fetched successfully`);
  } catch (error) {
    return next(error);
  }
}

async function create(req, res, next) {
  try {
    validatePayloadByResource(req.resourceName, req.body, 'create');
    if (req.resourceName === 'devicePorts') {
      validateUsedPortEndpointState(req.body);
    }
    const object = applyResourceNameNormalization(req.resourceName, sanitizePayload(req.resourceConfig, req.body));

    if (
      req.resourceConfig.regionScoped &&
      ['user_region', 'user_all_region'].includes(req.auth.role) &&
      !req.auth.regions.includes(object.region_id)
    ) {
      throw createHttpError(403, 'Regional user can only create records inside assigned regions');
    }

    if (req.resourceName === 'attachments' && !object.uploaded_by_user_id) {
      object.uploaded_by_user_id = req.auth.appUser.id;
    }

    if (req.resourceName === 'imports' && !object.created_by_user_id) {
      object.created_by_user_id = req.auth.appUser.id;
    }

    if (req.resourceName === 'portConnections') {
      await validatePortConnectionOperationalState(object);
    }

    if (shouldHoldCreateForSuperadminApproval(req, object) && req.resourceName !== 'devices') {
      const existingApprovalRequest = await findActiveCreateApprovalRequest(req, object);
      if (existingApprovalRequest) {
        return sendSuccess(
          res,
          { ...object, approval_request: existingApprovalRequest },
          `${req.resourceName} create request is already waiting for superadmin approval`,
          200,
        );
      }

      const pendingEntityId = randomUUID();
      const relationContext = await loadAssetReferenceContext(object);
      const payloadSnapshot = buildAdminRegionCreateResourcePayload(req.resourceName, pendingEntityId, object, relationContext);
      if (req.resourceName === 'portConnections') {
        payloadSnapshot.context = await loadPortConnectionDeviceContext(object);
      }
      const approvalRequest = await submitAdminRegionAssetRequest({
        req,
        entityId: pendingEntityId,
        regionId: object.region_id,
        operation: 'create',
        payloadSnapshot,
      });

      return sendSuccess(
        res,
        { id: pendingEntityId, ...object, approval_request: approvalRequest },
        `${req.resourceName} create request sent to superadmin approval`,
        201,
      );
    }

    if (shouldHoldDeviceForSuperadminApproval(req, object)) {
      const existingApprovalRequest = await findActiveCreateApprovalRequest(req, object);
      if (existingApprovalRequest) {
        return sendSuccess(
          res,
          { ...object, approval_request: existingApprovalRequest },
          `${req.resourceName} create request is already waiting for superadmin approval`,
          200,
        );
      }
    }

    let item = await createResource(req.resourceConfig, object);

    let provisioningResult = null;
    let fiberSyncResult = null;
    if (req.resourceName === 'devices') {
      if (!item.device_name && item.device_id) {
        item = await updateResource(req.resourceConfig, item.id, {
          device_name: item.device_id,
        });
      }
      try {
        provisioningResult = await provisionPortsFromTemplate(item);
        if (provisioningResult?.enabled) {
          await syncDevicePortUsage(item.id);
        }
        fiberSyncResult = await syncFiberCoresForCableDevice(item);
      } catch (provisionError) {
        try {
          await deleteResource(req.resourceConfig, item.id);
        } catch {
          // Best effort rollback; keep original error for caller.
        }

        throw createHttpError(
          500,
          `Device creation rolled back because auto-provision ports failed: ${provisionError.message || 'unknown error'}`,
        );
      }
    }
    if (req.resourceName === 'devicePorts') {
      await syncDevicePortUsage(item.device_id);
    }
    let portConnectionFiberSyncResult = null;
    if (req.resourceName === 'portConnections') {
      portConnectionFiberSyncResult = await syncFiberCoresForPortConnection(item);
    }

    let approvalRequest = null;
    if (shouldHoldDeviceForSuperadminApproval(req, object)) {
      try {
        item = await updateResource(req.resourceConfig, item.id, {
          deleted_at: new Date().toISOString(),
          deleted_by_user_id: req.auth.appUser.id,
        });
        const relationContext = await loadAssetReferenceContext(item);
        const payloadSnapshot = buildAdminRegionCreateRequestPayload(item, relationContext);
        approvalRequest = await createValidationRequest({
          entityId: item.id,
          regionId: item.region_id,
          submittedByUserId: req.auth.appUser.id,
          currentStatus: VALIDATION_STATUS.PENDING_ASYNC,
          payloadSnapshot,
          checklist: {},
          findingNote: 'Create device request by adminregion.',
        });
        await insertValidationRequestLog({
          requestId: approvalRequest.id,
          actionType: VALIDATION_ACTION.RESUBMIT_ADMINREGION,
          actorUserId: req.auth.appUser.id,
          actorRole: 'adminregion',
          beforeStatus: VALIDATION_STATUS.UNVALIDATED,
          afterStatus: VALIDATION_STATUS.PENDING_ASYNC,
          note: 'Create device request submitted to superadmin.',
          payloadPatch: payloadSnapshot,
        });
        await createAuditLog({
          actorUserId: req.auth.appUser.id,
          actionName: 'validation_request_submitted_by_adminregion',
          entityType: 'validation_requests',
          entityId: approvalRequest.id,
          beforeData: { status: VALIDATION_STATUS.UNVALIDATED },
          afterData: {
            request_id: approvalRequest.request_id,
            status: VALIDATION_STATUS.PENDING_ASYNC,
            source: 'adminregion-create-device',
            device_id: item.id,
          },
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
        });
      } catch (approvalError) {
        try {
          await deleteResource(req.resourceConfig, item.id);
        } catch {
          // Best effort rollback; keep approval error for caller.
        }
        throw createHttpError(
          500,
          `Device creation rolled back because approval request failed: ${approvalError.message || 'unknown error'}`,
        );
      }
    }

    await createAuditLog({
      actorUserId: req.auth.appUser.id,
      actionName: `create:${req.resourceName}`,
      entityType: req.resourceName,
      entityId: item.id,
      beforeData: null,
      afterData: (() => {
        if (req.resourceName === 'devices') {
          return {
          ...item,
          auto_provision: provisioningResult || { enabled: false, createdCount: 0 },
          fiber_core_sync: fiberSyncResult || { enabled: false },
          ...(approvalRequest ? { approval_request_id: approvalRequest.request_id || approvalRequest.id } : {}),
          };
        }
        if (req.resourceName === 'portConnections') {
          return {
            ...item,
            fiber_core_sync: portConnectionFiberSyncResult || { enabled: false },
          };
        }
        return item;
      })(),
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    if (shouldNotifyValidatorsForDirectDeviceCreate(req, item, approvalRequest)) {
      await notifyValidationTaskCreated({
        request: {
          id: null,
          request_id: item.device_name || item.inventory_id || item.device_code || item.device_id || item.id,
          entity_type: 'device',
          entity_id: item.id,
          region_id: item.region_id,
          payload_snapshot: {
            device: {
              device_name: item.device_name || null,
              device_type_key: item.device_type_key || null,
              asset_group: item.asset_group || null,
            },
          },
        },
      }).catch((error) => console.warn('FCM direct superadmin create device notification failed:', error.message || error));
    }

    return sendSuccess(
      res,
      approvalRequest ? { ...item, approval_request: approvalRequest } : item,
      approvalRequest
        ? `${req.resourceName} created and sent to superadmin approval`
        : `${req.resourceName} created successfully`,
      201,
    );
  } catch (error) {
    return next(error);
  }
}

async function update(req, res, next) {
  try {
    const existing = await getResourceById(req.resourceConfig, req.params.id);

    if (!existing) {
      throw createHttpError(404, `${req.resourceName} not found`);
    }

    validatePayloadByResource(req.resourceName, req.body, 'update');

    if (req.resourceConfig.regionScoped && ['user_region', 'user_all_region'].includes(req.auth.role)) {
      const candidateRegionId = req.body.region_id || existing.region_id;
      if (!req.auth.regions.includes(candidateRegionId)) {
        throw createHttpError(403, 'Regional user can only modify records inside assigned regions');
      }
    }

    const changes = applyResourceNameNormalization(req.resourceName, sanitizePayload(req.resourceConfig, req.body));
    if (req.resourceName === 'devicePorts') {
      validateUsedPortEndpointState({ ...existing, ...changes });
    }
    if (req.resourceName === 'portConnections') {
      await validatePortConnectionOperationalState(changes, existing);
    }

    if (req.resourceName === 'devices') {
      const currentType = String(existing.device_type_key || '').toUpperCase();
      const nextType = String(changes.device_type_key || existing.device_type_key || '').toUpperCase();
      const currentValidationStatus = String(existing.validation_status || '').toLowerCase();
      const requestedValidationStatus = changes.validation_status != null
        ? String(changes.validation_status).toLowerCase()
        : null;
      const effectiveValidationStatus = requestedValidationStatus || currentValidationStatus;
      const isValidationStatusChangingToValid = requestedValidationStatus === 'valid' && currentValidationStatus !== 'valid';
      const isChangingIntoValidatedOdp = currentType !== 'ODP' && nextType === 'ODP' && effectiveValidationStatus === 'valid';

      if (nextType === 'ODP' && (isValidationStatusChangingToValid || isChangingIntoValidatedOdp)) {
        const chain = await buildOdpCoreChainSummary(existing.id);
        if (!chain?.is_complete) {
          throw createHttpError(
            400,
            'ODP validation_status cannot be set to valid before core chain is complete (ODC source, splitter, distribution cable, and core mapping)',
          );
        }
      }
    }

    if (shouldHoldCreateForSuperadminApproval(req, { region_id: existing.region_id })) {
      const relationContext = await loadAssetReferenceContext({ ...existing, ...changes });
      const payloadSnapshot = buildAdminRegionChangeResourcePayload(req.resourceName, 'update', existing, changes, relationContext);
      if (req.resourceName === 'portConnections') {
        payloadSnapshot.context = await loadPortConnectionDeviceContext({ ...existing, ...changes });
      }
      const approvalRequest = await submitAdminRegionAssetRequest({
        req,
        entityId: existing.id,
        regionId: existing.region_id,
        operation: 'update',
        payloadSnapshot,
      });

      return sendSuccess(
        res,
        { id: existing.id, approval_request: approvalRequest },
        `${req.resourceName} update request sent to superadmin approval`,
      );
    }

    const item = await updateResource(req.resourceConfig, req.params.id, changes);
    let provisioningResult = null;
    let fiberSyncResult = null;
    let fiberSyncError = null;
    if (req.resourceName === 'devices') {
      try {
        provisioningResult = await provisionPortsFromTemplate(item);
        if (provisioningResult?.enabled) {
          await syncDevicePortUsage(item.id);
        }
        fiberSyncResult = await syncFiberCoresForCableDevice(item);
      } catch (syncError) {
        fiberSyncError = syncError.message || 'device topology sync failed';
      }
    }
    if (req.resourceName === 'devicePorts') {
      await syncDevicePortUsage(item.device_id);
    }
    let portConnectionFiberSyncResult = null;
    if (req.resourceName === 'portConnections') {
      portConnectionFiberSyncResult = await syncFiberCoresForPortConnection(item, existing);
    }
    await createAuditLog({
      actorUserId: req.auth.appUser.id,
      actionName: `update:${req.resourceName}`,
      entityType: req.resourceName,
      entityId: item.id,
      beforeData: existing,
      afterData: (() => {
        if (req.resourceName === 'devices') {
          return {
          ...item,
          auto_provision: provisioningResult || { enabled: false },
          fiber_core_sync: fiberSyncResult || { enabled: false },
          ...(fiberSyncError ? { fiber_core_sync_error: fiberSyncError } : {}),
          };
        }
        if (req.resourceName === 'portConnections') {
          return {
            ...item,
            fiber_core_sync: portConnectionFiberSyncResult || { enabled: false },
          };
        }
        return item;
      })(),
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    const message = fiberSyncError
      ? `${req.resourceName} updated successfully (with topology sync warning)`
      : `${req.resourceName} updated successfully`;

    return sendSuccess(
      res,
      req.resourceName === 'devices'
        ? {
          ...item,
          fiber_core_sync: fiberSyncResult || { enabled: false },
          ...(fiberSyncError ? { fiber_core_sync_error: fiberSyncError } : {}),
        }
        : item,
      message,
    );
  } catch (error) {
    return next(error);
  }
}

async function remove(req, res, next) {
  try {
    const existing = await getResourceById(req.resourceConfig, req.params.id);

    if (!existing) {
      throw createHttpError(404, `${req.resourceName} not found`);
    }

    if (
      req.resourceConfig.regionScoped &&
      ['user_region', 'user_all_region'].includes(req.auth.role) &&
      !req.auth.regions.includes(existing.region_id)
    ) {
      throw createHttpError(403, 'Regional user can only delete records inside assigned regions');
    }

    if (req.resourceName === 'attachments' && existing.storage_file_id) {
      try {
        await nhostStorageClient.delete(`/files/${existing.storage_file_id}`, {
          headers: {
            Authorization: `Bearer ${req.auth.token}`,
          },
        });
      } catch (error) {
        const storageStatus = error.response?.status;

        if (storageStatus !== 404) {
          throw createHttpError(
            storageStatus || 500,
            error.response?.data?.message || error.message || 'Failed to delete file from storage',
            error.response?.data,
          );
        }
      }
    }

    if (shouldHoldCreateForSuperadminApproval(req, { region_id: existing.region_id })) {
      const operation = req.resourceConfig.softDelete ? 'archive' : 'delete';
      const relationContext = await loadAssetReferenceContext(existing);
      const payloadSnapshot = buildAdminRegionChangeResourcePayload(req.resourceName, operation, existing, {}, relationContext);
      if (req.resourceName === 'portConnections') {
        payloadSnapshot.context = await loadPortConnectionDeviceContext(existing);
      }
      const approvalRequest = await submitAdminRegionAssetRequest({
        req,
        entityId: existing.id,
        regionId: existing.region_id,
        operation,
        payloadSnapshot,
      });

      return sendSuccess(
        res,
        { id: existing.id, mode: operation, approval_request: approvalRequest },
        `${req.resourceName} ${operation} request sent to superadmin approval`,
      );
    }

    let portConnectionFiberSyncResult = null;
    if (req.resourceName === 'portConnections') {
      portConnectionFiberSyncResult = await releaseFiberCoresForPortConnection(existing);
    }

    if (req.resourceConfig.softDelete) {
      await updateResource(req.resourceConfig, req.params.id, {
        deleted_at: new Date().toISOString(),
        deleted_by_user_id: req.auth.appUser.id,
      });
    } else {
      await deleteResource(req.resourceConfig, req.params.id);
    }
    if (req.resourceName === 'devicePorts') {
      await syncDevicePortUsage(existing.device_id);
    }

    await createAuditLog({
      actorUserId: req.auth.appUser.id,
      actionName: `${req.resourceConfig.softDelete ? 'soft_delete' : 'delete'}:${req.resourceName}`,
      entityType: req.resourceName,
      entityId: existing.id,
      beforeData: existing,
      afterData: req.resourceName === 'portConnections'
        ? { fiber_core_sync: portConnectionFiberSyncResult || { enabled: false } }
        : null,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });
    return sendSuccess(
      res,
      { id: req.params.id, mode: req.resourceConfig.softDelete ? 'soft_delete' : 'delete' },
      `${req.resourceName} ${req.resourceConfig.softDelete ? 'archived' : 'deleted'} successfully`,
    );
  } catch (error) {
    return next(error);
  }
}

async function restore(req, res, next) {
  try {
    if (!req.resourceConfig.softDelete) {
      throw createHttpError(400, `${req.resourceName} does not support restore`);
    }

    const existing = await getResourceById(req.resourceConfig, req.params.id);

    if (!existing) {
      throw createHttpError(404, `${req.resourceName} not found`);
    }

    if (!existing.deleted_at) {
      return sendSuccess(res, existing, `${req.resourceName} is already active`);
    }

    const item = await updateResource(req.resourceConfig, req.params.id, {
      deleted_at: null,
      deleted_by_user_id: null,
    });
    if (req.resourceName === 'devicePorts') {
      await syncDevicePortUsage(item.device_id);
    }

    await createAuditLog({
      actorUserId: req.auth.appUser.id,
      actionName: `restore:${req.resourceName}`,
      entityType: req.resourceName,
      entityId: item.id,
      beforeData: existing,
      afterData: item,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return sendSuccess(res, item, `${req.resourceName} restored successfully`);
  } catch (error) {
    return next(error);
  }
}

async function purge(req, res, next) {
  try {
    if (req.auth.role !== 'admin') {
      throw createHttpError(403, 'Only admin can purge data permanently');
    }

    if (!req.resourceConfig.softDelete) {
      throw createHttpError(400, `${req.resourceName} does not support purge`);
    }

    const existing = await getResourceById(req.resourceConfig, req.params.id);

    if (!existing) {
      throw createHttpError(404, `${req.resourceName} not found`);
    }

    if (!existing.deleted_at) {
      throw createHttpError(409, `${req.resourceName} must be archived before purge`);
    }

    const confirm = String(req.body?.confirm || '').trim().toUpperCase();
    if (confirm !== 'PURGE') {
      throw createHttpError(400, 'Purge confirmation failed');
    }

    await deleteResource(req.resourceConfig, req.params.id);
    if (req.resourceName === 'devicePorts') {
      await syncDevicePortUsage(existing.device_id);
    }

    await createAuditLog({
      actorUserId: req.auth.appUser.id,
      actionName: `purge:${req.resourceName}`,
      entityType: req.resourceName,
      entityId: existing.id,
      beforeData: existing,
      afterData: null,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return sendSuccess(res, { id: req.params.id, mode: 'purge' }, `${req.resourceName} purged permanently`);
  } catch (error) {
    return next(error);
  }
}

module.exports = { list, getById, create, update, remove, restore, purge };

const express = require('express');
const multer = require('multer');
const FormData = require('form-data');
const XLSX = require('xlsx');
const { env } = require('../../config/env');
const { authenticate, requireRole } = require('../../middleware/auth.middleware');
const { getResourceConfig, RESOURCE_CONFIG } = require('./resource.registry');
const controller = require('./resource.controller');
const { createHttpError } = require('../../utils/httpError');
const { nhostStorageClient } = require('../../config/nhost');
const { executeHasura } = require('../../config/hasura');
const { sendSuccess } = require('../../utils/response');
const { buildWhereClause, listResources } = require('../../shared/resource.service');
const { createAuditLog } = require('../../shared/audit.service');
const { buildOdpCoreChainSummary, buildOdpCoreChainDraft } = require('../device/odp-chain.service');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.maxUploadSizeMb * 1024 * 1024,
  },
});

const resourceRouter = express.Router();

async function loadDeviceById(deviceId) {
  const query = `
    query LoadDeviceById($id: uuid!) {
      item: devices_by_pk(id: $id) {
        id
        device_id
        device_name
        device_type_key
        total_ports
        region_id
        pop_id
        status
      }
    }
  `;

  const data = await executeHasura(query, { id: deviceId });
  return data.item;
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
        status
      }
    }
  `;

  const data = await executeHasura(query, { ids });
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

async function loadPortById(portId) {
  const query = `
    query LoadPortById($id: uuid!) {
      item: device_ports_by_pk(id: $id) {
        id
        region_id
        device_id
        port_index
        port_label
        port_type
        status
        deleted_at
      }
    }
  `;
  const data = await executeHasura(query, { id: portId });
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
        color_name
        color_hex
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
        port_type
        status
        core_capacity
        core_used
        is_active
      }
    }
  `;
  const data = await executeHasura(query, { deviceIds });
  return data.items || [];
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
        core_no
        status
        connection_id
        from_port_id
        to_port_id
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

  let lastResponse = null;
  for (const storageId of candidates) {
    const response = await nhostStorageClient.get(`/files/${storageId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      responseType: 'arraybuffer',
      validateStatus: (status) => status < 500,
    });
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

    if (req.auth.role === 'user_region' && !req.auth.regions.includes(startDevice.region_id)) {
      throw createHttpError(403, 'You do not have access to this device region');
    }

    const requestedRegionId = req.query.region_id ? String(req.query.region_id) : null;
    const maxDepth = Math.min(Math.max(Number(req.query.max_depth) || 6, 1), 24);
    const allowedRegionIds = req.auth.role === 'user_region' ? req.auth.regions : [];

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
        acc[key] = { total: 0, used: 0, statuses: {}, colors: {} };
      }
      acc[key].total += 1;
      if (item.status === 'used') acc[key].used += 1;
      acc[key].statuses[item.status] = (acc[key].statuses[item.status] || 0) + 1;
      if (item.color_name) {
        acc[key].colors[item.color_name] = (acc[key].colors[item.color_name] || 0) + 1;
      }
      return acc;
    }, {});

    const edges = filteredEdges.map((edge) => ({
      ...edge,
      fiber_cores: fiberByConnection[edge.id] || { total: 0, used: 0, statuses: {}, colors: {} },
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

    if (req.auth.role === 'user_region' && !req.auth.regions.includes(device.region_id)) {
      throw createHttpError(403, 'You do not have access to this device region');
    }

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

    if (req.auth.role === 'user_region' && !req.auth.regions.includes(device.region_id)) {
      throw createHttpError(403, 'You do not have access to this device region');
    }

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

    if (req.auth.role === 'user_region' && !req.auth.regions.includes(odpDevice.region_id)) {
      throw createHttpError(403, 'You do not have access to this device region');
    }

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

    if (req.auth.role === 'user_region' && !req.auth.regions.includes(device.region_id)) {
      throw createHttpError(403, 'You do not have access to this device region');
    }

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
      is_active: true,
    }));

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
      },
      'Ports provisioned successfully',
    );
  } catch (error) {
    return next(error);
  }
});

resourceRouter.get('/topology/quality', authenticate, requireRole('admin', 'user_region', 'user_all_region'), async (req, res, next) => {
  try {
    const requestedRegionId = req.query.region_id ? String(req.query.region_id) : null;
    let regionWhere = {};

    if (req.auth.role === 'user_region') {
      if (!req.auth.regions.length) {
        throw createHttpError(403, 'This regional user does not have any assigned region');
      }

      if (requestedRegionId && !req.auth.regions.includes(requestedRegionId)) {
        throw createHttpError(403, 'You do not have access to this region');
      }

      regionWhere = requestedRegionId
        ? { region_id: { _eq: requestedRegionId } }
        : { region_id: { _in: req.auth.regions } };
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
    if (req.auth.role === 'user_region') {
      if (!req.auth.regions.length) {
        throw createHttpError(403, 'This regional user does not have any assigned region');
      }
      if (requestedRegionId && !req.auth.regions.includes(requestedRegionId)) {
        throw createHttpError(403, 'You do not have access to this region');
      }
    }

    const allowedRegionIds = req.auth.role === 'user_region' ? req.auth.regions : [];
    const [connections, ports, fiberCores, deviceLinks] = await Promise.all([
      loadPortConnections({ allowedRegionIds, requestedRegionId }),
      loadPortsByRegion({ allowedRegionIds, requestedRegionId }),
      loadFiberCoresByRegion({ allowedRegionIds, requestedRegionId }),
      loadDeviceLinksByRegion({ allowedRegionIds, requestedRegionId, limit: 5000 }),
    ]);

    const portIdSet = new Set(ports.map((item) => item.id));
    const connectionIdSet = new Set(connections.map((item) => item.id));

    const orphanConnections = connections.filter((conn) => !portIdSet.has(conn.from_port_id) || !portIdSet.has(conn.to_port_id));
    const sameDeviceConnections = connections.filter((conn) => {
      const fromPort = ports.find((port) => port.id === conn.from_port_id);
      const toPort = ports.find((port) => port.id === conn.to_port_id);
      return fromPort && toPort && fromPort.device_id === toPort.device_id;
    });
    const overlapConflicts = detectCoreOverlapConflicts(connections);
    const orphanFiberCores = fiberCores.filter((core) => core.connection_id && !connectionIdSet.has(core.connection_id));
    const overCapacityPorts = ports.filter((port) => {
      const capacity = Number(port.core_capacity);
      const used = Number(port.core_used);
      if (!Number.isFinite(capacity) || capacity < 0) return false;
      if (!Number.isFinite(used) || used < 0) return false;
      return used > capacity;
    });

    const transitioned = await loadDeviceLinkTransitionMapByLinkIds(deviceLinks.map((item) => item.id));
    const transitionedLinkIdSet = new Set(transitioned.map((item) => item.link_id));
    const pendingLegacyLinks = deviceLinks.filter((item) => !transitionedLinkIdSet.has(item.id));

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
          orphan_fiber_cores: orphanFiberCores.length,
          over_capacity_ports: overCapacityPorts.length,
          pending_legacy_device_links: pendingLegacyLinks.length,
        },
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
          orphan_fiber_cores: orphanFiberCores.slice(0, 25).map((item) => ({
            id: item.id,
            cable_device_id: item.cable_device_id,
            core_no: item.core_no,
            connection_id: item.connection_id,
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

    if (req.auth.role === 'user_region') {
      if (!req.auth.regions.length) {
        throw createHttpError(403, 'This regional user does not have any assigned region');
      }
      if (requestedRegionId && !req.auth.regions.includes(requestedRegionId)) {
        throw createHttpError(403, 'You do not have access to this region');
      }
    }

    const allowedRegionIds = req.auth.role === 'user_region' ? req.auth.regions : [];
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
    const startDeviceId = String(req.query.start_device_id || req.query.from_device_id || '').trim();
    const endDeviceId = String(req.query.end_device_id || req.query.to_device_id || '').trim();
    const requestedRegionId = req.query.region_id ? String(req.query.region_id) : null;
    const maxDepth = Math.min(Math.max(Number(req.query.max_depth) || 12, 1), 64);

    if (!startDeviceId) {
      throw createHttpError(400, 'start_device_id is required');
    }

    const startDevice = await loadDeviceById(startDeviceId);
    if (!startDevice) throw createHttpError(404, 'Start device not found');

    if (endDeviceId) {
      const targetDevice = await loadDeviceById(endDeviceId);
      if (!targetDevice) throw createHttpError(404, 'End device not found');
    }

    if (req.auth.role === 'user_region') {
      if (!req.auth.regions.length) {
        throw createHttpError(403, 'This regional user does not have any assigned region');
      }

      if (!req.auth.regions.includes(startDevice.region_id)) {
        throw createHttpError(403, 'You do not have access to the start device region');
      }

      if (requestedRegionId && !req.auth.regions.includes(requestedRegionId)) {
        throw createHttpError(403, 'You do not have access to this region');
      }
    }

    const allowedRegionIds = req.auth.role === 'user_region' ? req.auth.regions : [];
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
    }

    const visited = new Set([startDeviceId]);
    const queue = [{ id: startDeviceId, depth: 0 }];
    const parent = new Map();
    let endFound = !endDeviceId;

    while (queue.length) {
      const current = queue.shift();
      if (current.depth >= maxDepth) continue;
      const neighbors = adjacency.get(current.id) || [];

      for (const neighbor of neighbors) {
        if (visited.has(neighbor.next)) continue;
        visited.add(neighbor.next);
        parent.set(neighbor.next, { prev: current.id, edgeId: neighbor.edgeId });
        if (endDeviceId && neighbor.next === endDeviceId) {
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
    if (endDeviceId && endFound) {
      let cursor = endDeviceId;
      while (cursor !== startDeviceId) {
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
    const fiberByConnection = fiberCores.reduce((acc, item) => {
      const key = item.connection_id;
      if (!key) return acc;
      if (!acc[key]) {
        acc[key] = { total: 0, used: 0, statuses: {}, colors: {} };
      }
      acc[key].total += 1;
      if (item.status === 'used') acc[key].used += 1;
      acc[key].statuses[item.status] = (acc[key].statuses[item.status] || 0) + 1;
      if (item.color_name) {
        acc[key].colors[item.color_name] = (acc[key].colors[item.color_name] || 0) + 1;
      }
      return acc;
    }, {});

    const edges = filteredEdges.map((edge) => ({
      ...edge,
      fiber_cores: fiberByConnection[edge.id] || { total: 0, used: 0, statuses: {}, colors: {} },
    }));

    const nodes = Array.from(
      new Set(edges.flatMap((edge) => [edge.from_device_id, edge.to_device_id]).filter(Boolean)),
    )
      .map((id) => devicesMap.get(id))
      .filter(Boolean);

    const path = [];
    if (endDeviceId && endFound) {
      let cursor = endDeviceId;
      const reversed = [cursor];
      while (cursor !== startDeviceId) {
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
          start_device_id: startDeviceId,
          end_device_id: endDeviceId || null,
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
        },
      },
      'Topology trace fetched successfully',
    );
  } catch (error) {
    return next(error);
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

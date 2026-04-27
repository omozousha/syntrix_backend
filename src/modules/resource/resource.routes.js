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

async function loadAttachmentById(id) {
  const query = `
    query LoadAttachmentById($id: uuid!) {
      item: attachments_by_pk(id: $id) {
        id
        attachment_id
        storage_file_id
        original_name
        mime_type
        size_bytes
        entity_type
        entity_id
        uploaded_by_user_id
        created_at
      }
    }
  `;

  const data = await executeHasura(query, { id });
  return data.item;
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

    const maxDepth = Math.min(Math.max(Number(req.query.max_depth) || 6, 1), 12);
    const allowedRegionIds = req.auth.role === 'user_region' ? req.auth.regions : [];

    const visited = new Set([startDevice.id]);
    const linksMap = new Map();
    let frontier = [startDevice.id];

    for (let depth = 0; depth < maxDepth; depth += 1) {
      if (!frontier.length) break;
      const links = await loadLinksByDeviceIds(frontier, allowedRegionIds);
      const nextFrontier = [];

      for (const link of links) {
        linksMap.set(link.id, link);

        if (link.from_device_id && !visited.has(link.from_device_id)) {
          visited.add(link.from_device_id);
          nextFrontier.push(link.from_device_id);
        }
        if (link.to_device_id && !visited.has(link.to_device_id)) {
          visited.add(link.to_device_id);
          nextFrontier.push(link.to_device_id);
        }
      }

      frontier = nextFrontier;
    }

    const nodes = await loadDevicesByIds(Array.from(visited));
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const links = Array.from(linksMap.values());

    const incomingAdj = new Map();
    const outgoingAdj = new Map();
    links.forEach((link) => {
      if (!incomingAdj.has(link.to_device_id)) incomingAdj.set(link.to_device_id, []);
      if (!outgoingAdj.has(link.from_device_id)) outgoingAdj.set(link.from_device_id, []);
      incomingAdj.get(link.to_device_id).push(link.from_device_id);
      outgoingAdj.get(link.from_device_id).push(link.to_device_id);
    });

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

    return sendSuccess(res, {
      start_device: startDevice,
      graph: {
        nodes,
        links,
      },
      summary: {
        max_depth: maxDepth,
        node_count: nodes.length,
        link_count: links.length,
        upstream_by_type: upstreamByType,
        downstream_by_type: downstreamByType,
      },
    }, 'Device trace fetched successfully');
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

    const totalPorts = Number(template.total_ports) || 0;
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
      port_label: `${device.device_type_key || 'PORT'}-${String(portIndex).padStart(2, '0')}`,
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

    if (!attachment.storage_file_id) {
      throw createHttpError(400, 'Attachment has no linked storage file');
    }

    const response = await nhostStorageClient.get(`/files/${attachment.storage_file_id}`, {
      headers: {
        Authorization: `Bearer ${req.auth.token}`,
      },
      responseType: 'arraybuffer',
      validateStatus: (status) => status < 500,
    });

    if (response.status === 404) {
      throw createHttpError(404, 'Storage file not found');
    }

    if (response.status >= 400) {
      throw createHttpError(response.status, 'Failed to fetch file from storage', response.data);
    }

    res.setHeader('Content-Type', attachment.mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', String(response.data.byteLength));
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

resourceRouter.get('/attachments/:id/download', authenticate, requireRole('admin', 'user_region', 'user_all_region'), async (req, res, next) => {
  try {
    const attachment = await loadAttachmentById(req.params.id);
    if (!attachment) {
      throw createHttpError(404, 'Attachment not found');
    }

    if (!attachment.storage_file_id) {
      throw createHttpError(400, 'Attachment has no linked storage file');
    }

    const response = await nhostStorageClient.get(`/files/${attachment.storage_file_id}`, {
      headers: {
        Authorization: `Bearer ${req.auth.token}`,
      },
      responseType: 'arraybuffer',
      validateStatus: (status) => status < 500,
    });

    if (response.status === 404) {
      throw createHttpError(404, 'Storage file not found');
    }

    if (response.status >= 400) {
      throw createHttpError(response.status, 'Failed to download file from storage', response.data);
    }

    res.setHeader('Content-Type', attachment.mime_type || 'application/octet-stream');
    res.setHeader('Content-Length', String(response.data.byteLength));
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

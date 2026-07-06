const express = require('express');
const { randomUUID } = require('crypto');
const { authenticate, requireRole } = require('../../middleware/auth.middleware');
const { executeHasura } = require('../../config/hasura');
const { sendSuccess } = require('../../utils/response');
const { createHttpError } = require('../../utils/httpError');
const { createAuditLog } = require('../../shared/audit.service');
const { validateDevicePortPayload } = require('./connectivity.validation');
const { parseSplitterRatioPorts } = require('../../utils/splitterRatio');

const {
  loadDeviceById,
  loadPortById,
  syncDevicePortUsage,
  getRegionalTopologyScope,
  assertTopologyRegionAccess,
  loadDevicePortTemplate,
  loadDevicePortsByDeviceId
} = require('../resource/resource.routes');

const deviceRouter = express.Router();

// 1. POST /devices/:id/ports — Create Port Manual
deviceRouter.post('/devices/:id/ports', authenticate, requireRole('admin', 'user_region', 'user_all_region'), async (req, res, next) => {
  try {
    const deviceId = req.params.id;
    const device = await loadDeviceById(deviceId);
    if (!device) throw createHttpError(404, 'Device not found');

    const scope = getRegionalTopologyScope(req.auth);
    assertTopologyRegionAccess(scope, device.region_id, 'You do not have access to this device region');

    const body = req.body || {};
    const payload = {
      region_id: device.region_id,
      device_id: deviceId,
      ...body,
    };

    validateDevicePortPayload(payload, 'create');

    const portId = randomUUID();
    const mutation = `
      mutation InsertDevicePort($object: device_ports_insert_input!) {
        inserted: insert_device_ports_one(object: $object) {
          id
          port_id
          region_id
          device_id
          port_index
          port_label
          port_type
          direction
          status
          speed_profile
          core_capacity
          core_used
          splitter_ratio
          splitter_profile_id
          splitter_role
          customer_id
          ont_device_id
          occupied_at
          is_active
          notes
          created_at
        }
      }
    `;

    const result = await executeHasura(mutation, {
      object: {
        id: portId,
        region_id: payload.region_id,
        device_id: payload.device_id,
        port_index: Number(payload.port_index),
        port_label: payload.port_label || `Port ${payload.port_index}`,
        port_type: payload.port_type || 'distribution',
        direction: payload.direction || 'out',
        status: payload.status || 'idle',
        speed_profile: payload.speed_profile || null,
        core_capacity: payload.core_capacity != null ? Number(payload.core_capacity) : 0,
        core_used: payload.core_used != null ? Number(payload.core_used) : 0,
        splitter_ratio: payload.splitter_ratio || null,
        splitter_profile_id: payload.splitter_profile_id || null,
        splitter_role: payload.splitter_role || null,
        customer_id: payload.customer_id || null,
        ont_device_id: payload.ont_device_id || null,
        occupied_at: payload.occupied_at || null,
        is_active: payload.is_active !== false,
        notes: payload.notes || null,
      },
    });

    const inserted = result.inserted;
    if (!inserted) throw createHttpError(500, 'Failed to create device port');

    await createAuditLog({
      actorUserId: req.auth.appUser.id,
      actionName: 'create:device-ports',
      entityType: 'device_ports',
      entityId: inserted.id,
      beforeData: null,
      afterData: inserted,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    await syncDevicePortUsage(deviceId);

    return sendSuccess(res, inserted, 'Device port created successfully', 201);
  } catch (error) {
    return next(error);
  }
});

// 2. PATCH /device-ports/:id — Update Port Metadata
deviceRouter.patch('/device-ports/:id', authenticate, requireRole('admin', 'user_region', 'user_all_region'), async (req, res, next) => {
  try {
    const portId = req.params.id;
    const port = await loadPortById(portId);
    if (!port) throw createHttpError(404, 'Device port not found');

    const scope = getRegionalTopologyScope(req.auth);
    assertTopologyRegionAccess(scope, port.region_id, 'You do not have access to this port region');

    const body = req.body || {};
    validateDevicePortPayload(body, 'update');

    const allowedFields = [
      'port_index', 'port_label', 'port_type', 'direction', 'status',
      'speed_profile', 'core_capacity', 'core_used', 'splitter_ratio',
      'splitter_profile_id', 'splitter_role', 'customer_id', 'ont_device_id',
      'occupied_at', 'is_active', 'notes'
    ];

    const patch = {};
    for (const field of allowedFields) {
      if (field in body) {
        if (['port_index', 'core_capacity', 'core_used'].includes(field)) {
          patch[field] = body[field] != null && body[field] !== '' ? Number(body[field]) : null;
        } else if (field === 'is_active') {
          patch[field] = body[field] === true || String(body[field]).toLowerCase() === 'true';
        } else {
          patch[field] = body[field] != null && body[field] !== '' ? String(body[field]).trim() : null;
        }
      }
    }

    if (!Object.keys(patch).length) {
      throw createHttpError(400, 'No valid fields provided for update');
    }

    const mutation = `
      mutation UpdateDevicePort($id: uuid!, $patch: device_ports_set_input!) {
        updated: update_device_ports_by_pk(pk_columns: { id: $id }, _set: $patch) {
          id
          port_id
          region_id
          device_id
          port_index
          port_label
          port_type
          direction
          status
          speed_profile
          core_capacity
          core_used
          splitter_ratio
          splitter_profile_id
          splitter_role
          customer_id
          ont_device_id
          occupied_at
          is_active
          notes
          updated_at
        }
      }
    `;

    const result = await executeHasura(mutation, { id: portId, patch });
    const updated = result.updated;
    if (!updated) throw createHttpError(500, 'Failed to update device port');

    await createAuditLog({
      actorUserId: req.auth.appUser.id,
      actionName: 'update:device-ports',
      entityType: 'device_ports',
      entityId: portId,
      beforeData: port,
      afterData: updated,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    await syncDevicePortUsage(port.device_id);

    return sendSuccess(res, updated, 'Device port updated successfully');
  } catch (error) {
    return next(error);
  }
});

// 3. DELETE /device-ports/:id — Soft Delete Port
deviceRouter.delete('/device-ports/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const portId = req.params.id;
    const port = await loadPortById(portId);
    if (!port) throw createHttpError(404, 'Device port not found');

    const scope = getRegionalTopologyScope(req.auth);
    assertTopologyRegionAccess(scope, port.region_id, 'You do not have access to this port region');

    const now = new Date().toISOString();
    const mutation = `
      mutation SoftDeleteDevicePort($id: uuid!, $set: device_ports_set_input!) {
        updated: update_device_ports_by_pk(pk_columns: { id: $id }, _set: $set) {
          id
          port_id
          device_id
          deleted_at
        }
      }
    `;

    const result = await executeHasura(mutation, {
      id: portId,
      set: {
        deleted_at: now,
        deleted_by_user_id: req.auth.appUser.id,
        is_active: false,
      },
    });

    const deleted = result.updated;
    if (!deleted) throw createHttpError(500, 'Failed to delete device port');

    await createAuditLog({
      actorUserId: req.auth.appUser.id,
      actionName: 'delete:device-ports',
      entityType: 'device_ports',
      entityId: portId,
      beforeData: port,
      afterData: deleted,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    await syncDevicePortUsage(port.device_id);

    return sendSuccess(res, deleted, 'Device port deleted successfully');
  } catch (error) {
    return next(error);
  }
});

// 4. POST /devices/:id/provision-ports — Provision Ports from Template
deviceRouter.post('/devices/:id/provision-ports', authenticate, requireRole('admin', 'user_region', 'user_all_region'), async (req, res, next) => {
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
          total_ports_to_ensure: totalPorts,
          already_exists_count: existingPorts.length,
          missing_indexes_to_create: missingIndexes,
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
          total_ports_to_ensure: totalPorts,
          created_count: 0,
        },
        'All ports already provisioned',
      );
    }

    const objects = missingIndexes.map((portIndex) => {
      const portId = randomUUID();
      return {
        id: portId,
        device_id: device.id,
        region_id: device.region_id,
        port_index: portIndex,
        port_label: `${template.profile_name.toUpperCase()}-${portIndex}`,
        port_type: template.default_port_type || 'distribution',
        direction: template.default_direction || 'out',
        status: 'idle',
        speed_profile: template.default_speed_profile || null,
        core_capacity: Number(template.default_core_capacity) || 0,
        core_used: 0,
        is_active: true,
      };
    });

    const mutation = `
      mutation ProvisionDevicePorts($objects: [device_ports_insert_input!]!) {
        inserted: insert_device_ports(objects: $objects) {
          affected_rows
        }
      }
    `;

    const mutationResult = await executeHasura(mutation, { objects });
    const createdCount = mutationResult.inserted?.affected_rows || 0;

    await createAuditLog({
      actorUserId: req.auth.appUser.id,
      actionName: 'provision:device-ports',
      entityType: 'devices',
      entityId: device.id,
      beforeData: { existing_count: existingPorts.length },
      afterData: { created_count: createdCount, total_ports: totalPorts },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    await syncDevicePortUsage(device.id);

    return sendSuccess(
      res,
      {
        device_id: device.id,
        template_id: template.id,
        profile_name: template.profile_name,
        total_ports_to_ensure: totalPorts,
        created_count: createdCount,
      },
      'Ports provisioned successfully from template',
    );
  } catch (error) {
    return next(error);
  }
});



module.exports = { deviceRouter };

const express = require('express');
const { randomUUID } = require('crypto');
const { authenticate, requireRole } = require('../../middleware/auth.middleware');
const { executeHasura } = require('../../config/hasura');
const { sendSuccess } = require('../../utils/response');
const { createHttpError } = require('../../utils/httpError');
const { createAuditLog } = require('../../shared/audit.service');
const { buildOdcCoreChainSummary } = require('./odc-chain.service');
const { validateDevicePortPayload } = require('./connectivity.validation');
const { parseSplitterRatioPorts } = require('../../utils/splitterRatio');

const {
  loadDeviceById,
  loadPortById,
  syncDevicePortUsage,
  getRegionalTopologyScope,
  assertTopologyRegionAccess,
  loadDevicePortTemplate,
  loadDevicePortsByDeviceId,
  resolveTraceEndpoint,
  loadPortConnections,
  loadPortsByIds,
  loadDevicesByIds,
  loadFiberCoresByConnectionIds,
  loadRoutesByIds,
  buildPortConnectionLabel
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

// 5. GET /devices/:id/odc-chain-summary — ODC Chain Summary
deviceRouter.get('/devices/:id/odc-chain-summary', authenticate, requireRole('admin', 'user_region', 'user_all_region'), async (req, res, next) => {
  try {
    const deviceId = req.params.id;
    const device = await loadDeviceById(deviceId);
    if (!device) throw createHttpError(404, 'Device not found');

    const scope = getRegionalTopologyScope(req.auth);
    assertTopologyRegionAccess(scope, device.region_id, 'You do not have access to this device region');

    if (String(device.device_type_key || '').toUpperCase() !== 'ODC') {
      throw createHttpError(400, 'ODC chain summary is only available for ODC devices');
    }

    const summary = await buildOdcCoreChainSummary(deviceId);
    return sendSuccess(res, summary, 'ODC core chain summary fetched successfully');
  } catch (error) {
    return next(error);
  }
});

// 6. GET /devices/:id/trace — Get trace for device
deviceRouter.get('/devices/:id/trace', authenticate, requireRole('admin', 'user_region', 'user_all_region'), async (req, res, next) => {
  try {
    const startDevice = await loadDeviceById(req.params.id);
    if (!startDevice) {
      throw createHttpError(404, 'Start device not found');
    }

    const scope = getRegionalTopologyScope(req.auth);
    assertTopologyRegionAccess(scope, startDevice.region_id, 'You do not have access to this device region');

    return res.redirect(`/api/v1/topology/trace?start_device_id=${encodeURIComponent(startDevice.id)}`);
  } catch (error) {
    return next(error);
  }
});

// 7. GET /topology/trace — Topology Trace (End-to-End)
deviceRouter.get('/topology/trace', authenticate, requireRole('admin', 'user_region', 'user_all_region'), async (req, res, next) => {
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

module.exports = { deviceRouter };

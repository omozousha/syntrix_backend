const { randomUUID } = require('crypto');
const { executeHasura, executeHasuraSql } = require('../../config/hasura');
const { createHttpError } = require('../../utils/httpError');

async function loadTopologyRelationRules(sourceDeviceTypeKey, direction) {
  const source = String(sourceDeviceTypeKey || '').toUpperCase();
  const dir = String(direction || '').toLowerCase();
  if (!source || !dir) return [];

  const query = `
    query LoadTopologyRelationRules($source: String!, $direction: String!) {
      items: topology_relation_rules(
        where: {
          source_device_type_key: { _eq: $source }
          direction: { _eq: $direction }
          is_active: { _eq: true }
          deleted_at: { _is_null: true }
        }
        order_by: [{ sort_order: asc }, { allowed_peer_device_type_key: asc }]
      ) {
        id
        source_device_type_key
        direction
        allowed_peer_device_type_key
        connection_role
        route_type
        requires_same_pop
        requires_same_project
        is_required_on_create
      }
    }
  `;

  try {
    const data = await executeHasura(query, { source, direction: dir });
    return data?.items || [];
  } catch {
    return [];
  }
}

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
        project_id
        status
        capacity_core
        used_core
        total_ports
        used_ports
        deleted_at
      }
    }
  `;
  const data = await executeHasura(query, { id: deviceId });
  return data?.item || null;
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
        status
        customer_id
        ont_device_id
        deleted_at
      }
    }
  `;
  const data = await executeHasura(query, { id: portId });
  return data?.item || null;
}

async function findActiveConnection(odpPortId) {
  const query = `
    query FindActiveDropConnection($fromPortId: uuid!) {
      items: port_connections(
        where: {
          from_port_id: { _eq: $fromPortId }
          connection_type: { _eq: "drop" }
          status: { _eq: "active" }
        }
        limit: 1
      ) {
        id
        connection_id
        region_id
        from_port_id
        to_port_id
        connection_type
        status
        created_at
      }
    }
  `;
  const data = await executeHasura(query, { fromPortId: odpPortId });
  return data?.items?.[0] || null;
}

async function findOntIdlePort(ontDeviceId) {
  const query = `
    query FindOntIdlePort($deviceId: uuid!) {
      items: device_ports(
        where: {
          device_id: { _eq: $deviceId }
          status: { _eq: "idle" }
          deleted_at: { _is_null: true }
          is_active: { _eq: true }
        }
        order_by: { port_index: asc }
        limit: 1
      ) {
        id
        port_id
        region_id
        device_id
        port_index
        port_label
        status
      }
    }
  `;
  const data = await executeHasura(query, { deviceId: ontDeviceId });
  return data?.items?.[0] || null;
}

async function validateOdpOntPair(odpPort, ontDevice, ontPort) {
  if (odpPort.deleted_at) {
    throw createHttpError(400, 'ODP port is deleted');
  }
  if (ontPort.deleted_at) {
    throw createHttpError(400, 'ONT port is deleted');
  }

  const currentStatus = String(odpPort.status || '').toLowerCase();
  if (currentStatus !== 'idle' && currentStatus !== 'reserved') {
    throw createHttpError(409, 'ODP port is not available for assignment');
  }

  if (ontPort.status !== 'idle') {
    throw createHttpError(409, 'ONT port is not idle');
  }

  if (odpPort.region_id !== ontPort.region_id) {
    throw createHttpError(400, 'ODP port and ONT must be in the same region');
  }

  // Validate topology_relation_rules: ODP rear -> ONT
  const rules = await loadTopologyRelationRules('ODP', 'rear');
  const matched = rules.find(
    (r) => String(r.allowed_peer_device_type_key || '').toUpperCase() === 'ONT'
  );
  if (!matched) {
    throw createHttpError(400, 'No active topology rule found for ODP rear -> ONT connection');
  }

  // same POP check
  if (matched.requires_same_pop) {
    const odpDevice = await loadDeviceById(odpPort.device_id);
    if (odpDevice?.pop_id && ontDevice?.pop_id && odpDevice.pop_id !== ontDevice.pop_id) {
      throw createHttpError(400, 'ODP and ONT must be in the same POP');
    }
  }

  // Check ONT not already assigned to another ODP port
  const existingAssignment = await findActivePortAssignmentByOnt(ontDevice.id, odpPort.id);
  if (existingAssignment) {
    throw createHttpError(409, 'ONT is already assigned to another ODP port');
  }

  return { rule: matched };
}

async function findActivePortAssignmentByOnt(ontDeviceId, excludePortId) {
  const query = `
    query FindOntAssignment($ontDeviceId: uuid!) {
      items: device_ports(
        where: {
          ont_device_id: { _eq: $ontDeviceId }
          deleted_at: { _is_null: true }
          is_active: { _eq: true }
        }
        limit: 1
      ) {
        id
        device_id
        status
      }
    }
  `;
  const data = await executeHasura(query, { ontDeviceId });
  const rows = (data?.items || []).filter((p) => p.id !== excludePortId);
  return rows[0] || null;
}

async function createDropConnection(odpPort, ontPort, connId, actorUserId, ipAddress, userAgent) {
  const mutation = `
    mutation CreateDropConnection($object: port_connections_insert_input!) {
      inserted: insert_port_connections_one(object: $object) {
        id
        connection_id
        region_id
        from_port_id
        to_port_id
        connection_type
        status
        created_at
      }
    }
  `;

  const result = await executeHasura(mutation, {
    object: {
      id: connId,
      region_id: odpPort.region_id,
      from_port_id: odpPort.id,
      to_port_id: ontPort.id,
      connection_type: 'drop',
      status: 'active',
    },
  });

  return result?.inserted || null;
}

async function updatePortDirect(portId, changes) {
  const setClauses = Object.entries(changes)
    .filter(([, v]) => v !== undefined)
    .map(([k]) => `${k}: $${k}`)
    .join(', ');
  const vars = Object.entries(changes)
    .filter(([, v]) => v !== undefined)
    .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {});

  const mutation = `
    mutation UpdatePort($id: uuid!, ${Object.keys(vars).map((k) => `$${k}: ${inferScalar(vars[k])}`).join(', ')}) {
      update_device_ports_by_pk(pk_columns: { id: $id }, _set: { ${setClauses} }) {
        id
        port_id
        region_id
        device_id
        port_index
        port_label
        status
        customer_id
        ont_device_id
      }
    }
  `;

  const data = await executeHasura(mutation, { id: portId, ...vars });
  return data?.update_device_ports_by_pk || null;
}

function inferScalar(value) {
  if (value === null || value === undefined) return 'String';
  if (typeof value === 'number') return Number.isInteger(value) ? 'Int' : 'Float';
  if (typeof value === 'boolean') return 'Boolean';
  return 'String';
}

async function syncDeviceCoreUsage(deviceId) {
  if (!deviceId) return;

  const sql = `
    UPDATE public.devices d
    SET
      used_core = (
        SELECT COUNT(*)::integer
        FROM public.device_ports p
        WHERE p.device_id = d.id
          AND p.deleted_at IS NULL
          AND (
            p.ont_device_id IS NOT NULL
            OR EXISTS (
              SELECT 1
              FROM public.port_connections pc
              WHERE pc.from_port_id = p.id
                AND pc.connection_type = 'drop'
                AND pc.status = 'active'
            )
          )
      ),
      updated_at = NOW()
    WHERE d.id = '${String(deviceId).replace(/'/g, "''")}'::uuid
  `;

  try {
    await executeHasuraSql(sql);
  } catch {
    // best-effort sync
  }
}

async function deleteConnection(connectionId) {
  const mutation = `
    mutation DeleteConnection($id: uuid!) {
      delete_port_connections_by_pk(id: $id) {
        id
        from_port_id
        to_port_id
      }
    }
  `;
  await executeHasura(mutation, { id: connectionId });
}

module.exports = {
  loadDeviceById,
  loadPortById,
  findActiveConnection,
  findOntIdlePort,
  validateOdpOntPair,
  createDropConnection,
  updatePortDirect,
  syncDeviceCoreUsage,
  deleteConnection,
};

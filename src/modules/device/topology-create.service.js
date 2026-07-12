const { randomUUID } = require('crypto');
const { executeHasura, executeHasuraSql } = require('../../config/hasura');
const { createHttpError } = require('../../utils/httpError');
const {
  buildFiberCorePhysicalFields,
  getDeviceCoresPerTube,
} = require('../../utils/fiberColor');

const TOPOLOGY_PEER_RULES = {
  OTB: { front: ['OLT', 'SWITCH'], rear: ['ODC', 'JC'] },
  ODC: { front: ['OTB'], rear: ['ODP'] },
  JC: { front: ['OTB', 'ODC', 'JC'], rear: ['ODP', 'JC', 'HH', 'MH'] },
  ODP: { front: ['ODC', 'JC'], rear: ['ONT'] },
  CABLE: { front: ['OTB', 'ODC', 'JC'], rear: ['ODC', 'ODP', 'JC', 'HH', 'MH'] },
};

function hasTopologyCreateInput(body = {}) {
  return Boolean(
    String(body.front_device_id || '').trim()
    || String(body.front_port_id || '').trim()
    || String(body.rear_device_id || '').trim()
    || String(body.rear_port_id || '').trim(),
  );
}

async function loadDevicePortTemplate(deviceTypeKey) {
  const query = `
    query LoadTopologyCreatePortTemplate($deviceTypeKey: String!) {
      items: device_port_templates(
        where: {
          device_type_key: { _eq: $deviceTypeKey }
          profile_name: { _eq: "default" }
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
  const data = await executeHasura(query, { deviceTypeKey });
  return data.items?.[0] || null;
}

async function loadPeerPort(portId) {
  const query = `
    query LoadTopologyCreatePeerPort($portId: uuid!) {
      item: device_ports_by_pk(id: $portId) {
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
  const data = await executeHasura(query, { portId });
  const port = data?.item || null;
  if (!port) return null;

  try {
    const rows = await executeHasuraSql(`
      select device_type_key, pop_id, project_id, region_id
      from public.devices
      where id = ${port.device_id ? `'${String(port.device_id).replace(/'/g, "''")}'::uuid` : 'null'}::uuid
      limit 1;
    `);
    const row = Array.isArray(rows?.result) && Array.isArray(rows.result[0])
      ? rows.result.slice(1)[0] || null
      : null;
    if (row && row[0]) {
      port.device = {
        id: port.device_id,
        device_type_key: row[0],
        pop_id: row[1] || null,
        project_id: row[2] || null,
        region_id: row[3] || null,
      };
    } else if (port.device_id) {
      port.device = { id: port.device_id, device_type_key: null };
    }
  } catch (_error) {
    port.device = port.device || { id: port.device_id, device_type_key: null };
  }
  return port;
}

function assertPeerType(currentDeviceType, peerDeviceType, direction) {
  const current = String(currentDeviceType || '').toUpperCase();
  const peer = String(peerDeviceType || '').toUpperCase();
  const allowed = TOPOLOGY_PEER_RULES[current]?.[direction];
  if (allowed && !allowed.includes(peer)) {
    throw createHttpError(400, `${direction} device type ${peer} is not allowed for ${current}`);
  }
}

async function validateTopologyCreateInput({ device, body }) {
  const frontDeviceId = String(body.front_device_id || '').trim();
  const frontPortId = String(body.front_port_id || '').trim();
  const rearDeviceId = String(body.rear_device_id || '').trim();
  const rearPortId = String(body.rear_port_id || '').trim();
  const hasFront = Boolean(frontDeviceId || frontPortId);
  const hasRear = Boolean(rearDeviceId || rearPortId);

  if (hasFront && (!frontDeviceId || !frontPortId)) {
    throw createHttpError(400, 'front_device_id and front_port_id must be provided together');
  }
  if (hasRear && (!rearDeviceId || !rearPortId)) {
    throw createHttpError(400, 'rear_device_id and rear_port_id must be provided together');
  }

  const validatePeer = async (peerDeviceId, peerPortId, direction) => {
    const port = await loadPeerPort(peerPortId);
    if (!port) throw createHttpError(404, `${direction} port not found`);
    if (port.deleted_at) throw createHttpError(400, `${direction} port is deleted`);
    if (String(port.device_id) !== peerDeviceId) {
      throw createHttpError(400, `${direction} port does not belong to selected ${direction} device`);
    }
    if (port.region_id && device.region_id && port.region_id !== device.region_id) {
      throw createHttpError(400, `${direction} port must be in the same region as the new device`);
    }
    if (String(port.status || '').toLowerCase() !== 'idle') {
      throw createHttpError(409, `${direction} port is not idle`);
    }
    assertPeerType(device.device_type_key, port.device?.device_type_key, direction);
    return port;
  };

  const [frontPeer, rearPeer] = await Promise.all([
    hasFront ? validatePeer(frontDeviceId, frontPortId, 'front') : null,
    hasRear ? validatePeer(rearDeviceId, rearPortId, 'rear') : null,
  ]);

  return {
    hasFront,
    hasRear,
    frontDeviceId,
    frontPortId,
    rearDeviceId,
    rearPortId,
    frontPeer,
    rearPeer,
  };
}

function buildPortObjects(device, template) {
  const requestedTotalPorts = Number(device.total_ports);
  const totalPorts = Number.isInteger(requestedTotalPorts) && requestedTotalPorts > 0
    ? requestedTotalPorts
    : Number(template.total_ports || 0);
  const startPortIndex = Number(template.start_port_index) || 1;
  if (totalPorts <= 0) {
    throw createHttpError(409, 'Device port template has no assignable local ports');
  }

  const objects = Array.from({ length: totalPorts }, (_, index) => {
    const portIndex = startPortIndex + index;
    const object = {
      id: randomUUID(),
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

  return { objects, totalPorts };
}

function buildFiberCoreObjects(device) {
  if (String(device.device_type_key || '').toUpperCase() !== 'CABLE') return [];

  const capacity = Math.max(0, Number(device.capacity_core) || 0);
  const coresPerTube = getDeviceCoresPerTube(device);
  return Array.from({ length: capacity }, (_, index) => {
    const coreNo = index + 1;
    return {
      id: randomUUID(),
      region_id: device.region_id,
      cable_device_id: device.id,
      core_no: coreNo,
      status: 'available',
      ...buildFiberCorePhysicalFields(coreNo, { coresPerTube }),
    };
  });
}

function buildConnectionObjects({ device, topology, localPorts }) {
  const requiredLocalPortCount = Number(topology.hasFront) + Number(topology.hasRear);
  if (localPorts.length < requiredLocalPortCount) {
    throw createHttpError(409, 'Device does not have enough idle local ports for requested topology connections');
  }

  const objects = [];
  let localPortIndex = 0;
  if (topology.hasFront) {
    objects.push({
      id: randomUUID(),
      region_id: device.region_id,
      from_port_id: topology.frontPortId,
      to_port_id: localPorts[localPortIndex].id,
      connection_type: 'fiber',
      status: 'active',
    });
    localPortIndex += 1;
  }
  if (topology.hasRear) {
    objects.push({
      id: randomUUID(),
      region_id: device.region_id,
      from_port_id: localPorts[localPortIndex].id,
      to_port_id: topology.rearPortId,
      connection_type: 'fiber',
      status: 'active',
    });
  }
  return objects;
}

function topologyCreateError(error) {
  const message = String(error?.message || error?.response?.data?.error || error?.response?.data?.message || 'Topology create failed');
  if (message.includes('TOPOLOGY_PORT_UNAVAILABLE') || message.includes('already has an active connection')) {
    return createHttpError(409, 'Port sudah digunakan oleh koneksi lain. Silakan refresh daftar port dan pilih port lain.');
  }
  if (message.includes('TOPOLOGY_PORT_INVALID')) {
    return createHttpError(400, message.replace(/^.*TOPOLOGY_PORT_INVALID:\s*/, ''));
  }
  return error;
}

async function createDeviceWithTopology({ device, body, audit }) {
  const topology = await validateTopologyCreateInput({ device, body });
  const template = await loadDevicePortTemplate(device.device_type_key);
  if (!template) {
    throw createHttpError(409, `No active default port template found for ${device.device_type_key}`);
  }

  const createdDevice = { id: randomUUID(), ...device };
  const provisioned = buildPortObjects(createdDevice, template);
  const fiberCores = buildFiberCoreObjects(createdDevice);
  const connections = buildConnectionObjects({
    device: createdDevice,
    topology,
    localPorts: provisioned.objects,
  });

  const topologyAudit = {
    actor_user_id: audit.actorUserId,
    action_name: 'create:topology-connections',
    entity_type: 'devices',
    entity_id: createdDevice.id,
    before_data: null,
    after_data: {
      front_device_id: topology.frontDeviceId || null,
      front_port_id: topology.frontPortId || null,
      rear_device_id: topology.rearDeviceId || null,
      rear_port_id: topology.rearPortId || null,
      front_connection_id: connections[0]?.id || null,
      rear_connection_id: connections[1]?.id || null,
    },
    ip_address: audit.ipAddress || null,
    user_agent: audit.userAgent || null,
  };
  const resourceAudit = {
    actor_user_id: audit.actorUserId,
    action_name: 'create:devices',
    entity_type: 'devices',
    entity_id: createdDevice.id,
    before_data: null,
    after_data: {
      ...createdDevice,
      auto_provision: {
        enabled: true,
        template_id: template.id,
        profile_name: template.profile_name,
        created_count: provisioned.objects.length,
      },
      fiber_core_sync: {
        enabled: String(createdDevice.device_type_key || '').toUpperCase() === 'CABLE',
        created_count: fiberCores.length,
      },
    },
    ip_address: audit.ipAddress || null,
    user_agent: audit.userAgent || null,
  };

  const mutation = `
    mutation CreateDeviceWithTopology(
      $device: devices_insert_input!
      $ports: [device_ports_insert_input!]!
      $fiberCores: [fiber_cores_insert_input!]!
      $connections: [port_connections_insert_input!]!
      $topologyAudit: audit_logs_insert_input!
      $resourceAudit: audit_logs_insert_input!
    ) {
      device: insert_devices_one(object: $device) {
        id
        device_id
        device_code
        device_name
        device_type_key
      }
      ports: insert_device_ports(objects: $ports) {
        affected_rows
      }
      fiber_cores: insert_fiber_cores(objects: $fiberCores) {
        affected_rows
      }
      connections: insert_port_connections(objects: $connections) {
        affected_rows
        returning {
          id
          connection_id
          from_port_id
          to_port_id
          status
        }
      }
      topology_audit: insert_audit_logs_one(object: $topologyAudit) {
        id
      }
      resource_audit: insert_audit_logs_one(object: $resourceAudit) {
        id
      }
    }
  `;

  try {
    const result = await executeHasura(mutation, {
      device: createdDevice,
      ports: provisioned.objects,
      fiberCores,
      connections,
      topologyAudit,
      resourceAudit,
    });

    return {
      deviceId: createdDevice.id,
      topology: {
        front: result.connections?.returning?.[0] || null,
        rear: result.connections?.returning?.[1] || null,
      },
      provisioning: {
        enabled: true,
        templateId: template.id,
        profileName: template.profile_name,
        requestedTotalPorts: provisioned.totalPorts,
        createdCount: result.ports?.affected_rows || 0,
      },
      fiberSync: {
        enabled: String(createdDevice.device_type_key || '').toUpperCase() === 'CABLE',
        created_count: result.fiber_cores?.affected_rows || 0,
      },
    };
  } catch (error) {
    throw topologyCreateError(error);
  }
}

module.exports = {
  hasTopologyCreateInput,
  createDeviceWithTopology,
};

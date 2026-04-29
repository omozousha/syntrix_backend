const { executeHasura } = require('../../config/hasura');

const ODC_DEVICE_TYPES = new Set(['ODC']);

async function loadDeviceById(deviceId) {
  const query = `
    query LoadDeviceById($id: uuid!) {
      item: devices_by_pk(id: $id) {
        id
        device_id
        device_name
        device_type_key
        region_id
        splitter_ratio
      }
    }
  `;
  const data = await executeHasura(query, { id: deviceId });
  return data.item || null;
}

async function loadPortsByDeviceId(deviceId) {
  const query = `
    query LoadPortsByDeviceId($deviceId: uuid!) {
      items: device_ports(
        where: { device_id: { _eq: $deviceId }, deleted_at: { _is_null: true } }
        order_by: [{ port_index: asc }]
      ) {
        id
        port_id
        port_index
        port_label
        splitter_profile_id
        splitter_ratio
        splitter_role
      }
    }
  `;
  const data = await executeHasura(query, { deviceId });
  return data.items || [];
}

async function loadConnectionsByPortIds(portIds) {
  if (!portIds.length) return [];
  const query = `
    query LoadConnectionsByPortIds($portIds: [uuid!]!) {
      items: port_connections(
        where: {
          _or: [
            { from_port_id: { _in: $portIds } }
            { to_port_id: { _in: $portIds } }
          ]
        }
      ) {
        id
        connection_id
        from_port_id
        to_port_id
        connection_type
        status
        cable_device_id
        core_start
        core_end
        fiber_count
      }
    }
  `;
  const data = await executeHasura(query, { portIds });
  return data.items || [];
}

async function loadPortsByIds(ids) {
  if (!ids.length) return [];
  const query = `
    query LoadPortsByIds($ids: [uuid!]!) {
      items: device_ports(where: { id: { _in: $ids } }) {
        id
        device_id
        port_label
        port_index
      }
    }
  `;
  const data = await executeHasura(query, { ids });
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
        splitter_ratio
      }
    }
  `;
  const data = await executeHasura(query, { ids });
  return data.items || [];
}

async function loadFiberSummaryByConnectionIds(connectionIds) {
  if (!connectionIds.length) {
    return { total: 0, used: 0 };
  }
  const query = `
    query LoadFiberSummaryByConnectionIds($connectionIds: [uuid!]!, $usedWhere: fiber_cores_bool_exp!) {
      total: fiber_cores_aggregate(where: { connection_id: { _in: $connectionIds } }) { aggregate { count } }
      used: fiber_cores_aggregate(where: $usedWhere) { aggregate { count } }
    }
  `;
  const data = await executeHasura(query, {
    connectionIds,
    usedWhere: {
      connection_id: { _in: connectionIds },
      status: { _eq: 'used' },
    },
  });
  return {
    total: data.total?.aggregate?.count || 0,
    used: data.used?.aggregate?.count || 0,
  };
}

async function loadCableDevicesByIds(ids) {
  if (!ids.length) return [];
  const query = `
    query LoadCableDevicesByIds($ids: [uuid!]!) {
      items: devices(where: { id: { _in: $ids } }) {
        id
        device_id
        device_name
        device_type_key
      }
    }
  `;
  const data = await executeHasura(query, { ids });
  return data.items || [];
}

function uniqueById(items) {
  const seen = new Set();
  const out = [];
  items.forEach((item) => {
    if (!item?.id || seen.has(item.id)) return;
    seen.add(item.id);
    out.push(item);
  });
  return out;
}

async function hasOdcPathFromPorts(odpPortIds, maxDepth = 4) {
  if (!odpPortIds.length) return false;
  const visitedPortIds = new Set(odpPortIds);
  let frontier = [...odpPortIds];

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const connections = await loadConnectionsByPortIds(frontier);
    if (!connections.length) return false;

    const nextPortIds = new Set();
    connections.forEach((edge) => {
      if (edge.from_port_id) nextPortIds.add(edge.from_port_id);
      if (edge.to_port_id) nextPortIds.add(edge.to_port_id);
    });

    const unseenPortIds = Array.from(nextPortIds).filter((id) => !visitedPortIds.has(id));
    unseenPortIds.forEach((id) => visitedPortIds.add(id));
    if (!unseenPortIds.length) continue;

    const ports = await loadPortsByIds(unseenPortIds);
    const deviceIds = Array.from(new Set(ports.map((port) => port.device_id).filter(Boolean)));
    if (!deviceIds.length) continue;
    const devices = await loadDevicesByIds(deviceIds);
    if (devices.some((device) => ODC_DEVICE_TYPES.has(String(device.device_type_key || '').toUpperCase()))) {
      return true;
    }

    frontier = unseenPortIds;
  }

  return false;
}

async function buildOdpCoreChainSummary(deviceId) {
  const device = await loadDeviceById(deviceId);
  if (!device) return null;

  const typeKey = String(device.device_type_key || '').toUpperCase();
  if (typeKey !== 'ODP') {
    return {
      device,
      is_odp: false,
      checks: {
        has_ports: false,
        has_upstream_link: false,
        has_main_splitter: false,
        has_distribution_cable: false,
        has_core_mapping: false,
        has_odc_source_path: false,
      },
      is_complete: false,
      message: 'Device is not ODP',
    };
  }

  const ports = await loadPortsByDeviceId(device.id);
  const odpPortIds = ports.map((port) => port.id);
  const edges = await loadConnectionsByPortIds(odpPortIds);
  const connectionIds = edges.map((edge) => edge.id).filter(Boolean);
  const fiberSummary = await loadFiberSummaryByConnectionIds(connectionIds);

  const peerPortIds = Array.from(
    new Set(
      edges.flatMap((edge) => [
        odpPortIds.includes(edge.from_port_id) ? edge.to_port_id : edge.from_port_id,
      ]).filter(Boolean),
    ),
  );
  const peerPorts = await loadPortsByIds(peerPortIds);
  const peerDeviceIds = Array.from(new Set(peerPorts.map((port) => port.device_id).filter(Boolean)));
  const upstreamDevices = uniqueById(await loadDevicesByIds(peerDeviceIds));

  const cableDeviceIds = Array.from(new Set(edges.map((edge) => edge.cable_device_id).filter(Boolean)));
  const distributionCables = uniqueById(await loadCableDevicesByIds(cableDeviceIds));

  const hasSplitterFromPorts = ports.some((port) => port.splitter_profile_id || (port.splitter_ratio && String(port.splitter_ratio).trim() !== ''));
  const hasSplitterFromDevice = device.splitter_ratio && String(device.splitter_ratio).trim() !== '';
  const hasCoreMapping = fiberSummary.total > 0 || edges.some((edge) => edge.core_start != null || edge.core_end != null);
  const hasOdcPath = await hasOdcPathFromPorts(odpPortIds, 4);

  const checks = {
    has_ports: ports.length > 0,
    has_upstream_link: edges.length > 0,
    has_main_splitter: Boolean(hasSplitterFromPorts || hasSplitterFromDevice),
    has_distribution_cable: distributionCables.length > 0,
    has_core_mapping: hasCoreMapping,
    has_odc_source_path: hasOdcPath,
  };

  const isComplete = Object.values(checks).every(Boolean);

  return {
    device,
    is_odp: true,
    checks,
    is_complete: isComplete,
    summary: {
      port_count: ports.length,
      upstream_link_count: edges.length,
      upstream_device_count: upstreamDevices.length,
      distribution_cable_count: distributionCables.length,
      fiber_core_total: fiberSummary.total,
      fiber_core_used: fiberSummary.used,
    },
    upstream_devices: upstreamDevices.map((item) => ({
      id: item.id,
      device_id: item.device_id,
      device_name: item.device_name,
      device_type_key: item.device_type_key,
    })),
    distribution_cables: distributionCables.map((item) => ({
      id: item.id,
      device_id: item.device_id,
      device_name: item.device_name,
      device_type_key: item.device_type_key,
    })),
  };
}

module.exports = {
  buildOdpCoreChainSummary,
};


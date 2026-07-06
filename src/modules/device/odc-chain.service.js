const { executeHasura } = require('../../config/hasura');

// ODC Chain Summary Service
// Mengevaluasi kelengkapan chain ODC: upstream OTB + downstream ODP list + core usage

async function loadDeviceById(deviceId) {
  const query = `
    query LoadOdcDeviceById($id: uuid!) {
      item: devices_by_pk(id: $id) {
        id
        device_id
        device_name
        device_type_key
        region_id
        pop_id
        status
        capacity_core
        used_core
        total_ports
        used_ports
        splitter_ratio
        feeder_port_count
        distribution_port_count
      }
    }
  `;
  const data = await executeHasura(query, { id: deviceId });
  return data.item || null;
}

async function loadPortsByDeviceId(deviceId) {
  const query = `
    query LoadOdcPortsByDeviceId($deviceId: uuid!) {
      items: device_ports(
        where: { device_id: { _eq: $deviceId }, deleted_at: { _is_null: true } }
        order_by: [{ port_index: asc }]
      ) {
        id
        port_id
        port_index
        port_label
        port_type
        direction
        status
        splitter_profile_id
        splitter_ratio
        splitter_role
        core_capacity
        core_used
      }
    }
  `;
  const data = await executeHasura(query, { deviceId });
  return data.items || [];
}

async function loadConnectionsByPortIds(portIds) {
  if (!portIds.length) return [];
  const query = `
    query LoadOdcConnectionsByPortIds($portIds: [uuid!]!) {
      items: port_connections(
        where: {
          _or: [
            { from_port_id: { _in: $portIds } }
            { to_port_id: { _in: $portIds } }
          ]
          status: { _neq: "inactive" }
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
    query LoadOdcPortsByIds($ids: [uuid!]!) {
      items: device_ports(where: { id: { _in: $ids } }) {
        id
        device_id
        port_label
        port_index
        port_type
        direction
      }
    }
  `;
  const data = await executeHasura(query, { ids });
  return data.items || [];
}

async function loadDevicesByIds(ids) {
  if (!ids.length) return [];
  const query = `
    query LoadOdcDevicesByIds($ids: [uuid!]!) {
      items: devices(where: { id: { _in: $ids } }) {
        id
        device_id
        device_name
        device_type_key
        region_id
        pop_id
        status
        splitter_ratio
        total_ports
        used_ports
      }
    }
  `;
  const data = await executeHasura(query, { ids });
  return data.items || [];
}

async function loadFiberSummaryByConnectionIds(connectionIds) {
  if (!connectionIds.length) return { total: 0, used: 0 };
  const query = `
    query LoadOdcFiberSummary($connectionIds: [uuid!]!, $usedWhere: fiber_cores_bool_exp!) {
      total: fiber_cores_aggregate(where: { connection_id: { _in: $connectionIds } }) { aggregate { count } }
      used: fiber_cores_aggregate(where: $usedWhere) { aggregate { count } }
    }
  `;
  const data = await executeHasura(query, {
    connectionIds,
    usedWhere: { connection_id: { _in: connectionIds }, status: { _eq: 'used' } },
  });
  return {
    total: data.total?.aggregate?.count || 0,
    used: data.used?.aggregate?.count || 0,
  };
}

/**
 * Bangun ODC chain summary untuk sebuah device ODC.
 *
 * Checks:
 *   has_ports           — ODC punya port inventory
 *   has_upstream_otb    — Ada koneksi ke upstream OTB
 *   has_splitter        — ODC punya splitter_ratio / splitter_profile di port
 *   has_feeder_cable    — Ada cable_device_id di koneksi upstream
 *   has_downstream_odp  — Ada >=1 koneksi ke downstream ODP
 *   has_core_mapping    — Ada core_start/end atau fiber_cores terisi
 *   is_chain_complete   — Semua checks true
 */
async function buildOdcCoreChainSummary(deviceId) {
  const device = await loadDeviceById(deviceId);
  if (!device) return null;

  const typeKey = String(device.device_type_key || '').toUpperCase();
  if (typeKey !== 'ODC') {
    return {
      device,
      is_odc: false,
      checks: {
        has_ports: false,
        has_upstream_otb: false,
        has_splitter: false,
        has_feeder_cable: false,
        has_downstream_odp: false,
        has_core_mapping: false,
      },
      is_complete: false,
      message: 'Device is not ODC',
    };
  }

  const ports = await loadPortsByDeviceId(device.id);
  const odcPortIds = ports.map((port) => port.id);
  const edges = await loadConnectionsByPortIds(odcPortIds);
  const connectionIds = edges.map((edge) => edge.id).filter(Boolean);

  // Kumpulkan semua peer port id
  const peerPortIds = Array.from(
    new Set(
      edges.flatMap((edge) => [
        odcPortIds.includes(edge.from_port_id) ? edge.to_port_id : edge.from_port_id,
      ]).filter(Boolean),
    ),
  );
  const peerPorts = await loadPortsByIds(peerPortIds);
  const peerDeviceIds = Array.from(new Set(peerPorts.map((port) => port.device_id).filter(Boolean)));
  const peerDevices = await loadDevicesByIds(peerDeviceIds);
  const peerDeviceMap = new Map(peerDevices.map((d) => [d.id, d]));

  // Klasifikasikan koneksi: upstream (ke OTB) vs downstream (ke ODP)
  const upstreamConnections = [];
  const downstreamConnections = [];
  const upstreamDevices = [];
  const downstreamDevices = [];

  edges.forEach((edge) => {
    const odcIsFrom = odcPortIds.includes(edge.from_port_id);
    const peerPortId = odcIsFrom ? edge.to_port_id : edge.from_port_id;
    const peerPort = peerPorts.find((p) => p.id === peerPortId);
    if (!peerPort) return;
    const peerDevice = peerDeviceMap.get(peerPort.device_id);
    if (!peerDevice) return;
    const peerType = String(peerDevice.device_type_key || '').toUpperCase();

    if (peerType === 'OTB') {
      upstreamConnections.push({ edge, peerPort, peerDevice });
      if (!upstreamDevices.find((d) => d.id === peerDevice.id)) upstreamDevices.push(peerDevice);
    } else if (peerType === 'ODP') {
      downstreamConnections.push({ edge, peerPort, peerDevice });
      if (!downstreamDevices.find((d) => d.id === peerDevice.id)) downstreamDevices.push(peerDevice);
    }
  });

  const fiberSummary = await loadFiberSummaryByConnectionIds(connectionIds);

  const hasSplitter = Boolean(
    (device.splitter_ratio && String(device.splitter_ratio).trim() !== '')
    || ports.some((p) => p.splitter_profile_id || (p.splitter_ratio && String(p.splitter_ratio).trim() !== '')),
  );
  const hasFeederCable = upstreamConnections.some((item) => item.edge.cable_device_id != null);
  const hasCoreMapping = fiberSummary.total > 0
    || edges.some((edge) => edge.core_start != null || edge.core_end != null);

  const checks = {
    has_ports: ports.length > 0,
    has_upstream_otb: upstreamConnections.length > 0,
    has_splitter: hasSplitter,
    has_feeder_cable: hasFeederCable,
    has_downstream_odp: downstreamConnections.length > 0,
    has_core_mapping: hasCoreMapping,
  };

  const isComplete = Object.values(checks).every(Boolean);

  const missing = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  const suggestions = [];
  if (missing.includes('has_upstream_otb')) {
    suggestions.push({ key: 'connect-upstream-otb', title: 'Hubungkan ke upstream OTB', description: 'Buat port_connection dari port ODC ke port OTB (feeder connection).', severity: 'high' });
  }
  if (missing.includes('has_splitter')) {
    suggestions.push({ key: 'set-splitter', title: 'Lengkapi splitter ratio ODC', description: 'Isi splitter_ratio di device ODC atau di port ODC.', severity: 'medium' });
  }
  if (missing.includes('has_feeder_cable')) {
    suggestions.push({ key: 'set-feeder-cable', title: 'Tentukan kabel feeder pada koneksi upstream', description: 'Set cable_device_id di port_connection ODC-OTB.', severity: 'high' });
  }
  if (missing.includes('has_downstream_odp')) {
    suggestions.push({ key: 'connect-downstream-odp', title: 'Tambah koneksi ke downstream ODP', description: 'Buat port_connection dari port distribusi ODC ke port ODP.', severity: 'high' });
  }
  if (missing.includes('has_core_mapping')) {
    suggestions.push({ key: 'map-core-range', title: 'Lengkapi mapping core', description: 'Isi core_start/core_end atau fiber_cores pada setiap koneksi ODC.', severity: 'high' });
  }

  return {
    device,
    is_odc: true,
    checks,
    is_complete: isComplete,
    missing_checks: missing,
    suggestions,
    summary: {
      port_count: ports.length,
      upstream_otb_count: upstreamDevices.length,
      downstream_odp_count: downstreamDevices.length,
      total_connection_count: edges.length,
      fiber_core_total: fiberSummary.total,
      fiber_core_used: fiberSummary.used,
    },
    upstream_devices: upstreamDevices.map((d) => ({
      id: d.id,
      device_id: d.device_id,
      device_name: d.device_name,
      device_type_key: d.device_type_key,
    })),
    downstream_odp_devices: downstreamDevices.map((d) => ({
      id: d.id,
      device_id: d.device_id,
      device_name: d.device_name,
      device_type_key: d.device_type_key,
      total_ports: d.total_ports,
      used_ports: d.used_ports,
    })),
    upstream_connections: upstreamConnections.map((item) => ({
      connection_id: item.edge.connection_id,
      status: item.edge.status,
      cable_device_id: item.edge.cable_device_id,
      core_start: item.edge.core_start,
      core_end: item.edge.core_end,
      fiber_count: item.edge.fiber_count,
      peer_device: {
        id: item.peerDevice.id,
        device_name: item.peerDevice.device_name,
        device_type_key: item.peerDevice.device_type_key,
      },
    })),
  };
}

module.exports = {
  buildOdcCoreChainSummary,
};

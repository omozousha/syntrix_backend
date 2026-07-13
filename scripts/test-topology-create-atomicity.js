const axios = require('axios');
const http = require('http');
const { randomUUID } = require('crypto');
const { executeHasura } = require('../src/config/hasura');

let baseUrl = process.env.TOPOLOGY_TEST_BASE_URL || '';
let apiBase = '';
let localServer = null;

const credentials = {
  email: process.env.TOPOLOGY_TEST_ADMIN_EMAIL || process.env.SMOKE_ADMIN_EMAIL || 'admin@syntrix.local',
  password: process.env.TOPOLOGY_TEST_ADMIN_PASSWORD || process.env.SMOKE_ADMIN_PASSWORD || 'AdminKuat123!',
};

const state = {
  token: '',
  regionId: '',
  devices: new Set(),
  templates: new Set(),
  connections: new Set(),
};

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function api(path, { method = 'GET', body } = {}) {
  return axios.request({
    url: `${apiBase}${path}`,
    method,
    data: body,
    headers: state.token ? { Authorization: `Bearer ${state.token}` } : undefined,
    validateStatus: () => true,
  });
}

async function assertStatus(response, status, label) {
  if (response.status !== status) {
    throw new Error(`${label}: expected ${status}, got ${response.status}; ${JSON.stringify(response.data)}`);
  }
}

async function login() {
  const response = await api('/auth/login', {
    method: 'POST',
    body: credentials,
  });
  await assertStatus(response, 200, 'admin login');
  const token = response.data?.data?.session?.accessToken;
  assert(token, 'admin login did not return an access token');
  state.token = token;
}

async function loadRegionId() {
  const response = await api('/regions?limit=1');
  await assertStatus(response, 200, 'load region');
  const regionId = response.data?.data?.[0]?.id;
  assert(regionId, 'No region is available for topology integration test');
  state.regionId = regionId;
}

async function ensureTemplate(deviceTypeKey, totalPorts = 4) {
  const response = await api(`/devicePortTemplates?device_type_key=${encodeURIComponent(deviceTypeKey)}&profile_name=default&limit=1`);
  await assertStatus(response, 200, `load ${deviceTypeKey} template`);
  const existing = response.data?.data?.[0];
  if (existing) return existing;

  const created = await api('/devicePortTemplates', {
    method: 'POST',
    body: {
      device_type_key: deviceTypeKey,
      profile_name: 'default',
      total_ports: totalPorts,
      start_port_index: 1,
      default_port_type: 'fiber',
      default_direction: 'bidirectional',
      default_core_capacity: 1,
      is_active: true,
    },
  });
  await assertStatus(created, 201, `create ${deviceTypeKey} template`);
  const id = created.data?.data?.id;
  if (id) state.templates.add(id);
  return created.data?.data;
}

async function createDevice({ deviceTypeKey, name, totalPorts = 4 }) {
  const normalizedType = String(deviceTypeKey || '').toUpperCase();
  const body = {
    device_name: name,
    asset_group: ['OLT', 'SWITCH', 'ONT'].includes(normalizedType) ? 'active' : 'passive',
    device_type_key: deviceTypeKey,
    region_id: state.regionId,
    status: 'installed',
    total_ports: totalPorts,
  };
  if (['OTB', 'ODC', 'JC', 'CABLE'].includes(normalizedType)) {
    body.capacity_core = 12;
  }
  if (normalizedType === 'ODP') {
    body.splitter_ratio = `1:${Math.max(8, totalPorts)}`;
  }
  const response = await api('/devices', {
    method: 'POST',
    body,
  });
  await assertStatus(response, 201, `create ${deviceTypeKey}`);
  const device = response.data?.data;
  assert(device?.id, `create ${deviceTypeKey} did not return id`);
  state.devices.add(device.id);
  return device;
}

async function getPorts(deviceId) {
  const response = await api(`/devicePorts?device_id=${deviceId}&limit=100`);
  await assertStatus(response, 200, `load ports for ${deviceId}`);
  return response.data?.data || [];
}

async function loadConnectionsForPort(portId) {
  const limit = 200;
  const response = await api(`/topology/port-connections?limit=${limit}`);
  await assertStatus(response, 200, `load connections for ${portId}`);
  const items = response.data?.data?.items || [];
  return items.filter((connection) => connection.from_port_id === portId || connection.to_port_id === portId);
}

async function findDeviceByName(name) {
  const response = await api(`/devices?q=${encodeURIComponent(name)}&limit=20`);
  await assertStatus(response, 200, `find device ${name}`);
  return (response.data?.data || []).find((device) => device.device_name === name) || null;
}

async function testSuccessAndPeerSync() {
  await ensureTemplate('OLT');
  await ensureTemplate('OTB');
  await ensureTemplate('ODC');

  const olt = await createDevice({ deviceTypeKey: 'OLT', name: `Topology Test OLT ${Date.now()}` });
  const odc = await createDevice({ deviceTypeKey: 'ODC', name: `Topology Test ODC ${Date.now()}` });
  const [oltPort] = await getPorts(olt.id);
  const [odcPort] = await getPorts(odc.id);
  assert(oltPort?.id && odcPort?.id, 'peer devices did not provision ports');

  const name = `Topology Atomic OTB ${Date.now()}`;
  const response = await api('/devices', {
    method: 'POST',
    body: {
      device_name: name,
      asset_group: 'passive',
      device_type_key: 'OTB',
      region_id: state.regionId,
      status: 'installed',
      capacity_core: 12,
      total_ports: 4,
      front_device_id: olt.id,
      front_port_id: oltPort.id,
      rear_device_id: odc.id,
      rear_port_id: odcPort.id,
    },
  });
  await assertStatus(response, 201, 'atomic OTB create');
  const otb = response.data?.data;
  assert(otb?.id, 'atomic OTB create did not return id');
  state.devices.add(otb.id);

  const otbPorts = await getPorts(otb.id);
  assert(otbPorts.length >= 2, 'atomic OTB create did not provision local ports');
  const usedOtbPorts = otbPorts.filter((port) => port.status === 'used');
  assert(usedOtbPorts.length === 2, `expected two used OTB ports, got ${usedOtbPorts.length}`);

  const oltPorts = await getPorts(olt.id);
  const odcPorts = await getPorts(odc.id);
  assert(oltPorts.find((port) => port.id === oltPort.id)?.status === 'used', 'front peer port was not synchronized to used');
  assert(odcPorts.find((port) => port.id === odcPort.id)?.status === 'used', 'rear peer port was not synchronized to used');

  return { olt, odc, oltPort, odcPort };
}

async function testAtomicFailureLeavesNoOrphan({ olt, odc, oltPort }) {
  const name = `Topology Atomic Failure ${Date.now()}`;
  const odcPorts = await getPorts(odc.id);
  const [rearPort] = odcPorts.filter((port) => port.id !== undefined);
  assert(rearPort?.id, 'missing rear test port');

  const response = await api('/devices', {
    method: 'POST',
    body: {
      device_name: name,
      asset_group: 'passive',
      device_type_key: 'OTB',
      region_id: state.regionId,
      status: 'installed',
      capacity_core: 12,
      total_ports: 4,
      front_device_id: olt.id,
      front_port_id: oltPort.id,
      rear_device_id: odc.id,
      rear_port_id: rearPort.id,
    },
  });
  await assertStatus(response, 409, 'atomic create with occupied front peer');

  const orphan = await findDeviceByName(name);
  assert(!orphan, 'failed topology create left an orphan device');
}

async function testConcurrentConflict({ olt, odc }) {
  const oltPorts = await getPorts(olt.id);
  const odcPorts = await getPorts(odc.id);
  const frontPort = oltPorts.find((port) => port.status === 'idle');
  const rearPort = odcPorts.find((port) => port.status === 'idle');
  if (!frontPort || !rearPort) {
    console.log('BE-09 skipped: no independent idle peer ports remain after fixture setup.');
    return;
  }

  const createPayload = (suffix) => ({
    device_name: `Topology Race ${suffix} ${Date.now()}`,
    asset_group: 'passive',
    device_type_key: 'OTB',
    region_id: state.regionId,
    status: 'installed',
    capacity_core: 12,
    total_ports: 4,
    front_device_id: olt.id,
    front_port_id: frontPort.id,
    rear_device_id: odc.id,
    rear_port_id: rearPort.id,
  });
  const [first, second] = await Promise.all([
    api('/devices', { method: 'POST', body: createPayload('A') }),
    api('/devices', { method: 'POST', body: createPayload('B') }),
  ]);
  const statuses = [first.status, second.status].sort();
  if (!(statuses[0] === 201 && statuses[1] === 409)) {
    const summary = [
      `first status: ${first.status}`,
      `first body: ${JSON.stringify(first.data)}`,
      `second status: ${second.status}`,
      `second body: ${JSON.stringify(second.data)}`,
    ].join('\n');
    throw new Error(`expected race [201,409], got [${statuses.join(',')}]\n${summary}`);
  }
  const winner = first.status === 201 ? first.data?.data : second.data?.data;
  if (winner?.id) state.devices.add(winner.id);

  const connections = await loadConnectionsForPort(frontPort.id);
  const activeConnections = connections.filter((connection) => ['active', 'planned', 'cutover'].includes(connection.status));
  assert(activeConnections.length === 1, `expected one active connection after race, got ${activeConnections.length}`);
}

async function testAutoProvisioningWithoutTotalPorts() {
  const template = await ensureTemplate('OTB', 12);
  const expectedPorts = template?.total_ports ? Number(template.total_ports) : 12;
  const name = `Topology Auto Prov ${Date.now()}`;
  const response = await api('/devices', {
    method: 'POST',
    body: {
      device_name: name,
      asset_group: 'passive',
      device_type_key: 'OTB',
      region_id: state.regionId,
      status: 'installed',
      capacity_core: 12
      // total_ports omitted!
    },
  });
  await assertStatus(response, 201, 'atomic OTB create without total_ports');
  const otb = response.data?.data;
  assert(otb?.id, 'did not return OTB id');
  state.devices.add(otb.id);

  const ports = await getPorts(otb.id);
  assert(ports.length === expectedPorts, `expected ${expectedPorts} ports to be provisioned, got ${ports.length}`);
}

async function testValidationMismatchAndInvalidPairs({ olt, odc, oltPort, odcPort }) {
  // BE-04: Peer port belongs to different device
  const nameMismatch = `Topology Dev Mismatch ${Date.now()}`;
  const responseMismatch = await api('/devices', {
    method: 'POST',
    body: {
      device_name: nameMismatch,
      asset_group: 'passive',
      device_type_key: 'OTB',
      region_id: state.regionId,
      status: 'installed',
      capacity_core: 12,
      total_ports: 4,
      front_device_id: odc.id, // ODC device, but OLT port!
      front_port_id: oltPort.id,
    },
  });
  await assertStatus(responseMismatch, 400, 'create OTB with front device/port mismatch');

  // BE-05: Invalid device type pair
  const odp = await createDevice({ deviceTypeKey: 'ODP', name: `Topology Test ODP ${Date.now()}`, totalPorts: 8 });
  const [odpPort] = await getPorts(odp.id);

  const nameInvalidPair = `Topology Invalid Pair ${Date.now()}`;
  const responseInvalidPair = await api('/devices', {
    method: 'POST',
    body: {
      device_name: nameInvalidPair,
      asset_group: 'passive',
      device_type_key: 'OTB',
      region_id: state.regionId,
      status: 'installed',
      capacity_core: 12,
      total_ports: 4,
      front_device_id: odp.id, // OTB front cannot be ODP!
      front_port_id: odpPort.id,
    },
  });
  await assertStatus(responseInvalidPair, 400, 'create OTB with ODP front (invalid pair)');
}

async function testNoLocalIdlePort({ olt, odc }) {
  // We create a device with total_ports: 1, but connect both front and rear (requires 2 ports).
  const oltPorts = await getPorts(olt.id);
  const odcPorts = await getPorts(odc.id);
  const idleOltPort = oltPorts.find((p) => p.status === 'idle');
  const idleOdcPort = odcPorts.find((p) => p.status === 'idle');

  if (!idleOltPort || !idleOdcPort) {
    console.log('BE-06 skipped: not enough idle peer ports');
    return;
  }

  const name = `Topology No Local Idle ${Date.now()}`;
  const response = await api('/devices', {
    method: 'POST',
    body: {
      device_name: name,
      asset_group: 'passive',
      device_type_key: 'OTB',
      region_id: state.regionId,
      status: 'installed',
      capacity_core: 12,
      total_ports: 1, // Only 1 local port!
      front_device_id: olt.id,
      front_port_id: idleOltPort.id,
      rear_device_id: odc.id,
      rear_port_id: idleOdcPort.id,
    },
  });
  await assertStatus(response, 409, 'create topology with insufficient local ports');
}

async function testDisconnectUsageSync() {
  const olt = await createDevice({ deviceTypeKey: 'OLT', name: `Topology Sync OLT ${Date.now()}` });
  const odc = await createDevice({ deviceTypeKey: 'ODC', name: `Topology Sync ODC ${Date.now()}` });
  const [oltPort] = await getPorts(olt.id);
  const [odcPort] = await getPorts(odc.id);

  const otb = await createDevice({
    deviceTypeKey: 'OTB',
    name: `Topology Sync OTB ${Date.now()}`,
    totalPorts: 4,
  });

  // Verify initial counts
  const oltInitial = (await api(`/devices/${olt.id}`)).data?.data;
  assert(oltInitial.used_ports === 0, 'OLT used_ports should be 0');

  // Let's connect them manually
  const conn = await api('/topology/port-connections', {
    method: 'POST',
    body: {
      region_id: state.regionId,
      from_port_id: oltPort.id,
      to_port_id: (await getPorts(otb.id))[0].id,
      connection_type: 'fiber',
      status: 'active',
    },
  });
  await assertStatus(conn, 201, 'create manual connection');
  const connection = conn.data?.data?.connection || conn.data?.data;

  // Verify updated counts
  const oltAfter = (await api(`/devices/${olt.id}`)).data?.data;
  assert(oltAfter.used_ports === 1, `OLT used_ports should be 1, got ${oltAfter.used_ports}`);

  // Delete/disconnect
  const deleted = await api(`/topology/port-connections/${connection.id}`, {
    method: 'DELETE',
  });
  await assertStatus(deleted, 200, 'delete manual connection');

  // Verify synced back
  const oltFinal = (await api(`/devices/${olt.id}`)).data?.data;
  assert(oltFinal.used_ports === 0, `OLT used_ports should be 0 after delete, got ${oltFinal.used_ports}`);
}

async function testTraceAndLinkBudget(otb) {
  // BE-10 & BE-11: trace
  const trace = await api(`/devices/${otb.id}/trace?max_depth=6`);
  await assertStatus(trace, 200, 'fetch device trace');
  const summary = trace.data?.data?.summary;
  assert(summary, 'missing trace summary');
  assert(summary.node_count >= 3, `expected at least 3 nodes in trace, got ${summary.node_count}`);

  // BE-12: calculate link budget
  const budget = await api(`/devices/${otb.id}/link-budget/calculate`, {
    method: 'POST',
    body: {
      splitter_ratios: ['1:4', '1:8'],
      segments: [
        { label: 'Feeder', distance_km: 1.2, splice_count: 2, connector_count: 2 },
      ],
      gpon_class: 'B_plus',
      engineering_margin_db: 3.0,
      measured_loss_db: 22.5,
    },
  });
  await assertStatus(budget, 200, 'calculate link budget');
  const budgetData = budget.data?.data;
  assert(budgetData.calculated_loss_db > 0, 'calculated_loss_db should be positive');
  assert(budgetData.margin_db !== undefined, 'missing margin_db');
  assert(Array.isArray(budgetData.warnings), 'warnings should be an array');
}

async function cleanup() {
  for (const deviceId of state.devices) {
    try {
      await api(`/devices/${deviceId}`, { method: 'DELETE' });
    } catch (_error) {
      // Test cleanup must not obscure assertion failures.
    }
  }
  for (const templateId of state.templates) {
    try {
      await api(`/devicePortTemplates/${templateId}`, { method: 'DELETE' });
    } catch (_error) {
      // Existing production template cleanup is intentionally best effort.
    }
  }
}

async function main() {
  try {
    if (!baseUrl) {
      process.env.VERCEL = '1';
      const app = require('../app');
      localServer = http.createServer(app);
      await new Promise((resolve, reject) => {
        localServer.listen(0, '127.0.0.1', (error) => (error ? reject(error) : resolve()));
      });
      baseUrl = `http://127.0.0.1:${localServer.address().port}`;
    }
    apiBase = `${baseUrl}/api/v1`;

    const health = await axios.get(`${baseUrl}/health`);
    assert(health.data?.success, 'health endpoint is not healthy');
    await login();
    await loadRegionId();

    const fixtures = await testSuccessAndPeerSync();
    await testAtomicFailureLeavesNoOrphan(fixtures);
    await testConcurrentConflict(fixtures);
    await testAutoProvisioningWithoutTotalPorts();
    await testValidationMismatchAndInvalidPairs(fixtures);
    await testNoLocalIdlePort(fixtures);
    await testDisconnectUsageSync();

    // Skenario Trace & Link Budget: create a dedicated connected OTB
    const traceOlt = await createDevice({ deviceTypeKey: 'OLT', name: `Trace OLT ${Date.now()}` });
    const traceOdc = await createDevice({ deviceTypeKey: 'ODC', name: `Trace ODC ${Date.now()}` });
    const [traceOltPort] = await getPorts(traceOlt.id);
    const [traceOdcPort] = await getPorts(traceOdc.id);
    const traceOtb = await api('/devices', {
      method: 'POST',
      body: {
        device_name: `Trace OTB ${Date.now()}`,
        asset_group: 'passive',
        device_type_key: 'OTB',
        region_id: state.regionId,
        status: 'installed',
        capacity_core: 12,
        total_ports: 4,
        front_device_id: traceOlt.id,
        front_port_id: traceOltPort.id,
        rear_device_id: traceOdc.id,
        rear_port_id: traceOdcPort.id,
      },
    });
    await assertStatus(traceOtb, 201, 'create connected OTB for trace/budget');
    const freshOtb = traceOtb.data?.data;
    if (freshOtb?.id) state.devices.add(freshOtb.id);
    await testTraceAndLinkBudget(freshOtb);

    console.log('Topology atomicity integration test PASSED');
  } catch (error) {
    console.error('Topology atomicity integration test FAILED:', error.message || error);
    process.exitCode = 1;
  } finally {
    await cleanup();
    if (localServer) {
      await new Promise((resolve) => localServer.close(resolve));
    }
  }
}

main();

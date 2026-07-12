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
  const response = await api(`/portConnections?from_port_id=${portId}&limit=100`);
  await assertStatus(response, 200, `load connections for ${portId}`);
  return response.data?.data || [];
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

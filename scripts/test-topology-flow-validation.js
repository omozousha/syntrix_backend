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

async function createDevice({ deviceTypeKey, name, totalPorts, frontDeviceId, frontPortId, rearDeviceId, rearPortId }) {
  const normalizedType = String(deviceTypeKey || '').toUpperCase();
  const body = {
    device_name: name,
    asset_group: ['OLT', 'SWITCH', 'ONT'].includes(normalizedType) ? 'active' : 'passive',
    device_type_key: deviceTypeKey,
    region_id: state.regionId,
    status: 'installed',
  };
  if (totalPorts !== undefined) {
    body.total_ports = totalPorts;
  }
  if (['OTB', 'ODC', 'JC', 'CABLE'].includes(normalizedType)) {
    body.capacity_core = 12;
  }
  if (normalizedType === 'ODP') {
    body.splitter_ratio = `1:${Math.max(8, totalPorts || 8)}`;
  }
  if (frontDeviceId) body.front_device_id = frontDeviceId;
  if (frontPortId) body.front_port_id = frontPortId;
  if (rearDeviceId) body.rear_device_id = rearDeviceId;
  if (rearPortId) body.rear_port_id = rearPortId;

  const response = await api('/devices', {
    method: 'POST',
    body,
  });
  return response;
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

// BE-01: Auto-provisioning from template when total_ports is omitted
async function testBE01() {
  console.log('--- Testing BE-01: Auto-provision ports from template when total_ports is omitted ---');
  const template = await ensureTemplate('OTB', 6); // default to 6 ports if created new
  const expectedPortCount = template ? Number(template.total_ports) : 6;
  const name = `OTB BE-01 ${Date.now()}`;
  const response = await createDevice({
    deviceTypeKey: 'OTB',
    name,
    totalPorts: undefined, // omitted to trigger template default
  });
  await assertStatus(response, 201, 'BE-01 Create OTB');
  const device = response.data?.data;
  assert(device?.id, 'Device id must exist');
  state.devices.add(device.id);

  const ports = await getPorts(device.id);
  assert(ports.length === expectedPortCount, `Expected exactly ${expectedPortCount} ports provisioned from template, got ${ports.length}`);
  console.log('BE-01: Auto-provisioning PASSED');
  return device;
}

// BE-04: Mismatched peer device port ownership (should return 400)
async function testBE04() {
  console.log('--- Testing BE-04: Mismatched peer device port ownership ---');
  const olt = await createDevice({ deviceTypeKey: 'OLT', name: `OLT BE-04 ${Date.now()}`, totalPorts: 4 });
  await assertStatus(olt, 201, 'Create OLT for BE-04');
  state.devices.add(olt.data.data.id);

  const odc = await createDevice({ deviceTypeKey: 'ODC', name: `ODC BE-04 ${Date.now()}`, totalPorts: 4 });
  await assertStatus(odc, 201, 'Create ODC for BE-04');
  state.devices.add(odc.data.data.id);

  const oltPorts = await getPorts(olt.data.data.id);
  const odcPorts = await getPorts(odc.data.data.id);

  // Attempt to connect front to OLT but provide a port belonging to ODC
  const failResponse = await createDevice({
    deviceTypeKey: 'OTB',
    name: `OTB BE-04 Mismatch ${Date.now()}`,
    totalPorts: 4,
    frontDeviceId: olt.data.data.id,
    frontPortId: odcPorts[0].id, // Port belonging to ODC!
  });

  assert(failResponse.status === 400, `Expected 400 Bad Request, got ${failResponse.status}`);
  assert(
    String(failResponse.data?.message || failResponse.data?.error || '').includes('belong to selected'),
    'Expected error message about port not belonging to selected device'
  );
  console.log('BE-04: Mismatched peer ownership check PASSED');
}

// BE-05: Invalid device type pair (should return 400)
async function testBE05() {
  console.log('--- Testing BE-05: Invalid device type pair ---');
  const olt = await createDevice({ deviceTypeKey: 'OLT', name: `OLT BE-05 ${Date.now()}`, totalPorts: 4 });
  await assertStatus(olt, 201, 'Create OLT for BE-05');
  state.devices.add(olt.data.data.id);

  const odp = await createDevice({ deviceTypeKey: 'ODP', name: `ODP BE-05 ${Date.now()}`, totalPorts: 8 });
  await assertStatus(odp, 201, 'Create ODP for BE-05');
  state.devices.add(odp.data.data.id);

  const odpPorts = await getPorts(odp.data.data.id);

  // OTB front cannot connect to ODP (allowed: OLT/SWITCH)
  const failResponse = await createDevice({
    deviceTypeKey: 'OTB',
    name: `OTB BE-05 Invalid Pair ${Date.now()}`,
    totalPorts: 4,
    frontDeviceId: odp.data.data.id,
    frontPortId: odpPorts[0].id,
  });

  assert(failResponse.status === 400, `Expected 400 Bad Request, got ${failResponse.status}`);
  assert(
    String(failResponse.data?.message || failResponse.data?.error || '').includes('device type ODP is not allowed'),
    'Expected error message about ODP device type not being allowed'
  );
  console.log('BE-05: Invalid device type pair check PASSED');
}

// BE-06: Not enough local ports (No local idle port, should return 409)
async function testBE06() {
  console.log('--- Testing BE-06: Not enough local ports ---');
  const olt = await createDevice({ deviceTypeKey: 'OLT', name: `OLT BE-06 ${Date.now()}`, totalPorts: 4 });
  await assertStatus(olt, 201, 'Create OLT for BE-06');
  state.devices.add(olt.data.data.id);

  const oltPorts = await getPorts(olt.data.data.id);

  const odc = await createDevice({ deviceTypeKey: 'ODC', name: `ODC BE-06 ${Date.now()}`, totalPorts: 4 });
  await assertStatus(odc, 201, 'Create ODC for BE-06');
  state.devices.add(odc.data.data.id);

  const odcPorts = await getPorts(odc.data.data.id);

  // Attempt to create OTB with 1 total_port but requesting BOTH front and rear connections (requires 2)
  const failResponse = await createDevice({
    deviceTypeKey: 'OTB',
    name: `OTB BE-06 No local ports ${Date.now()}`,
    totalPorts: 1,
    frontDeviceId: olt.data.data.id,
    frontPortId: oltPorts[0].id,
    rearDeviceId: odc.data.data.id,
    rearPortId: odcPorts[0].id,
  });

  assert(failResponse.status === 409, `Expected 409 Conflict, got ${failResponse.status}`);
  assert(
    String(failResponse.data?.message || failResponse.data?.error || '').includes('enough idle local ports'),
    'Expected error message about not enough idle local ports'
  );
  console.log('BE-06: Local port check PASSED');
}

// BE-03: Peer port already used (should return 409)
async function testBE03() {
  console.log('--- Testing BE-03: Peer port already used ---');
  const olt = await createDevice({ deviceTypeKey: 'OLT', name: `OLT BE-03 ${Date.now()}`, totalPorts: 4 });
  await assertStatus(olt, 201, 'Create OLT for BE-03');
  state.devices.add(olt.data.data.id);

  const oltPorts = await getPorts(olt.data.data.id);

  // Connect OTB A to OLT Port 0
  const otbA = await createDevice({
    deviceTypeKey: 'OTB',
    name: `OTB BE-03 A ${Date.now()}`,
    totalPorts: 4,
    frontDeviceId: olt.data.data.id,
    frontPortId: oltPorts[0].id,
  });
  await assertStatus(otbA, 201, 'Create OTB A');
  state.devices.add(otbA.data.data.id);

  // Attempt to connect OTB B to the same OLT Port 0
  const otbB = await createDevice({
    deviceTypeKey: 'OTB',
    name: `OTB BE-03 B ${Date.now()}`,
    totalPorts: 4,
    frontDeviceId: olt.data.data.id,
    frontPortId: oltPorts[0].id, // same port!
  });

  assert(otbB.status === 409, `Expected 409 Conflict, got ${otbB.status}`);
  assert(
    String(otbB.data?.message || otbB.data?.error || '').includes('sudah digunakan') || String(otbB.data?.message || '').includes('not idle'),
    'Expected conflict error message about port being used'
  );
  console.log('BE-03: Port already used check PASSED');
}

// BE-08: Disconnect connection -> Usage synced for all affected devices (status updates back to idle)
async function testBE08() {
  console.log('--- Testing BE-08: Disconnect connection updates port status back to idle ---');
  const olt = await createDevice({ deviceTypeKey: 'OLT', name: `OLT BE-08 ${Date.now()}`, totalPorts: 4 });
  await assertStatus(olt, 201, 'Create OLT for BE-08');
  state.devices.add(olt.data.data.id);

  const oltPorts = await getPorts(olt.data.data.id);

  const otb = await createDevice({
    deviceTypeKey: 'OTB',
    name: `OTB BE-08 ${Date.now()}`,
    totalPorts: 4,
    frontDeviceId: olt.data.data.id,
    frontPortId: oltPorts[0].id,
  });
  await assertStatus(otb, 201, 'Create OTB for BE-08');
  state.devices.add(otb.data.data.id);

  // Check both ports are used
  let updatedOltPorts = await getPorts(olt.data.data.id);
  let otbPorts = await getPorts(otb.data.data.id);
  assert(updatedOltPorts[0].status === 'used', 'OLT Port must be used');
  assert(otbPorts[0].status === 'used', 'OTB Port must be used');

  // Load connection
  const connections = await loadConnectionsForPort(oltPorts[0].id);
  assert(connections.length > 0, 'Should find a port connection');
  const conn = connections[0];

  // Disconnect connection via DELETE /portConnections/:id
  const deleteResponse = await api(`/portConnections/${conn.id}`, { method: 'DELETE' });
  await assertStatus(deleteResponse, 200, 'Delete connection');

  // Verify ports are back to idle
  updatedOltPorts = await getPorts(olt.data.data.id);
  otbPorts = await getPorts(otb.data.data.id);
  assert(updatedOltPorts[0].status === 'idle', `OLT Port status should be idle, got ${updatedOltPorts[0].status}`);
  assert(otbPorts[0].status === 'idle', `OTB Port status should be idle, got ${otbPorts[0].status}`);

  console.log('BE-08: Disconnect sync PASSED');
}

// BE-10 & BE-11: Trace through JC and Cable
async function testBE10_11() {
  console.log('--- Testing BE-10 & BE-11: Trace through JC and Cable ---');
  await ensureTemplate('OLT');
  await ensureTemplate('OTB');
  await ensureTemplate('ODC');
  await ensureTemplate('JC');
  await ensureTemplate('ODP');
  await ensureTemplate('CABLE');

  // Step 1: Create devices
  const olt = await createDevice({ deviceTypeKey: 'OLT', name: `OLT Trace ${Date.now()}`, totalPorts: 4 });
  await assertStatus(olt, 201, 'Create OLT');
  state.devices.add(olt.data.data.id);

  const oltPorts = await getPorts(olt.data.data.id);

  // Create OTB connected to OLT
  const otb = await createDevice({
    deviceTypeKey: 'OTB',
    name: `OTB Trace ${Date.now()}`,
    totalPorts: 4,
    frontDeviceId: olt.data.data.id,
    frontPortId: oltPorts[0].id,
  });
  await assertStatus(otb, 201, 'Create OTB');
  state.devices.add(otb.data.data.id);

  const otbPorts = await getPorts(otb.data.data.id);

  // Create JC (standalone first)
  const jc = await createDevice({
    deviceTypeKey: 'JC',
    name: `JC Trace ${Date.now()}`,
    totalPorts: 4,
  });
  await assertStatus(jc, 201, 'Create JC');
  state.devices.add(jc.data.data.id);

  const jcPorts = await getPorts(jc.data.data.id);

  // Create ODP connected to JC (front of ODP is JC)
  const odp = await createDevice({
    deviceTypeKey: 'ODP',
    name: `ODP Trace ${Date.now()}`,
    totalPorts: 8,
    frontDeviceId: jc.data.data.id,
    frontPortId: jcPorts[0].id,
  });
  await assertStatus(odp, 201, 'Create ODP');
  state.devices.add(odp.data.data.id);

  // Create CABLE connected to OTB (front of CABLE is OTB) and JC (rear of CABLE is JC)
  const cable = await createDevice({
    deviceTypeKey: 'CABLE',
    name: `CABLE Trace ${Date.now()}`,
    totalPorts: 4,
    frontDeviceId: otb.data.data.id,
    frontPortId: otbPorts[1].id, // port 2 of OTB
    rearDeviceId: jc.data.data.id,
    rearPortId: jcPorts[1].id, // port 2 of JC
  });
  await assertStatus(cable, 201, 'Create CABLE');
  state.devices.add(cable.data.data.id);

  // Now trace from OTB
  const traceResponse = await api(`/devices/${otb.data.data.id}/trace`);
  await assertStatus(traceResponse, 200, 'Trace OTB');

  const traceData = traceResponse.data?.data;
  assert(traceData, 'Trace data should be returned');
  const nodes = traceData.graph?.nodes || [];
  const links = traceData.graph?.links || [];

  // We expect OLT, OTB, CABLE, JC, ODP to be in the graph nodes
  const nodeIds = nodes.map((n) => n.id);
  assert(nodeIds.includes(olt.data.data.id), 'OLT should be in trace nodes');
  assert(nodeIds.includes(otb.data.data.id), 'OTB should be in trace nodes');
  assert(nodeIds.includes(cable.data.data.id), 'CABLE should be in trace nodes');
  assert(nodeIds.includes(jc.data.data.id), 'JC should be in trace nodes');
  assert(nodeIds.includes(odp.data.data.id), 'ODP should be in trace nodes');

  console.log('BE-10 & BE-11: Trace through JC and Cable PASSED');
  return odp.data.data;
}

// BE-12: Link budget calculation & estimate storage
async function testBE12(odpDevice) {
  console.log('--- Testing BE-12: Link budget calculation & estimate storage ---');
  assert(odpDevice?.id, 'ODP device must be provided for link budget test');

  // Step 1: Calculate Link Budget
  const calcResponse = await api(`/devices/${odpDevice.id}/link-budget/calculate`, {
    method: 'POST',
    body: {
      splitter_ratios: ['1:4', '1:8'],
      segments: [
        { label: 'Feeder', distance_km: 1.5, splice_count: 3, connector_count: 2 },
        { label: 'Distribution', distance_km: 0.8, splice_count: 2, connector_count: 2 },
      ],
      gpon_class: 'B_plus',
      engineering_margin_db: 3.0,
      measured_loss_db: 24.5,
    },
  });
  await assertStatus(calcResponse, 200, 'Calculate Link Budget');

  const calcData = calcResponse.data?.data;
  assert(calcData, 'Calculation result should exist');
  assert(calcData.calculated_loss_db > 15, 'Calculated loss should be computed and non-trivial');
  assert(calcData.gpon_class === 'B_plus', 'GPON Class should match input');
  assert(calcData.gpon_budget_db === 28.0, 'GPON Budget for B+ should be 28.0 dB');

  // Step 2: Store Link Budget Estimate
  const putResponse = await api(`/devices/${odpDevice.id}/link-budget`, {
    method: 'PUT',
    body: {
      gpon_class: 'B_plus',
      calculated_loss_db: calcData.calculated_loss_db,
      measured_loss_db: 24.5,
      ont_rx_power_dbm: -22.5,
      olt_tx_power_dbm: 2.0,
      engineering_margin_db: 3.0,
      measurement_date: '2026-07-12',
      measurement_method: 'otdr',
      notes: 'Test note from integration test',
      warnings: calcData.warnings || [],
    },
  });
  await assertStatus(putResponse, 200, 'Save Link Budget');

  const savedData = putResponse.data?.data;
  assert(savedData?.id, 'Saved estimate should have id');
  assert(savedData.device_id === odpDevice.id, 'Saved estimate device_id matches');
  assert(savedData.gpon_class === 'B_plus', 'Saved GPON Class matches');
  assert(savedData.notes === 'Test note from integration test', 'Saved notes matches');

  // Step 3: Fetch stored Link Budget
  const getResponse = await api(`/devices/${odpDevice.id}/link-budget`);
  await assertStatus(getResponse, 200, 'Get Link Budget');

  const fetchedData = getResponse.data?.data;
  assert(fetchedData?.estimate, 'Should return saved estimate');
  assert(fetchedData.estimate.id === savedData.id, 'Fetched ID matches saved ID');
  assert(fetchedData.estimate.ont_rx_power_dbm === -22.5, 'Fetched ONT Rx Power matches');

  console.log('BE-12: Link budget calculate & save PASSED');
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

    // Run tests
    await testBE01();
    await testBE04();
    await testBE05();
    await testBE06();
    await testBE03();
    await testBE08();
    const odp = await testBE10_11();
    await testBE12(odp);

    console.log('--- ALL BE TOPOLOGY INTEGRATION TESTS PASSED ---');
  } catch (error) {
    console.error('Topology integration test FAILED:', error.message || error);
    process.exitCode = 1;
  } finally {
    await cleanup();
    if (localServer) {
      await new Promise((resolve) => localServer.close(resolve));
    }
  }
}

if (require.main === module) {
  main();
}

const axios = require('axios');
const http = require('http');

let apiBase = '';
let baseUrl = '';
let localServer = null;

const validatorCreds = {
  email: process.env.VALIDATION_TEST_VALIDATOR_EMAIL || 'admin@syntrix.local',
  password: process.env.VALIDATION_TEST_VALIDATOR_PASSWORD || 'AdminKuat123!',
};

async function bootLocalServer() {
  process.env.VERCEL = '1';
  const app = require('../app');
  localServer = http.createServer(app);
  await new Promise((resolve, reject) => {
    localServer.listen(0, '127.0.0.1', (error) => {
      if (error) return reject(error);
      return resolve();
    });
  });
  const address = localServer.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
  apiBase = `${baseUrl}/api/v1`;
}

async function login(email, password) {
  const response = await axios.post(`${apiBase}/auth/login`, { email, password });
  const token = response.data?.data?.session?.accessToken;
  if (!token) throw new Error('No token returned');
  return token;
}

async function api(path, { method = 'GET', token, body } = {}) {
  return axios.request({
    url: `${apiBase}${path}`,
    method,
    data: body,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    validateStatus: () => true,
  });
}

function ensure(response, expectedStatus, label) {
  if (response.status !== expectedStatus) {
    throw new Error(`${label} expected ${expectedStatus} got ${response.status} body=${JSON.stringify(response.data)}`);
  }
}

async function main() {
  let deviceId = null;
  try {
    await bootLocalServer();
    const health = await axios.get(`${baseUrl}/health`);
    if (!health.data?.success) throw new Error('Health check failed');

    const validatorToken = await login(validatorCreds.email, validatorCreds.password);
    const me = await api('/auth/me', { token: validatorToken });
    ensure(me, 200, 'auth/me');

    const role = String(me.data?.data?.role || '');
    if (role !== 'user_region') {
      throw new Error(`Expected validator role user_region for this script, got ${role || '-'}`);
    }

    const regionId = me.data?.data?.app_user?.default_region_id || me.data?.data?.region_ids?.[0];
    if (!regionId) throw new Error('Validator region scope not found');

    // Regression: create ODP existing flow still works, including auto-generated ports based on total_ports.
    const createDevice = await api('/devices', {
      method: 'POST',
      token: validatorToken,
      body: {
        device_name: `ODP Auth Regression ${Date.now()}`,
        asset_group: 'passive',
        device_type_key: 'ODP',
        region_id: regionId,
        status: 'installed',
        total_ports: 8,
        used_ports: 0,
        splitter_ratio: '1:16',
      },
    });
    ensure(createDevice, 201, 'create ODP');
    deviceId = createDevice.data?.data?.id;
    if (!deviceId) throw new Error('No deviceId returned');

    const ports = await api(`/devicePorts?page=1&limit=100&device_id=${encodeURIComponent(deviceId)}`, { token: validatorToken });
    ensure(ports, 200, 'list devicePorts');
    const rows = ports.data?.data || [];
    if (rows.length !== 8) {
      throw new Error(`Expected generated ports count=8, got ${rows.length}`);
    }

    // Authorization checks tied to workflow endpoint.
    const submitByValidator = await api('/validation-requests', {
      method: 'POST',
      token: validatorToken,
      body: {
        entity_id: deviceId,
        payload_snapshot: { source: 'auth-regression' },
        checklist: { physical_ok: true },
      },
    });
    ensure(submitByValidator, 201, 'submit validation by validator must be allowed');

    const adminRegionQueueByValidator = await api('/validation-requests?queue=adminregion', { token: validatorToken });
    ensure(adminRegionQueueByValidator, 400, 'adminregion queue by validator must be rejected');

    const superadminQueueByValidator = await api('/validation-requests?queue=superadmin', { token: validatorToken });
    ensure(superadminQueueByValidator, 400, 'superadmin queue by validator must be rejected');

    console.log('Validation validator-auth + ODP regression checks PASSED');
  } catch (error) {
    console.error('Validation auth + ODP regression checks FAILED:', error.message || error);
    process.exitCode = 1;
  } finally {
    try {
      if (deviceId) {
        const validatorToken = await login(validatorCreds.email, validatorCreds.password);
        await api(`/devices/${deviceId}`, { method: 'DELETE', token: validatorToken });
      }
    } catch (_error) {
      // ignore cleanup failure
    }
    if (localServer) {
      await new Promise((resolve) => localServer.close(() => resolve()));
    }
  }
}

main();

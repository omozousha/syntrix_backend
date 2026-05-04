const axios = require('axios');
const http = require('http');

let baseUrl = process.env.VALIDATION_TEST_BASE_URL || '';
let apiBase = '';
let localServer = null;

const creds = {
  superadmin: {
    email: process.env.VALIDATION_TEST_SUPERADMIN_EMAIL || 'superadmin.test@syntrix.local',
    password: process.env.VALIDATION_TEST_SUPERADMIN_PASSWORD || 'Syntrix@12345',
  },
  adminregion: {
    email: process.env.VALIDATION_TEST_ADMINREGION_EMAIL || 'adminregion.test@syntrix.local',
    password: process.env.VALIDATION_TEST_ADMINREGION_PASSWORD || 'Syntrix@12345',
  },
  validator: {
    email: process.env.VALIDATION_TEST_VALIDATOR_EMAIL || 'validator.test@syntrix.local',
    password: process.env.VALIDATION_TEST_VALIDATOR_PASSWORD || 'Syntrix@12345',
  },
};

function normalizeRole(role) {
  if (role === 'admin') return 'superadmin';
  if (role === 'user_all_region') return 'adminregion';
  if (role === 'user_region') return 'validator';
  return role;
}

async function login(email, password) {
  const response = await axios.post(`${apiBase}/auth/login`, { email, password });
  const token = response.data?.data?.session?.accessToken;
  if (!token) {
    throw new Error(`Login failed, no access token for ${email}`);
  }
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

async function assertStatus(response, expectedStatus, label) {
  if (response.status !== expectedStatus) {
    const body = typeof response.data === 'object' ? JSON.stringify(response.data) : String(response.data);
    throw new Error(`${label}: expected ${expectedStatus}, got ${response.status}. body=${body}`);
  }
}

async function main() {
  const state = {
    deviceId: null,
    requestId: null,
  };

  try {
    if (!baseUrl) {
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
    }
    apiBase = `${baseUrl}/api/v1`;

    const health = await axios.get(`${baseUrl}/health`);
    if (!health.data?.success) {
      throw new Error('Health endpoint is not healthy');
    }

    const superadminToken = await login(creds.superadmin.email, creds.superadmin.password);
    const adminregionToken = await login(creds.adminregion.email, creds.adminregion.password);
    const validatorToken = await login(creds.validator.email, creds.validator.password);

    const meSuperadmin = await api('/auth/me', { token: superadminToken });
    const meAdminregion = await api('/auth/me', { token: adminregionToken });
    const meValidator = await api('/auth/me', { token: validatorToken });
    await assertStatus(meSuperadmin, 200, 'superadmin /auth/me');
    await assertStatus(meAdminregion, 200, 'adminregion /auth/me');
    await assertStatus(meValidator, 200, 'validator /auth/me');

    if (normalizeRole(meSuperadmin.data?.data?.role) !== 'superadmin') throw new Error('Role mismatch for superadmin');
    if (normalizeRole(meAdminregion.data?.data?.role) !== 'adminregion') throw new Error('Role mismatch for adminregion');
    if (normalizeRole(meValidator.data?.data?.role) !== 'validator') throw new Error('Role mismatch for validator');

    const validatorRegions = meValidator.data?.data?.region_ids || [];
    const regionId = validatorRegions[0] || meValidator.data?.data?.app_user?.default_region_id;
    if (!regionId) throw new Error('Validator has no region scope');

    const createDevice = await api('/devices', {
      method: 'POST',
      token: superadminToken,
      body: {
        device_name: `ODP Validation Test ${Date.now()}`,
        asset_group: 'passive',
        device_type_key: 'ODP',
        region_id: regionId,
        status: 'installed',
        total_ports: 8,
        used_ports: 0,
        splitter_ratio: '1:8',
      },
    });
    await assertStatus(createDevice, 201, 'create test ODP');
    state.deviceId = createDevice.data?.data?.id;
    if (!state.deviceId) throw new Error('Failed to create test ODP');

    const submitRequest = await api('/validation-requests', {
      method: 'POST',
      token: validatorToken,
      body: {
        entity_id: state.deviceId,
        checklist: {
          physical_ok: true,
          splitter_ok: true,
          port_mapping_ok: true,
          qr_label_ok: true,
          label_ok: true,
        },
        finding_note: 'Validation request integration test flow.',
        payload_snapshot: {
          source: 'automated-test',
          device: {
            id: state.deviceId,
            status: 'installed',
            total_ports: 8,
            used_ports: 0,
          },
          device_ports: [],
        },
        evidence_attachments: [],
      },
    });
    await assertStatus(submitRequest, 201, 'validator submit validation request');
    state.requestId = submitRequest.data?.data?.id;
    if (!state.requestId) throw new Error('Missing request id from submit');

    const validatorQueueDenied = await api('/validation-requests?queue=adminregion', { token: validatorToken });
    if (![400, 403].includes(validatorQueueDenied.status)) {
      throw new Error(`validator queue auth should fail, got ${validatorQueueDenied.status}`);
    }

    const queueAdmin = await api('/validation-requests?queue=adminregion', { token: adminregionToken });
    await assertStatus(queueAdmin, 200, 'adminregion queue');
    const adminItem = (queueAdmin.data?.data || []).find((item) => item.id === state.requestId);
    if (!adminItem) throw new Error('Request not found in adminregion queue');

    const approveAdmin = await api(`/validation-requests/${state.requestId}/adminregion/approve`, {
      method: 'POST',
      token: adminregionToken,
    });
    await assertStatus(approveAdmin, 200, 'adminregion approve');

    const queueSuperadmin = await api('/validation-requests?queue=superadmin', { token: superadminToken });
    await assertStatus(queueSuperadmin, 200, 'superadmin queue');
    const superadminItem = (queueSuperadmin.data?.data || []).find((item) => item.id === state.requestId);
    if (!superadminItem) throw new Error('Request not found in superadmin queue');

    const approveSuperadmin = await api(`/validation-requests/${state.requestId}/superadmin/approve`, {
      method: 'POST',
      token: superadminToken,
    });
    await assertStatus(approveSuperadmin, 200, 'superadmin approve');

    const history = await api(`/validation-requests/${state.requestId}/history`, { token: superadminToken });
    await assertStatus(history, 200, 'request history');
    const actions = (history.data?.data?.history || []).map((item) => item.action_type);
    const expectedActions = ['submitted', 'approved_by_adminregion', 'applied_to_asset', 'approved_by_superadmin'];
    for (const action of expectedActions) {
      if (!actions.includes(action)) {
        throw new Error(`Missing history action: ${action}`);
      }
    }

    const deviceAfter = await api(`/devices/${state.deviceId}`, { token: superadminToken });
    await assertStatus(deviceAfter, 200, 'load device after approve');
    const validationStatus = String(deviceAfter.data?.data?.validation_status || '');
    if (validationStatus !== 'validated') {
      throw new Error(`Expected device validation_status=validated, got ${validationStatus || '-'}`);
    }

    console.log('Validation workflow test PASSED');
  } catch (error) {
    const message = error.message || String(error);
    if (String(message).includes('401')) {
      console.error(
        'Validation workflow test FAILED: login 401. Pastikan akun validator/adminregion/superadmin untuk test sudah verified dan password env VALIDATION_TEST_* benar.',
      );
    } else {
      console.error('Validation workflow test FAILED:', message);
    }
    process.exitCode = 1;
  } finally {
    if (state.deviceId) {
      try {
        const superadminToken = await login(creds.superadmin.email, creds.superadmin.password);
        await api(`/devices/${state.deviceId}`, { method: 'DELETE', token: superadminToken });
      } catch (_error) {
        // Ignore cleanup errors.
      }
    }
    if (localServer) {
      await new Promise((resolve) => localServer.close(() => resolve()));
    }
  }
}

main();

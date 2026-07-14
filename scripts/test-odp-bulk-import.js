const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const XLSX = require('xlsx');

// Force dotenv loading so environment variables are populated.
require('../src/config/hasura');

const baseUrl = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const apiBase = `${baseUrl}/api/v1`;
const email = process.env.TOPOLOGY_TEST_ADMIN_EMAIL || process.env.SMOKE_ADMIN_EMAIL || 'admin@syntrix.local';
const password = process.env.TOPOLOGY_TEST_ADMIN_PASSWORD || process.env.SMOKE_ADMIN_PASSWORD || 'AdminKuat123!';

async function bootstrapLocal() {
  process.env.VERCEL = '1';
  const http = require('http');
  const app = require('../app');
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', (err) => (err ? reject(err) : resolve()));
  });
  const address = server.address();
  const hostUrl = `http://127.0.0.1:${address.port}`;
  axios.defaults.baseURL = `${hostUrl}/api/v1`;
  console.log(`Bootstrapped test server on ${hostUrl}`);
  return server;
}

async function login(headers = {}) {
  const login = await axios.post('/auth/login', { email, password }, { headers });
  const token = login.data?.data?.session?.accessToken;
  if (!token) throw new Error('Token missing in login response');
  return { Authorization: `Bearer ${token}` };
}

async function importRows({ region, pop, popIdentifierOverride }) {
  const auth = await login();
  const testName = `ODP BULK ${popIdentifierOverride || 'uuid'} UAT ${Date.now()}`;
  const row = {
    'device name': testName,
    'device type': 'ODP',
    'status': 'installed',
    'region': region.id,
    'POP': popIdentifierOverride || pop.id,
    'longitude': '106.84513',
    'latitude': '-6.21462',
    'kapasitas odp': '8',
    'kapasitas splitter': '1:8',
  };
  const wsOdp = XLSX.utils.json_to_sheet([row]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, wsOdp, 'ODP');
  const tempFilePath = path.join(os.tmpdir(), `syntrix-odp-bulk-${Date.now()}.xlsx`);
  XLSX.writeFile(workbook, tempFilePath);

  const form = new FormData();
  form.append('file', fs.createReadStream(tempFilePath));
  form.append('entity_type', 'devices');
  form.append('region_id', region.id);
  form.append('apply', 'true');

  const response = await axios.post('/imports/ingest', form, {
    headers: { ...form.getHeaders(), ...auth },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
  });

  // Cleanup: search and delete created device. Backend normalizes the device
  // name via normalizeDeviceName() which uppercases ASCII chars, so we must
  // match case-insensitively against the stored/returned name.
  const search = await axios.get(
    `/devices?page=1&limit=50&q=${encodeURIComponent(testName)}`,
    { headers: auth },
  );
  const imported = (search.data?.data || []).find(
    (d) => d.device_name && d.device_name.toLowerCase() === testName.toLowerCase(),
  );
  if (imported) {
    await axios.delete(`/devices/${imported.id}`, { headers: auth });
  }
  fs.unlinkSync(tempFilePath);

  return { response, imported };
}

async function main() {
  let localServer = null;
  if (!process.env.TEST_BASE_URL) {
    localServer = await bootstrapLocal();
  } else {
    axios.defaults.baseURL = apiBase;
  }

  const auth = await login();
  console.log('Logged in with:', email);

  // Bootstrap: pick first region and POP
  const regionsResp = await axios.get('/regions?page=1&limit=1', { headers: auth });
  const region = regionsResp.data?.data?.[0];
  if (!region?.id) throw new Error('No region found in database.');
  console.log(`Using region: ${region.region_name} (${region.id})`);

  const popsResp = await axios.get(`/pops?region_id=${region.id}&limit=1`, { headers: auth });
  const pop = popsResp.data?.data?.[0];
  if (!pop?.id) throw new Error('No POP available for the chosen region.');
  console.log(`Using POP: ${pop.pop_name} (id=${pop.id}, code=${pop.pop_code}, name=${pop.pop_name})`);

  let passed = 0;
  let failed = 0;
  async function expect(label, resolver, statusCode) {
    try {
      const { response, imported } = await importRows({
        region,
        pop,
        popIdentifierOverride: resolver,
      });
      if (response.status !== statusCode) {
        throw new Error(`Expected HTTP ${statusCode}, got ${response.status}: ${JSON.stringify(response.data)}`);
      }
      if (!imported) throw new Error('Imported device not found in listing');
      console.log(`[OK]  ${label}: status=${response.status}, device=${imported.device_name}`);
      passed += 1;
    } catch (err) {
      console.error(`[FAIL] ${label}: ${err.message}`);
      failed += 1;
    }
  }

  // 1. POP resolved using UUID (id)
  await expect('POP by UUID (id)', pop.id, 201);
  // 2. POP resolved using text code (e.g. ABO)
  if (pop.pop_code) {
    await expect('POP by code (pop_code)', pop.pop_code, 201);
  }
  // 3. POP resolved using full name (pop_name)
  if (pop.pop_name) {
    await expect('POP by name (pop_name)', pop.pop_name, 201);
  }
  // 4. POP resolved using registry text id (pop_id column - POP-XXX)
  if (pop.pop_id) {
    await expect('POP by registry text id (pop_id)', pop.pop_id, 201);
  }
  // 5. POP using non-existent code should now produce a CLEAR 400 error
  // (this validates the user can now see POP name was unresolvable).
  // Expect the error body to mention the unresolved POP name so users can fix it.
  try {
    const result = await importRows({
      region,
      pop,
      popIdentifierOverride: '__nonexistent_pop_code_zzz__',
    });
    throw new Error(`Expected HTTP 400 with clear error, but got ${result.response.status}`);
  } catch (err) {
    if (err.response?.status !== 400) throw err;
    const body = err.response.data || {};
    const message = body?.data?.message || body?.message || '';
    if (!message.includes('POP') && !message.toLowerCase().includes('resolv')) {
      throw new Error(`400 received but message didn't identify unresolved POP. Got: ${message}`);
    }
    console.log(`[OK]  POP by INVALID code returns clear 400: message contains POP identifier (${message.length} chars)`);
    passed += 1;
  }

  console.log(`\n--- ODP BULK IMPORT UAT SCENARIO [${passed} passed / ${failed} failed] ---`);
  if (localServer) localServer.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('ODP Bulk Import UAT crashed:', err.message);
  process.exit(1);
});


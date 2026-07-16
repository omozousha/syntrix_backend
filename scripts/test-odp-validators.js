/**
 * Targeted test for the new ODP server-side validators added to import.service.js:
 *  - validateOdpImportRow (status enum, coordinates, capacity, splitter, FK)
 *  - validateOdpTypeReferences (odp_types master table FK check)
 *
 * Boots a local Hasura-backed Express server, logs in as admin, and submits
 * crafted XLSX/CSV rows so the validators get exercised against Hasura.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const XLSX = require('xlsx');

require('../src/config/hasura');

const baseUrl = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const apiBase = `${baseUrl}/api/v1`;
const email =
  process.env.TOPOLOGY_TEST_ADMIN_EMAIL ||
  process.env.SMOKE_ADMIN_EMAIL ||
  'admin@syntrix.local';
const password =
  process.env.TOPOLOGY_TEST_ADMIN_PASSWORD ||
  process.env.SMOKE_ADMIN_PASSWORD ||
  'AdminKuat123!';

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

async function login() {
  const response = await axios.post('/auth/login', { email, password });
  const token = response.data?.data?.session?.accessToken;
  if (!token) throw new Error('Token missing in login response');
  return { Authorization: `Bearer ${token}` };
}

async function buildExcelFile(rows) {
  const wsOdp = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, wsOdp, 'ODP');
  const tempFilePath = path.join(
    os.tmpdir(),
    `syntrix-odp-validator-${Date.now()}.xlsx`,
  );
  XLSX.writeFile(workbook, tempFilePath);
  return tempFilePath;
}

async function postImport({ headers, rows }) {
  const tempFilePath = await buildExcelFile(rows);
  try {
    const form = new FormData();
    form.append('file', fs.createReadStream(tempFilePath));
    form.append('entity_type', 'devices');
    form.append('apply', 'true');
    return await axios.post('/imports/ingest', form, {
      headers: { ...form.getHeaders(), ...headers },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      validateStatus: () => true,
    });
  } finally {
    fs.unlinkSync(tempFilePath);
  }
}

async function fetchFixture() {
  const headers = await login();
  const regionsResp = await axios.get('/regions?page=1&limit=1', { headers });
  const region = regionsResp.data?.data?.[0];
  if (!region?.id) throw new Error('No region available for test fixture');

  const popsResp = await axios.get(
    `/pops?region_id=${region.id}&limit=1`,
    { headers },
  );
  const pop = popsResp.data?.data?.[0];
  if (!pop?.id) throw new Error('No POP available for test fixture');

  const odpTypesResp = await axios.get('/odpTypes?page=1&limit=20', { headers });
  const odpTypes = (odpTypesResp.data?.data || []).filter((t) => !t.deleted_at);
  const odpTypeName = odpTypes[0]?.odp_type_name || null;

  return { region, pop, odpTypeName };
}

const passed = [];
const failed = [];
function check(label, ok, detail = '') {
  (ok ? passed : failed).push(`${label}${detail ? ` :: ${detail}` : ''}`);
  console.log(`${ok ? '[ OK ]' : '[FAIL]'} ${label}${detail ? ` :: ${detail}` : ''}`);
}

async function main() {
  let localServer = null;
  if (!process.env.TEST_BASE_URL) {
    localServer = await bootstrapLocal();
  } else {
    axios.defaults.baseURL = apiBase;
  }
  const headers = await login();
  console.log('Logged in with:', email);

  const fx = await fetchFixture();
  console.log(`Fixture: region=${fx.region.region_name}, pop=${fx.pop.pop_name}, odpType=${fx.odpTypeName || '(none)'}`);

  // ---------- 1. validateOdpImportRow: invalid status ----------
  if (fx.odpTypeName) {
    const response = await postImport({
      headers,
      rows: [
        {
          'device name': 'ODP BAD STATUS',
          'device type': 'ODP',
          'status': 'planned', // NOT in DB constraint
          'region': fx.region.id,
          'POP': fx.pop.id,
          'longitude': 106.84513,
          'latitude': -6.21462,
          'kapasitas odp': 8,
          'kapasitas splitter': '1:8',
          'odp_type': fx.odpTypeName,
        },
      ],
    });

    check(
      'invalid status returns row-scoped 400 with status-name hint',
      response.status === 400 &&
        (response.data?.data?.message || response.data?.message || '').includes(
          'status harus salah satu dari',
        ),
      `actual status=${response.status}, message=${response.data?.data?.message || response.data?.message || 'n/a'}`,
    );
  } else {
    console.log('[SKIP] No master ODP types available to exercise status test');
  }

  // ---------- 2. validateOdpImportRow: invalid coordinates ----------
  if (fx.odpTypeName) {
    const response = await postImport({
      headers,
      rows: [
        {
          'device name': 'ODP BAD COORDS',
          'device type': 'ODP',
          'status': 'installed',
          'region': fx.region.id,
          'POP': fx.pop.id,
          'longitude': 999, // invalid
          'latitude': -6.21462,
          'kapasitas odp': 8,
          'kapasitas splitter': '1:8',
          'odp_type': fx.odpTypeName,
        },
      ],
    });

    check(
      'invalid longitude returns row-scoped 400',
      response.status === 400 &&
        (response.data?.data?.message || response.data?.message || '').includes(
          'longitude harus -180..180',
        ),
      `actual status=${response.status}, message=${response.data?.data?.message || response.data?.message || 'n/a'}`,
    );
  }

  // ---------- 3. validateOdpImportRow: invalid splitter ratio ----------
  if (fx.odpTypeName) {
    const response = await postImport({
      headers,
      rows: [
        {
          'device name': 'ODP BAD SPLITTER',
          'device type': 'ODP',
          'status': 'installed',
          'region': fx.region.id,
          'POP': fx.pop.id,
          'longitude': 106.84513,
          'latitude': -6.21462,
          'kapasitas odp': 8,
          'kapasitas splitter': 'abc', // invalid
          'odp_type': fx.odpTypeName,
        },
      ],
    });

    check(
      'invalid splitter ratio returns row-scoped 400',
      response.status === 400 &&
        (response.data?.data?.message || response.data?.message || '').includes(
          'kapasitas splitter harus format 1:N',
        ),
      `actual status=${response.status}, message=${response.data?.data?.message || response.data?.message || 'n/a'}`,
    );
  }

  // ---------- 4. validateOdpTypeReferences: unknown odp_type ----------
  if (fx.odpTypeName) {
    const response = await postImport({
      headers,
      rows: [
        {
          'device name': 'ODP UNKNOWN TYPE',
          'device type': 'ODP',
          'status': 'installed',
          'region': fx.region.id,
          'POP': fx.pop.id,
          'longitude': 106.84513,
          'latitude': -6.21462,
          'kapasitas odp': 8,
          'kapasitas splitter': '1:8',
          'odp_type': 'TIDAK_DIKENAL_ZZZ',
        },
      ],
    });

    const message = response.data?.data?.message || response.data?.message || '';
    check(
      'unknown odp_type returns clear 400 referencing TIDAK_DIKENAL_ZZZ',
      response.status === 400 && message.includes('TIDAK_DIKENAL_ZZZ'),
      `actual status=${response.status}, message=${message}`,
    );
  }

  // ---------- 5. validateOdpTypeReferences: empty odp_type passes ----------
  // (Some setups leave `odp_type` blank intentionally and fill it via detail page.)
  if (fx.odpTypeName) {
    const response = await postImport({
      headers,
      rows: [
        {
          'device name': `ODP BLANK TYPE ${Date.now()}`,
          'device type': 'ODP',
          'status': 'installed',
          'region': fx.region.id,
          'POP': fx.pop.id,
          'longitude': 106.84513,
          'latitude': -6.21462,
          'kapasitas odp': 8,
          'kapasitas splitter': '1:8',
          'odp_type': '',
        },
      ],
    });
    check(
      'blank odp_type is accepted (not FK-required)',
      response.status === 201,
      `actual status=${response.status}, message=${response.data?.data?.message || response.data?.message || 'n/a'}`,
    );

    // Best-effort cleanup
    if (response.status === 201) {
      try {
        await axios.delete(
          `/devices?q=${encodeURIComponent(`ODP BLANK TYPE ${Date.now()}`)}`,
          { headers },
        );
      } catch (_) { /* ignore */ }
    }
  }

  console.log(`\n--- ODP VALIDATOR SUITE [${passed.length} passed / ${failed.length} failed] ---`);
  if (failed.length) {
    console.log('Failures:');
    failed.forEach((f) => console.log(' -', f));
  }
  if (localServer) localServer.close();
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('ODP validator test crashed:', err.message);
  process.exit(1);
});

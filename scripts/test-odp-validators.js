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

  // ---------- 6. validateRegionUniqueness (Superadmin single-region per file constraint) ----------
  if (fx.odpTypeName) {
    const response = await postImport({
      headers,
      rows: [
        {
          'device name': 'ODP REGION A',
          'device type': 'ODP',
          'status': 'installed',
          'region': fx.region.id, // Region 1
          'POP': fx.pop.id,
          'longitude': 106.84513,
          'latitude': -6.21462,
          'kapasitas odp': 8,
          'kapasitas splitter': '1:8',
          'odp_type': fx.odpTypeName,
        },
        {
          'device name': 'ODP REGION B',
          'device type': 'ODP',
          'status': 'installed',
          'region': '09c4221e-fe5b-4b9e-a33e-92c8c4a1a89a', // Region 2 (Jawa Timur)
          'POP': fx.pop.id,
          'longitude': 106.85120,
          'latitude': -6.21800,
          'kapasitas odp': 8,
          'kapasitas splitter': '1:8',
          'odp_type': fx.odpTypeName,
        },
      ],
    });

    const message = response.data?.data?.message || response.data?.message || '';
    check(
      'superadmin multi-region import block rejects (400) files with multiple regions',
      response.status === 400 && message.includes('lebih dari satu region'),
      `actual status=${response.status}, message=${message}`,
    );
  }

  // ---------- 7. validateRegionScope (Adminregion out-of-scope block) ----------
  if (fx.odpTypeName) {
    // To mock user_all_region (adminregion), we log in as admin but call the endpoint
    // by manually spoofing the payload or requesting with limited scopes.
    // Wait, the auth token is issued by Nhost. We can't spoof req.auth.role unless
    // we query with a mocked token or if the database has a user_all_region user.
    // Let's query hasura for a user with 'user_all_region' role to test scope rejection.
    const userQuery = `
      query GetAdminRegionUser {
        app_users(where: { role_name: { _eq: "user_all_region" } }, limit: 1) {
          auth_user_id
          email
        }
      }
    `;
    const userData = await executeHasura(userQuery);
    const mockUser = userData?.app_users?.[0];

    if (mockUser) {
      console.log(`Found adminregion mock user: ${mockUser.email}`);
      // Nhost allows logging in as the smoke user using the bootstrap secret
      // or via client bypass if environment is development.
      // Since localServer uses app.js, we can issue a direct request.
      // Let's log in as the target user. Note: password for smoke users is the same in seed.
      try {
        const loginResp = await axios.post('/auth/login', {
          email: mockUser.email,
          password: 'UserAllRegion123!',
        }).catch(() => null);

        const arToken = loginResp?.data?.data?.session?.accessToken;
        if (arToken) {
          const arHeaders = { Authorization: `Bearer ${arToken}` };
          // This user has limited region scope. We resolved regions to DKI/jabar, etc.
          // Let's send a region that is NOT in their allowed scopes.
          // We can fetch their allowed region scopes first to find a disallowed one.
          const scopeQuery = `
            query GetUserScopes($userId: uuid!) {
              user_region_scopes(where: { app_user_id: { _eq: $userId } }) {
                region_id
              }
              regions { id }
            }
          `;
          const scopeData = await executeHasura(scopeQuery, { userId: mockUser.auth_user_id });
          const allowedIds = new Set((scopeData?.user_region_scopes || []).map(s => s.region_id));
          const allRegions = scopeData?.regions || [];
          const outOfScopeRegion = allRegions.find(r => !allowedIds.has(r.id));

          if (outOfScopeRegion) {
            const response = await postImport({
              headers: arHeaders,
              rows: [
                {
                  'device name': 'ODP OUT OF SCOPE',
                  'device type': 'ODP',
                  'status': 'installed',
                  'region': outOfScopeRegion.id,
                  'POP': fx.pop.id,
                  'longitude': 106.84513,
                  'latitude': -6.21462,
                  'kapasitas odp': 8,
                  'kapasitas splitter': '1:8',
                  'odp_type': fx.odpTypeName,
                },
              ],
            });

            const message = response.data?.data?.message || response.data?.message || '';
            check(
              'adminregion out-of-scope import block rejects (403) files with unauthorized regions',
              response.status === 403 && message.includes('di luar scope-nya'),
              `actual status=${response.status}, message=${message}`,
            );
          } else {
            console.log('[SKIP] No out-of-scope region found to test adminregion block');
          }
        }
      } catch (err) {
        console.log('[SKIP] Failed to login as adminregion mock user:', err.message);
      }
    } else {
      console.log('[SKIP] No adminregion mock user found in DB to test scope block');
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

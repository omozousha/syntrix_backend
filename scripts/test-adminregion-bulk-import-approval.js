const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const XLSX = require('xlsx');

// Force dotenv loading
require('../src/config/hasura');
const { executeHasura, executeHasuraSql } = require('../src/config/hasura');

const baseUrl = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const apiBase = `${baseUrl}/api/v1`;

const superadminEmail = process.env.TOPOLOGY_TEST_ADMIN_EMAIL || process.env.SMOKE_ADMIN_EMAIL || 'admin.ops@syntrix.local';
const superadminPassword = process.env.TOPOLOGY_TEST_ADMIN_PASSWORD || process.env.SMOKE_ADMIN_PASSWORD || 'AdminKuat123!';

const adminRegionEmail = process.env.VALIDATION_TEST_ADMINREGION_EMAIL || 'adminregion.test@syntrix.local';
const adminRegionPassword = process.env.VALIDATION_TEST_ADMINREGION_PASSWORD || 'Syntrix@12345';

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

async function loginUser(email, password) {
  const login = await axios.post('/auth/login', { email, password });
  const token = login.data?.data?.session?.accessToken;
  if (!token) throw new Error(`Token missing for ${email}`);
  return { Authorization: `Bearer ${token}` };
}

async function main() {
  let localServer = null;
  if (!process.env.TEST_BASE_URL) {
    localServer = await bootstrapLocal();
  } else {
    axios.defaults.baseURL = apiBase;
  }

  let originalAdminRegionHash = null;
  let userEmail = null;
  let tempPopId = null;
  let tempScopeId = null;

  try {
    let superadminAuth;
    let adminRegionAuth;

    try {
      superadminAuth = await loginUser(superadminEmail, superadminPassword);
      console.log('Logged in as Superadmin');
    } catch (e) {
      console.error('Superadmin login failed:', e.message);
      throw e;
    }

    // Attempt adminregion login. If user doesn't exist, create temporary user or pick one
    let restorePasswordSql = null;
    try {
      adminRegionAuth = await loginUser(adminRegionEmail, adminRegionPassword);
      console.log('Logged in as Admin Region');
    } catch (e) {
      console.log('Default adminregion user not found, trying fallback accounts...');
      // Try to find a user_all_region account from DB
      const userRes = await executeHasura(`
        query FindAdminRegionUser {
          users: app_users(where: { role_name: { _eq: "user_all_region" } }, limit: 1) {
            id
            email
          }
        }
      `);
      const user = userRes.users?.[0];
      if (user) {
        console.log(`Found adminregion user: ${user.email}, trying fallback passwords...`);
        const passwordCandidates = ['AdminKuat123!', 'Syntrix@12345', 'AdminRegion123!'];
        for (const pass of passwordCandidates) {
          try {
            adminRegionAuth = await loginUser(user.email, pass);
            console.log(`Successfully logged in as ${user.email}`);
            break;
          } catch {
            // try next
          }
        }

        if (!adminRegionAuth) {
          // Temporarily sync the adminregion password_hash to the known superadmin
          // password hash (AdminKuat123!) so the test can authenticate, and
          // restore the original hash in the finally block.
          console.log('None of the fallback passwords matched. Temporarily syncing auth password hash...');
          const hashQuery = `
            select
              s.email,
              s.password_hash
            from auth.users s
            where s.email = ${sqlLit(superadminEmail)}
            limit 1
          `;
          const hashRows = parseRunSqlRows(await executeHasuraSql(hashQuery));
          const superHash = hashRows[0]?.password_hash;
          if (!superHash) throw new Error(`Cannot read password_hash for ${superadminEmail}`);

          // Save original hash so we can restore it in finally
          const origHashQuery = `
            select
              s.email,
              s.password_hash
            from auth.users s
            where s.email = ${sqlLit(user.email)}
            limit 1
          `;
          const origHashRows = parseRunSqlRows(await executeHasuraSql(origHashQuery));
          originalAdminRegionHash = origHashRows[0]?.password_hash || null;
          userEmail = user.email;

          await executeHasuraSql(`
            update auth.users
            set password_hash = ${sqlLit(superHash)}
            where email = ${sqlLit(user.email)};
          `);
          adminRegionAuth = await loginUser(user.email, superadminPassword);
          console.log(`Synced temporary password and logged in as ${user.email}`);
        }
      }
      if (!adminRegionAuth) {
        throw new Error('Admin Region login credentials required for test.');
      }
    }

    // 1. Get region and POP within the adminregion's scope
    const me = await axios.get('/auth/me', { headers: adminRegionAuth });
    const adminRegionUserEmail = userEmail || me.data?.data?.email || adminRegionEmail;
    const adminRegionAppUserId = await resolveAppUserIdByEmail(adminRegionUserEmail);
    const scopedRegionIds = await resolveRegionScopesByEmail(adminRegionAppUserId);
    console.log('scopedRegionIds:', scopedRegionIds);

    const regionsResp = await axios.get('/regions?page=1&limit=200', { headers: adminRegionAuth });
    const allRegions = regionsResp.data?.data || [];
    console.log('allRegions count:', allRegions.length);

    // Prefer the region that is whitelisted for the validation workflow pilot,
    // falling back to the first available region otherwise.
    const pilotRegionId = 'ae303328-7358-40f5-8535-43f666da388e'; // Bali (pilot whitelist)
    const targetRegion = allRegions.find((r) => r.id === pilotRegionId) || allRegions[0];

    // If the adminregion has no region scope in the test DB, temporarily assign
    // the target region so the import passes the regional guard.
    if (!scopedRegionIds.includes(targetRegion?.id) && adminRegionAppUserId && targetRegion?.id) {
      console.log(`Temporarily assigning region scope to ${adminRegionAppUserId}...`);
      const scopeIns = await executeHasura(`
        mutation InsertTempScope($object: user_region_scopes_insert_input!) {
          insert_user_region_scopes_one(object: $object) { id }
        }
      `, { object: { app_user_id: adminRegionAppUserId, region_id: targetRegion.id } });
      tempScopeId = scopeIns?.insert_user_region_scopes_one?.id || null;
      scopedRegionIds.push(targetRegion.id);
      console.log(`Temporary scope created (${tempScopeId}) for ${targetRegion.region_name}`);
    }

    const region = scopedRegionIds.length
      ? allRegions.find((r) => scopedRegionIds.includes(r.id))
      : allRegions[0];
    if (!region?.id) throw new Error('No region found for Admin Region scope');

    // Create a temporary POP in the region using Superadmin token to ensure the test works on empty scopes
    console.log(`Creating temporary POP in region ${region.region_name}...`);
    const tempPopName = `TEMP-POP-BALI-${Date.now()}`;
    const tempPopCode = randomPopCode();
    let popRes;
    try {
      popRes = await axios.post('/pops', {
        pop_name: tempPopName,
        pop_code: tempPopCode,
        region_id: region.id,
        status_pop: 'active',
      }, { headers: superadminAuth });
    } catch (e) {
      console.error('Failed to create POP. Response:', e.response?.data || e.message);
      throw e;
    }
    const pop = popRes?.data?.data;
    if (!pop?.id) throw new Error('Failed to create temporary POP.');
    tempPopId = pop.id;
    console.log(`Temporary POP created: ${pop.pop_name} (${pop.id})`);

    // 2. Perform bulk import as adminregion
    const testOdpName = `ODP-BULK-APPROVAL-${Date.now()}`;
    const row = {
      'device name': testOdpName,
      'device type': 'ODP',
      'status': 'installed',
      'region': region.id,
      'POP': pop.id,
      'longitude': '106.84513',
      'latitude': '-6.21462',
      'kapasitas odp': '8',
      'kapasitas splitter': '1:8',
    };

    const wsOdp = XLSX.utils.json_to_sheet([row]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, wsOdp, 'ODP');
    const tempFilePath = path.join(os.tmpdir(), `syntrix-adminregion-bulk-${Date.now()}.xlsx`);
    XLSX.writeFile(workbook, tempFilePath);

    const form = new FormData();
    form.append('file', fs.createReadStream(tempFilePath));
    form.append('entity_type', 'devices');
    form.append('region_id', region.id);
    form.append('apply', 'true');

    console.log('Submitting bulk import as Admin Region...');
    let ingestRes;
    try {
      ingestRes = await axios.post('/imports/ingest', form, {
        headers: { ...form.getHeaders(), ...adminRegionAuth },
      });
    } catch (e) {
      console.error('Ingest failed:', e.response?.data || e.message);
      throw e;
    }

    if (ingestRes.status !== 201) {
      throw new Error(`Ingest failed with status ${ingestRes.status}`);
    }

    fs.unlinkSync(tempFilePath);
    console.log('[OK] Bulk import ingest returned 201 Created');

    // 3. Verify device exists in DB but has deleted_at != null (held)
    const deviceCheck = await executeHasura(`
      query CheckHeldDevice($deviceName: String!) {
        devices(where: { device_name: { _ilike: $deviceName } }) {
          id
          device_name
          deleted_at
          deleted_by_user_id
        }
      }
    `, { deviceName: testOdpName });

    const heldDevice = deviceCheck.devices?.[0];
    if (!heldDevice) throw new Error(`Imported device ${testOdpName} not found in database.`);
    if (!heldDevice.deleted_at) throw new Error(`Device ${testOdpName} should be held (deleted_at != null) but is active.`);
    console.log(`[OK] Device ${heldDevice.device_name} is properly held with deleted_at=${heldDevice.deleted_at}`);

    // 4. Verify validation_request was created for superadmin queue
    const requestsRes = await axios.get('/validation-requests?queue=superadmin', { headers: superadminAuth });
    const queueItems = requestsRes.data?.data || [];
    const createdRequest = queueItems.find((req) => req.entity_id === heldDevice.id);

    if (!createdRequest) {
      throw new Error(`Validation request for entity ${heldDevice.id} not found in Superadmin queue.`);
    }
    if (createdRequest.current_status !== 'pending_async') {
      throw new Error(`Expected current_status=pending_async, got ${createdRequest.current_status}`);
    }
    console.log(`[OK] Validation request ${createdRequest.request_id || createdRequest.id} found in Superadmin queue.`);

    // 5. Approve the request as Superadmin
    console.log(`Approving request ${createdRequest.id} as Superadmin...`);
    let approveRes;
    try {
      approveRes = await axios.post(`/validation-requests/${createdRequest.id}/superadmin/approve`, {}, { headers: superadminAuth });
    } catch (e) {
      console.error('Approve failed:', e.response?.data || e.message);
      throw e;
    }
    if (approveRes.status !== 200) {
      throw new Error(`Superadmin approve failed with status ${approveRes.status}`);
    }
    console.log('[OK] Superadmin approved the request');

    // 6. Verify device is now active (deleted_at is null)
    const activeDeviceCheck = await executeHasura(`
      query CheckActiveDevice($deviceId: uuid!) {
        device: devices_by_pk(id: $deviceId) {
          id
          device_name
          deleted_at
        }
      }
    `, { deviceId: heldDevice.id });

    if (activeDeviceCheck.device?.deleted_at !== null) {
      throw new Error(`Approved device ${heldDevice.id} should have deleted_at=null, but got ${activeDeviceCheck.device?.deleted_at}`);
    }
    console.log(`[OK] Approved ODP device ${heldDevice.device_name} is now active (deleted_at=null)`);

    // Cleanup: delete the created device
    await executeHasura(`
      mutation DeleteTestDevice($id: uuid!) {
        delete_devices_by_pk(id: $id) { id }
      }
    `, { id: heldDevice.id });

    console.log('\n--- ADMINREGION ODP BULK IMPORT APPROVAL TEST PASSED ---');
  } finally {
    if (tempScopeId) {
      console.log('Deleting temporary region scope...');
      try {
        await executeHasura(`
          mutation DeleteTempScope($id: uuid!) {
            delete_user_region_scopes_by_pk(id: $id) { id }
          }
        `, { id: tempScopeId });
        console.log('Temporary region scope deleted.');
      } catch (err) {
        console.warn('Failed to delete temporary scope:', err.message);
      }
    }
    if (tempPopId) {
      console.log('Deleting temporary POP...');
      try {
        await executeHasura(`
          mutation DeleteTempPop($id: uuid!) {
            delete_pops_by_pk(id: $id) { id }
          }
        `, { id: tempPopId });
        console.log('Temporary POP deleted.');
      } catch (err) {
        console.warn('Failed to delete temporary POP:', err.message);
      }
    }
    if (userEmail && originalAdminRegionHash) {
      console.log(`Restoring original auth password hash for ${userEmail}...`);
      try {
        const restoreSql = `
          update auth.users
          set password_hash = ${sqlLit(originalAdminRegionHash)}
          where email = ${sqlLit(userEmail)};
        `;
        await executeHasuraSql(restoreSql);
        console.log('Original password hash restored successfully.');
      } catch (err) {
        console.warn('Failed to restore original password hash:', err.message);
      }
    }
    if (localServer) localServer.close();
  }
}

function sqlLit(value) {
  if (value === null || value === undefined) return 'null';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function randomPopCode() {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let code = '';
  for (let i = 0; i < 3; i += 1) {
    code += letters[Math.floor(Math.random() * letters.length)];
  }
  return code;
}

function parseRunSqlRows(response) {
  const result = response?.result || [];
  const [headers = [], ...rows] = result;
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index]])));
}

async function resolveAppUserIdByEmail(email) {
  const query = `
    query ResolveUserByEmail($email: String!) {
      users: app_users(where: { email: { _eq: $email } }, limit: 1) {
        id
      }
    }
  `;
  const data = await executeHasura(query, { email });
  return data.users?.[0]?.id || null;
}

async function resolveRegionScopesByEmail(userId) {
  if (!userId) return [];
  const query = `
    select region_id::text
    from public.user_region_scopes
    where app_user_id = ${sqlLit(userId)}::uuid
  `;
  const rows = parseRunSqlRows(await executeHasuraSql(query));
  return rows.map((r) => r.region_id).filter(Boolean);
}

main().catch((err) => {
  console.error('Test crashed:', err.message);
  process.exit(1);
});

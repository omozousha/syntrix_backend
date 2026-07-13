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

async function main() {
  const cleanup = { createdOdpId: null };
  let tempFilePath = null;
  let localServer = null;

  try {
    // If not running under pre-existing server, bootstrap local instance
    if (!process.env.TEST_BASE_URL) {
      process.env.VERCEL = '1';
      const http = require('http');
      const app = require('../app');
      localServer = http.createServer(app);
      await new Promise((resolve, reject) => {
        localServer.listen(0, '127.0.0.1', (err) => {
          if (err) return reject(err);
          return resolve();
        });
      });
      const address = localServer.address();
      const hostUrl = `http://127.0.0.1:${address.port}`;
      axios.defaults.baseURL = `${hostUrl}/api/v1`;
      console.log(`Bootstrapped test server on ${hostUrl}`);
    } else {
      axios.defaults.baseURL = apiBase;
    }

    console.log('Logging in with:', email);
    const login = await axios.post('/auth/login', { email, password });
    const token = login.data?.data?.session?.accessToken;
    if (!token) throw new Error('Token is missing in login response');

    const headers = { Authorization: `Bearer ${token}` };

    // Fetch dynamic options (region, POP)
    const regions = await axios.get('/regions?page=1&limit=1', { headers });
    const region = regions.data?.data?.[0];
    if (!region?.id) throw new Error('No region found in database for import test');

    const pops = await axios.get(`/pops?region_id=${region.id}&limit=1`, { headers });
    const pop = pops.data?.data?.[0];
    if (!pop?.id) throw new Error(`No POP associated with region ${region.region_name} found`);

    console.log(`Target region: ${region.region_name} (${region.id})`);
    console.log(`Target POP: ${pop.pop_name} (${pop.id})`);

    // Build template array containing the 9 ODP columns requested by user
    const testOdpName = `ODP BULK IMPORT UAT ${Date.now()}`;
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

    // Sheet 1: ODP
    const wsOdp = XLSX.utils.json_to_sheet([row]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, wsOdp, 'ODP');

    // Create temp Excel payload file
    tempFilePath = path.join(os.tmpdir(), `syntrix-odp-bulk-${Date.now()}.xlsx`);
    XLSX.writeFile(workbook, tempFilePath);

    console.log('Sending bulk import request to /imports/ingest...');
    const form = new FormData();
    form.append('file', fs.createReadStream(tempFilePath));
    form.append('entity_type', 'devices');
    form.append('region_id', region.id);
    form.append('apply', 'true');

    const importResponse = await axios.post('/imports/ingest', form, {
      headers: {
        ...form.getHeaders(),
        ...headers,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    const status = importResponse.status;
    const body = importResponse.data;
    if (status !== 200 && status !== 201) {
      throw new Error(`Import failed with status ${status}: ${JSON.stringify(body)}`);
    }

    console.log('Import API response obtained. Validating record creation...');
    const search = await axios.get(`/devices?page=1&limit=50&q=${encodeURIComponent(testOdpName)}`, { headers });
    const importedDevice = (search.data?.data || []).find((d) => d.device_name === testOdpName);

    if (!importedDevice) {
      throw new Error(`Device ${testOdpName} was not found in listing after successful import response`);
    }

    cleanup.createdOdpId = importedDevice.id;

    console.log('Import verification details:');
    console.log(`- Device ID: ${importedDevice.id}`);
    console.log(`- Device Name: ${importedDevice.device_name}`);
    console.log(`- Device Type: ${importedDevice.device_type_key}`);
    console.log(`- Total Ports (kapasitas): ${importedDevice.total_ports}`);
    console.log(`- Splitter Ratio: ${importedDevice.splitter_ratio}`);
    console.log(`- Coordinates: (${importedDevice.latitude}, ${importedDevice.longitude})`);

    // Clean up created ODP
    console.log('Cleaning up imported ODP record...');
    await axios.delete(`/devices/${importedDevice.id}`, { headers });
    console.log('Cleanup completed.');

    console.log('\n--- ODP BULK IMPORT UAT SCENARIO PASSED ---');
    if (localServer) localServer.close();
    if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    process.exit(0);
  } catch (error) {
    console.error('ODP Bulk Import UAT failed:', error.message);
    if (error.response?.data) {
      console.error('Response error details:', JSON.stringify(error.response.data));
    }
    // Attempt cleanup
    if (cleanup.createdOdpId) {
      try {
        const login = await axios.post('/auth/login', { email, password });
        const token = login.data?.data?.session?.accessToken;
        await axios.delete(`/devices/${cleanup.createdOdpId}`, { headers: { Authorization: `Bearer ${token}` } });
        console.log('Cleanup done in catch recovery block.');
      } catch (_) {}
    }
    if (localServer) localServer.close();
    if (tempFilePath && fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    process.exit(1);
  }
}

main();

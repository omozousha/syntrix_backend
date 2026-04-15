const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const FormData = require('form-data');
const XLSX = require('xlsx');
const AdmZip = require('adm-zip');

const baseUrl = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000';
const apiBase = `${baseUrl}/api/v1`;
const email = process.env.SMOKE_ADMIN_EMAIL || 'admin@syntrix.local';
const password = process.env.SMOKE_ADMIN_PASSWORD || 'AdminKuat123!';

function createTempFile(filename, content) {
  const target = path.join(os.tmpdir(), filename);
  fs.writeFileSync(target, content);
  return target;
}

function removeFileSafe(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (_error) {
    // Ignore cleanup errors in smoke test.
  }
}

async function main() {
  const cleanup = {
    popId: null,
    projectId: null,
    deviceId: null,
    attachmentId: null,
  };

  let tempExcel = null;
  let tempKmz = null;
  try {
    const health = await axios.get(`${baseUrl}/health`);
    if (!health.data?.success) {
      throw new Error('Health endpoint did not return success=true');
    }

    const login = await axios.post(`${apiBase}/auth/login`, { email, password });
    const token = login.data?.data?.session?.accessToken;
    if (!token) {
      throw new Error('Access token not found in login response');
    }

    const headers = { Authorization: `Bearer ${token}` };

    const me = await axios.get(`${apiBase}/auth/me`, { headers });
    const role = me.data?.data?.role;
    if (!['admin', 'user_region', 'user_all_region'].includes(role)) {
      throw new Error(`Unexpected role from /auth/me: ${String(role)}`);
    }

    const regionList = await axios.get(`${apiBase}/regions?limit=1`, { headers });
    const regionId = regionList.data?.data?.[0]?.id;
    if (!regionId) {
      throw new Error('No region available for smoke test');
    }

    const pop = await axios.post(`${apiBase}/pops`, {
      pop_name: `POP Smoke ${Date.now()}`,
      region_id: regionId,
      status_pop: 'active',
      pop_type: 'metro',
      address: 'Smoke test address',
      longitude: 106.81,
      latitude: -6.2,
    }, { headers });
    cleanup.popId = pop.data?.data?.id;

    const project = await axios.post(`${apiBase}/projects`, {
      project_name: `Project Smoke ${Date.now()}`,
      region_id: regionId,
      pop_id: cleanup.popId,
      status: 'running',
    }, { headers });
    cleanup.projectId = project.data?.data?.id;

    const device = await axios.post(`${apiBase}/devices`, {
      device_name: `Device Smoke ${Date.now()}`,
      asset_group: 'active',
      device_type_key: 'OLT',
      region_id: regionId,
      pop_id: cleanup.popId,
      project_id: cleanup.projectId,
      status: 'active',
      total_ports: 16,
      used_ports: 1,
      address: 'Smoke Rack',
    }, { headers });
    cleanup.deviceId = device.data?.data?.id;

    const uploadForm = new FormData();
    uploadForm.append('file', fs.createReadStream(path.resolve(__dirname, '../README.md')));
    uploadForm.append('file_category', 'document');
    uploadForm.append('entity_type', 'device');
    uploadForm.append('entity_id', cleanup.deviceId);
    const upload = await axios.post(`${apiBase}/attachments/upload`, uploadForm, {
      headers: { ...uploadForm.getHeaders(), ...headers },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
    cleanup.attachmentId = upload.data?.data?.id;

    await axios.get(`${apiBase}/attachments/${cleanup.attachmentId}/preview`, { headers });
    await axios.get(`${apiBase}/attachments/${cleanup.attachmentId}/download`, { headers, responseType: 'arraybuffer' });

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet([
      {
        device_name: `Import Smoke ${Date.now()}`,
        asset_group: 'active',
        device_type_key: 'OLT',
        region_id: regionId,
        status: 'active',
      },
    ]);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Devices');
    tempExcel = path.join(os.tmpdir(), `syntrix-smoke-${Date.now()}.xlsx`);
    XLSX.writeFile(workbook, tempExcel);

    const importExcelForm = new FormData();
    importExcelForm.append('file', fs.createReadStream(tempExcel));
    importExcelForm.append('entity_type', 'devices');
    importExcelForm.append('region_id', regionId);
    importExcelForm.append('apply', 'true');
    await axios.post(`${apiBase}/imports/ingest`, importExcelForm, {
      headers: { ...importExcelForm.getHeaders(), ...headers },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <Placemark>
      <name>Smoke KML</name>
      <Point>
        <coordinates>106.816666,-6.2,0</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>`;
    const zip = new AdmZip();
    zip.addFile('doc.kml', Buffer.from(kml, 'utf8'));
    tempKmz = createTempFile(`syntrix-smoke-${Date.now()}.kmz`, zip.toBuffer());

    const importKmzForm = new FormData();
    importKmzForm.append('file', fs.createReadStream(tempKmz));
    importKmzForm.append('entity_type', role === 'admin' || role === 'user_all_region' ? 'projects' : 'pops');
    importKmzForm.append('region_id', regionId);
    importKmzForm.append('apply', 'false');
    await axios.post(`${apiBase}/imports/ingest`, importKmzForm, {
      headers: { ...importKmzForm.getHeaders(), ...headers },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    if (cleanup.attachmentId) {
      await axios.delete(`${apiBase}/attachments/${cleanup.attachmentId}`, { headers });
      cleanup.attachmentId = null;
    }

    if (cleanup.deviceId) {
      await axios.delete(`${apiBase}/devices/${cleanup.deviceId}`, { headers });
      cleanup.deviceId = null;
    }

    if (cleanup.projectId) {
      await axios.delete(`${apiBase}/projects/${cleanup.projectId}`, { headers });
      cleanup.projectId = null;
    }

    if (cleanup.popId) {
      await axios.delete(`${apiBase}/pops/${cleanup.popId}`, { headers });
      cleanup.popId = null;
    }

    console.log(`Smoke test passed for ${apiBase}`);
  } catch (error) {
    const details = error.response?.data || error.message;
    console.error('Smoke test failed:', details);
    process.exitCode = 1;
  } finally {
    removeFileSafe(tempExcel);
    removeFileSafe(tempKmz);
  }
}

main();

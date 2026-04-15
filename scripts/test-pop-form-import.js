const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const XLSX = require('xlsx');

const baseUrl = process.env.TEST_BASE_URL || 'http://127.0.0.1:3000';
const apiBase = `${baseUrl}/api/v1`;
const email = process.env.TEST_ADMIN_EMAIL || 'admin@syntrix.local';
const password = process.env.TEST_ADMIN_PASSWORD || 'AdminKuat123!';

function randomPopCode() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return Array.from({ length: 3 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

async function main() {
  const cleanup = { popFormId: null, popImportId: null };
  let tempFilePath = null;

  try {
    const login = await axios.post(`${apiBase}/auth/login`, { email, password });
    const token = login.data?.data?.session?.accessToken;
    if (!token) {
      throw new Error('Login succeeded but token is missing');
    }

    const headers = { Authorization: `Bearer ${token}` };
    const regions = await axios.get(`${apiBase}/regions?page=1&limit=1`, { headers });
    const region = regions.data?.data?.[0];
    if (!region?.id) {
      throw new Error('No region found for test');
    }

    const popFormName = `POP Form Test ${Date.now()}`;
    const formPopCode = randomPopCode();
    const popForm = await axios.post(`${apiBase}/pops`, {
      pop_name: popFormName,
      pop_code: formPopCode,
      region_id: region.id,
      status_pop: 'active',
      pop_type: 'metro',
      address: 'Jl. Form Test',
      longitude: 106.816666,
      latitude: -6.2,
    }, { headers });
    cleanup.popFormId = popForm.data?.data?.id;

    const importPopCode = randomPopCode();
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet([
      {
        pop_name: `POP Import Test ${Date.now()}`,
        pop_code: importPopCode,
        region_id: region.id,
        status_pop: 'active',
        pop_type: 'metro',
        address: 'Jl. Import Test',
        longitude: 106.84513,
        latitude: -6.21462,
      },
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, 'POPs');
    tempFilePath = path.join(os.tmpdir(), `syntrix-pop-import-${Date.now()}.xlsx`);
    XLSX.writeFile(workbook, tempFilePath);

    const importForm = new FormData();
    importForm.append('file', fs.createReadStream(tempFilePath));
    importForm.append('entity_type', 'pops');
    importForm.append('region_id', region.id);
    importForm.append('apply', 'true');

    const importResult = await axios.post(`${apiBase}/imports/ingest`, importForm, {
      headers: {
        ...importForm.getHeaders(),
        ...headers,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    const importedPopName = importResult.data?.data?.preview_rows?.[0]?.pop_name;
    if (!importedPopName) {
      throw new Error('Import completed but preview row pop_name is missing');
    }

    const popSearch = await axios.get(`${apiBase}/pops?page=1&limit=50&q=${encodeURIComponent(importedPopName)}`, { headers });
    const importedPop = (popSearch.data?.data || []).find((item) => item.pop_name === importedPopName);
    cleanup.popImportId = importedPop?.id || null;

    console.log(JSON.stringify({
      ok: true,
      form_add_pop: {
        id: popForm.data?.data?.id,
        pop_id: popForm.data?.data?.pop_id,
        pop_name: popForm.data?.data?.pop_name,
      },
      import_pop: {
        job_id: importResult.data?.data?.import_job?.import_job_id || importResult.data?.data?.import_job?.id,
        status: importResult.data?.data?.import_job?.status,
        success_rows: importResult.data?.data?.import_job?.success_rows,
        imported_pop_name: importedPopName,
        imported_pop_id: importedPop?.pop_id || null,
      },
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      message: error.message,
      response: error.response?.data || null,
    }, null, 2));
    process.exitCode = 1;
  } finally {
    try {
      const login = await axios.post(`${apiBase}/auth/login`, { email, password });
      const token = login.data?.data?.session?.accessToken;
      if (token) {
        const headers = { Authorization: `Bearer ${token}` };
        if (cleanup.popImportId) {
          await axios.delete(`${apiBase}/pops/${cleanup.popImportId}`, { headers }).catch(() => {});
        }
        if (cleanup.popFormId) {
          await axios.delete(`${apiBase}/pops/${cleanup.popFormId}`, { headers }).catch(() => {});
        }
      }
    } catch (_error) {
      // Ignore cleanup auth failure.
    }

    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (_error) {
        // Ignore temp file cleanup failure.
      }
    }
  }
}

main();

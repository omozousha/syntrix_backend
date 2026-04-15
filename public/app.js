const state = {
  token: '',
  regions: [],
  pops: [],
};

const $ = (id) => document.getElementById(id);

function setStatus(id, message, isError = false) {
  const el = $(id);
  el.textContent = message;
  el.classList.toggle('error', Boolean(isError));
}

function initBaseUrl() {
  const stored = localStorage.getItem('syntrix_base_url');
  const fallback = window.location.origin || 'http://localhost:3000';
  $('baseUrl').value = stored || fallback;
}

function persistBaseUrl() {
  localStorage.setItem('syntrix_base_url', $('baseUrl').value.trim());
}

function apiBase() {
  return `${$('baseUrl').value.replace(/\/$/, '')}/api/v1`;
}

function authHeaders() {
  return {
    Authorization: `Bearer ${state.token}`,
  };
}

function populateRegionSelects() {
  const targets = [$('regionId'), $('importRegionId')];
  targets.forEach((select) => {
    select.innerHTML = '';
    state.regions.forEach((region) => {
      const option = document.createElement('option');
      option.value = region.id;
      option.textContent = `${region.region_name} (${region.region_id})`;
      select.appendChild(option);
    });
  });
}

function regionNameById(regionId) {
  return state.regions.find((region) => region.id === regionId)?.region_name || regionId || '-';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderPopTable() {
  const tbody = $('popTableBody');
  const keyword = $('popSearch').value.trim().toLowerCase();
  const items = state.pops.filter((item) => {
    if (!keyword) {
      return true;
    }
    const haystack = `${item.pop_name || ''} ${item.pop_code || ''} ${item.pop_id || ''}`.toLowerCase();
    return haystack.includes(keyword);
  });

  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="13">Tidak ada data</td></tr>';
    return;
  }

  const statusOptions = ['planning', 'active', 'inactive', 'maintenance'];

  tbody.innerHTML = items
    .map(
      (item, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(item.pop_id || '-')}</td>
          <td><input data-field="pop_code" data-id="${item.id}" value="${escapeHtml(item.pop_code || '')}" maxlength="3" /></td>
          <td><input data-field="pop_name" data-id="${item.id}" value="${escapeHtml(item.pop_name || '')}" /></td>
          <td>${escapeHtml(regionNameById(item.region_id))}</td>
          <td>
            <select data-field="status_pop" data-id="${item.id}">
              ${statusOptions.map((status) => `<option value="${status}" ${item.status_pop === status ? 'selected' : ''}>${status}</option>`).join('')}
            </select>
          </td>
          <td><input data-field="pop_type" data-id="${item.id}" value="${escapeHtml(item.pop_type || '')}" /></td>
          <td><input data-field="longitude" data-id="${item.id}" value="${item.longitude ?? ''}" /></td>
          <td><input data-field="latitude" data-id="${item.id}" value="${item.latitude ?? ''}" /></td>
          <td><input data-field="address" data-id="${item.id}" value="${escapeHtml(item.address || '')}" /></td>
          <td><input data-field="tenant" data-id="${item.id}" value="${escapeHtml(item.tenant || '')}" /></td>
          <td><input data-field="pln_cid_number" data-id="${item.id}" value="${escapeHtml(item.pln_cid_number || '')}" /></td>
          <td>
            <div class="action-group">
              <button type="button" class="action-btn" data-action="save-pop" data-id="${item.id}">Simpan</button>
              <button type="button" class="action-btn delete" data-action="delete-pop" data-id="${item.id}">Delete</button>
            </div>
          </td>
        </tr>
      `,
    )
    .join('');
}

function findPopById(id) {
  return state.pops.find((item) => item.id === id) || null;
}

function rowFieldValue(id, field) {
  const el = document.querySelector(`[data-id="${id}"][data-field="${field}"]`);
  return el ? el.value : '';
}

async function savePopById(id) {
  try {
    if (!state.token) throw new Error('Login dulu');
    const pop = findPopById(id);
    if (!pop) throw new Error('Data POP tidak ditemukan');

    const popName = rowFieldValue(id, 'pop_name').trim();
    const popCode = rowFieldValue(id, 'pop_code').trim().toUpperCase();
    const statusPop = rowFieldValue(id, 'status_pop').trim();
    const popType = rowFieldValue(id, 'pop_type').trim();
    const address = rowFieldValue(id, 'address').trim();
    const tenant = rowFieldValue(id, 'tenant').trim();
    const plnCidNumber = rowFieldValue(id, 'pln_cid_number').trim();
    const longitudeRaw = rowFieldValue(id, 'longitude').trim();
    const latitudeRaw = rowFieldValue(id, 'latitude').trim();

    if (!popName) throw new Error('POP Name wajib diisi');
    if (!/^[A-Z]{3}$/.test(popCode)) throw new Error('POP Code harus 3 huruf (A-Z)');

    const payload = {
      pop_name: popName,
      pop_code: popCode,
      status_pop: statusPop || 'planning',
      pop_type: popType || null,
      address: address || null,
      tenant: tenant || null,
      pln_cid_number: plnCidNumber || null,
      longitude: longitudeRaw === '' ? null : Number(longitudeRaw),
      latitude: latitudeRaw === '' ? null : Number(latitudeRaw),
    };

    if (payload.longitude != null && Number.isNaN(payload.longitude)) {
      throw new Error('Longitude harus angka');
    }
    if (payload.latitude != null && Number.isNaN(payload.latitude)) {
      throw new Error('Latitude harus angka');
    }

    const res = await fetch(`${apiBase()}/pops/${id}`, {
      method: 'PATCH',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Update POP gagal');

    setStatus('popListStatus', `POP berhasil diupdate: ${json?.data?.pop_name || pop.pop_name}`);
    await loadPops();
  } catch (err) {
    setStatus('popListStatus', `Edit POP error: ${err.message}`, true);
  }
}

async function deletePopById(id) {
  try {
    if (!state.token) throw new Error('Login dulu');
    const pop = findPopById(id);
    if (!pop) throw new Error('Data POP tidak ditemukan');

    const confirmed = window.confirm(`Hapus POP "${pop.pop_name}" (${pop.pop_code})?`);
    if (!confirmed) return;

    const res = await fetch(`${apiBase()}/pops/${id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Delete POP gagal');

    setStatus('popListStatus', `POP berhasil dihapus: ${pop.pop_name}`);
    await loadPops();
  } catch (err) {
    setStatus('popListStatus', `Delete POP error: ${err.message}`, true);
  }
}

async function handlePopTableAction(event) {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  const action = button.dataset.action;
  const id = button.dataset.id;
  if (!id) return;

  if (action === 'save-pop') {
    await savePopById(id);
    return;
  }

  if (action === 'delete-pop') {
    await deletePopById(id);
  }
}

async function login() {
  try {
    persistBaseUrl();
    const res = await fetch(`${apiBase()}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: $('email').value,
        password: $('password').value,
      }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Login gagal');
    state.token = json?.data?.session?.accessToken || '';
    if (!state.token) throw new Error('Access token tidak ditemukan');
    setStatus('loginStatus', `Login sukses.\nToken length: ${state.token.length}\nMemuat regions...`);
    await loadRegions();
  } catch (err) {
    setStatus(
      'loginStatus',
      `Login error: ${err.message}\nCek base URL API, user/password, dan pastikan backend sedang berjalan.`,
      true,
    );
  }
}

async function loadRegions() {
  try {
    if (!state.token) throw new Error('Login dulu');
    const res = await fetch(`${apiBase()}/regions?page=1&limit=50`, {
      headers: authHeaders(),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Gagal load regions');
    state.regions = json.data || [];
    if (!state.regions.length) throw new Error('Tidak ada region');
    populateRegionSelects();
    setStatus('loginStatus', `Region loaded: ${state.regions.length}`);
    await loadPops();
  } catch (err) {
    setStatus('loginStatus', `Load regions error: ${err.message}`, true);
  }
}

async function loadPops() {
  try {
    if (!state.token) throw new Error('Login dulu');
    const res = await fetch(`${apiBase()}/pops?page=1&limit=100`, {
      headers: authHeaders(),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Gagal load POP');
    state.pops = json.data || [];
    renderPopTable();
    setStatus('popListStatus', `List POP loaded: ${state.pops.length} data`);
  } catch (err) {
    setStatus('popListStatus', `Load POP error: ${err.message}`, true);
  }
}

async function exportPopsXlsx() {
  try {
    if (!state.token) throw new Error('Login dulu');

    const keyword = $('popSearch').value.trim();
    const params = new URLSearchParams();
    if (keyword) {
      params.set('q', keyword);
    }
    const query = params.toString();
    const exportUrl = `${apiBase()}/exports/pops.xlsx${query ? `?${query}` : ''}`;

    const res = await fetch(exportUrl, {
      headers: authHeaders(),
    });

    if (!res.ok) {
      const maybeJson = await res.json().catch(() => null);
      throw new Error(maybeJson?.message || 'Gagal export XLSX');
    }

    const blob = await res.blob();
    const disposition = res.headers.get('content-disposition') || '';
    const match = disposition.match(/filename="([^"]+)"/i);
    const filename = match?.[1] || `syntrix-pops-${Date.now()}.xlsx`;

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    setStatus('popListStatus', `Export berhasil: ${filename}`);
  } catch (err) {
    setStatus('popListStatus', `Export error: ${err.message}`, true);
  }
}

async function addPop() {
  try {
    if (!state.token) throw new Error('Login dulu');
    const payload = {
      pop_name: $('popName').value.trim(),
      pop_code: $('popCode').value.trim().toUpperCase(),
      region_id: $('regionId').value,
      status_pop: $('statusPop').value,
      pop_type: $('popType').value.trim() || null,
      address: $('address').value.trim() || null,
      tenant: $('tenant').value.trim() || null,
      pln_cid_number: $('plnCidNumber').value.trim() || null,
      longitude: Number($('longitude').value),
      latitude: Number($('latitude').value),
    };
    const res = await fetch(`${apiBase()}/pops`, {
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Tambah POP gagal');
    const data = json.data || {};
    setStatus('popStatus', `POP berhasil dibuat.\nID: ${data.pop_id || data.id}\nName: ${data.pop_name}`);
    await loadPops();
  } catch (err) {
    setStatus('popStatus', `Add POP error: ${err.message}`, true);
  }
}

async function importPop() {
  try {
    if (!state.token) throw new Error('Login dulu');
    const file = $('importFile').files[0];
    if (!file) throw new Error('Pilih file import dulu');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('entity_type', 'pops');
    formData.append('region_id', $('importRegionId').value);
    formData.append('apply', $('applyImport').value);

    const res = await fetch(`${apiBase()}/imports/ingest`, {
      method: 'POST',
      headers: authHeaders(),
      body: formData,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Import gagal');

    const job = json.data?.import_job || {};
    setStatus(
      'importStatus',
      `Import sukses.\nJob: ${job.import_job_id || job.id}\nStatus: ${job.status}\nParsed: ${job.total_rows}\nSuccess: ${job.success_rows}\nFailed: ${job.failed_rows}`,
    );
    await loadPops();
  } catch (err) {
    setStatus('importStatus', `Import error: ${err.message}`, true);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  $('loginForm').addEventListener('submit', (event) => {
    event.preventDefault();
    login();
  });
  $('btnLoadRegions').addEventListener('click', loadRegions);
  $('btnLoadPops').addEventListener('click', loadPops);
  $('btnExportPops').addEventListener('click', exportPopsXlsx);
  $('btnAddPop').addEventListener('click', addPop);
  $('btnImport').addEventListener('click', importPop);
  $('baseUrl').addEventListener('change', persistBaseUrl);
  $('popSearch').addEventListener('input', renderPopTable);
  $('popTableBody').addEventListener('click', handlePopTableAction);

  initBaseUrl();
});

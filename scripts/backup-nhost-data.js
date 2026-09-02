const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const HASURA_URL = process.env.HASURA_URL;
const HASURA_ADMIN_SECRET = process.env.HASURA_ADMIN_SECRET;

if (!HASURA_URL || !HASURA_ADMIN_SECRET) {
  console.error('HASURA_URL or HASURA_ADMIN_SECRET not configured in .env');
  process.exit(1);
}

const TABLES = [
  'device_inventory_counters',
  'regions',
  'inventory_region_codes',
  'manufacturers',
  'brands',
  'asset_types',
  'asset_models',
  'tenants',
  'pops',
  'projects',
  'poles',
  'customers',
  'service_types',
  'devices',
  'network_routes',
  'device_links',
  'device_ports',
  'port_connections',
  'core_management',
  'attachments',
  'import_jobs',
  'import_rows',
  'custom_field_definitions',
  'app_users',
  'user_region_scopes',
  'validation_records',
  'validation_requests',
  'monitoring_snapshots',
  'audit_logs',
  'device_type_catalog',
  'cable_types',
  'cable_categories',
  'closure_types',
  'device_core_capacities',
  'splitter_profiles',
  'route_types',
  'as_built_documents',
  'qr_label_settings',
  'fcm_push_tokens',
  'user_notifications',
];

function buildQueryUrl() {
  const url = new URL(HASURA_URL);
  url.pathname = '/v2/query';
  url.search = '';
  return url.toString();
}

async function runSql(sql) {
  const queryUrl = buildQueryUrl();
  const res = await axios.post(
    queryUrl,
    {
      type: 'run_sql',
      args: {
        source: 'default',
        sql,
      },
    },
    {
      headers: {
        'Content-Type': 'application/json',
        'x-hasura-admin-secret': HASURA_ADMIN_SECRET,
      },
      timeout: 30000,
    }
  );
  return res.data;
}

function parseSqlResult(result) {
  if (!result || !result.result || !Array.isArray(result.result) || result.result.length === 0) {
    return [];
  }
  const [headers, ...rows] = result.result;
  return rows.map((row) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = row[index];
    });
    return item;
  });
}

async function main() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.resolve(__dirname, `../database/backups/backup-${timestamp}`);

  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  console.log(`Starting backup from Hasura (${HASURA_URL})...`);
  console.log(`Target directory: ${backupDir}\n`);

  const summary = {
    startedAt: new Date().toISOString(),
    completedAt: null,
    tables: {},
  };

  for (const table of TABLES) {
    process.stdout.write(`- Fetching table: public.${table} ... `);
    try {
      const query = `SELECT json_agg(t) FROM (SELECT * FROM public."${table}") t;`;
      const res = await runSql(query);
      
      let rows = [];
      if (res && res.result && res.result[1] && res.result[1][0]) {
        try {
          rows = JSON.parse(res.result[1][0]) || [];
        } catch (e) {
          const fallbackRes = await runSql(`SELECT * FROM public."${table}" LIMIT 50000;`);
          rows = parseSqlResult(fallbackRes);
        }
      }

      const filePath = path.join(backupDir, `${table}.json`);
      fs.writeFileSync(filePath, JSON.stringify(rows, null, 2), 'utf-8');

      summary.tables[table] = {
        status: 'success',
        count: rows.length,
        file: `${table}.json`,
      };
      console.log(`SUCCESS (${rows.length} rows)`);
    } catch (err) {
      const errMsg = err.response?.data?.error || err.message;
      summary.tables[table] = {
        status: 'failed',
        error: errMsg,
      };
      console.log(`FAILED: ${errMsg}`);
    }
  }

  summary.completedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(backupDir, 'backup-summary.json'),
    JSON.stringify(summary, null, 2),
    'utf-8'
  );

  console.log('\nBackup complete. Summary saved to backup-summary.json');
}

main().catch((err) => {
  console.error('\nFatal error during backup:', err.message);
  process.exit(1);
});

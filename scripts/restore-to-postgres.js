const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || '',
  database: process.env.PGDATABASE || 'syntrix',
  max: 10,
  idleTimeoutMillis: 30000,
});

const TABLES_ORDERED = [
  'regions',
  'inventory_region_codes',
  'manufacturers',
  'brands',
  'asset_types',
  'asset_models',
  'tenants',
  'service_types',
  'projects',
  'pops',
  'poles',
  'customers',
  'device_inventory_counters',
  'device_type_catalog',
  'cable_types',
  'cable_categories',
  'closure_types',
  'device_core_capacities',
  'splitter_profiles',
  'route_types',
  'qr_label_settings',
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
  'validation_requests',
  'validation_records',
  'monitoring_snapshots',
  'audit_logs',
  'fcm_push_tokens',
  'user_notifications',
  'as_built_documents',
];

function getColumns(tableName, row) {
  if (!row || typeof row !== 'object') return { columns: [], values: [] };
  const columns = Object.keys(row);
  const values = columns.map((col) => {
    const val = row[col];
    if (val === null || val === undefined) return null;
    if (typeof val === 'object') return JSON.stringify(val);
    if (typeof val === 'boolean') return val;
    if (typeof val === 'number') return val;
    return String(val);
  });
  return { columns, values };
}

function buildUpsert(cols, vals, conflictTarget = 'id') {
  const placeholders = vals.map((_, i) => `$${i + 1}`);
  const setClause = cols
    .map((c) => `${c} = EXCLUDED.${c}`)
    .filter((c) => !c.startsWith(conflictTarget))
    .join(', ');
  return {
    text: `INSERT INTO public."${conflictTarget}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders.join(', ')}) ON CONFLICT (${conflictTarget}) DO UPDATE SET ${setClause}`,
    values: vals,
  };
}

async function truncateTable(client, tableName) {
  await client.query(`TRUNCATE TABLE public."${tableName}" CASCADE;`);
}

async function importTable(client, tableName, filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`  [SKIP] No backup file: ${tableName}.json`);
    return { skipped: true, count: 0 };
  }

  const raw = fs.readFileSync(filePath, 'utf-8');
  const rows = JSON.parse(raw);

  if (!rows || rows.length === 0) {
    console.log(`  [OK] Empty table: ${tableName}`);
    return { success: true, count: 0 };
  }

  let imported = 0;
  let batchSize = 100;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const allCols = new Set();
    batch.forEach((row) => Object.keys(row).forEach((k) => allCols.add(k)));
    const cols = Array.from(allCols);

    const values = [];
    const placeholders = [];
    let placeholderIndex = 0;

    for (const row of batch) {
      const rowPlaceholders = [];
      for (const col of cols) {
        const val = row[col];
        if (val === null || val === undefined) {
          rowPlaceholders.push(`NULL`);
        } else if (typeof val === 'object') {
          placeholderIndex++;
          rowPlaceholders.push(`$${placeholderIndex}`);
          values.push(JSON.stringify(val));
        } else if (typeof val === 'boolean') {
          placeholderIndex++;
          rowPlaceholders.push(`$${placeholderIndex}`);
          values.push(val);
        } else if (typeof val === 'number') {
          placeholderIndex++;
          rowPlaceholders.push(`$${placeholderIndex}`);
          values.push(val);
        } else {
          placeholderIndex++;
          rowPlaceholders.push(`$${placeholderIndex}`);
          values.push(String(val));
        }
      }
      placeholders.push(`(${rowPlaceholders.join(', ')})`);
    }

    const conflictTarget = 'id';
    const setClause = cols
      .filter((c) => c !== conflictTarget)
      .map((c) => `"${c}" = EXCLUDED."${c}"`)
      .join(', ');

    const query = {
      text: `INSERT INTO public."${tableName}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES ${placeholders.join(', ')} ON CONFLICT ("${conflictTarget}") DO UPDATE SET ${setClause}`,
      values,
    };

    try {
      await client.query(query);
      imported += batch.length;
    } catch (err) {
      const tableHasId = cols.includes('id');
      const fallback = `INSERT INTO public."${tableName}" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES ${placeholders.join(', ')} ON CONFLICT DO NOTHING`;
      try {
        const fallbackQuery = { text: fallback, values };
        await client.query(fallbackQuery);
        imported += batch.length;
      } catch (fallbackErr) {
        throw new Error(`Batch import failed: ${fallbackErr.message}`);
      }
    }
  }

  return { success: true, count: imported };
}

async function main() {
  const backupDir = process.argv[2];
  if (!backupDir) {
    console.error('Usage: node restore-to-postgres.js <path-to-backup-folder>');
    console.error('Example: node restore-to-postgres.js ../database/backups/backup-2026-08-19');
    process.exit(1);
  }

  const resolvedPath = path.isAbsolute(backupDir) ? backupDir : path.resolve(__dirname, '..', backupDir);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`Backup directory not found: ${resolvedPath}`);
    process.exit(1);
  }

  console.log(`Connecting to local PostgreSQL...`);
  let client;
  try {
    client = await pool.connect();
    console.log(`Connected to ${process.env.PGDATABASE || 'syntrix'} on ${process.env.PGHOST || 'localhost'}\n`);
  } catch (err) {
    console.error('Cannot connect to PostgreSQL:', err.message);
    console.error('Make sure:');
    console.error('  1. PostgreSQL is running');
    console.error('  2. Database "syntrix" exists (run: CREATE DATABASE syntrix;)');
    console.error('  3. Schema initialized (run combined-schema.sql or apply migrations)');
    console.error('  4. .env.local has correct PG* variables');
    process.exit(1);
  }

  const summary = {
    backupDir: resolvedPath,
    startedAt: new Date().toISOString(),
    completedAt: null,
    tables: {},
  };

  for (const table of TABLES_ORDERED) {
    process.stdout.write(`Importing ${table}... `);
    const filePath = path.join(resolvedPath, `${table}.json`);
    try {
      const result = await importTable(client, table, filePath);
      if (result.skipped) {
        console.log(`skipped (no file)`);
        summary.tables[table] = { status: 'skipped' };
      } else {
        console.log(`OK (${result.count} rows)`);
        summary.tables[table] = { status: 'success', count: result.count };
      }
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      summary.tables[table] = { status: 'failed', error: err.message };
    }
  }

  summary.completedAt = new Date().toISOString();
  const summaryPath = path.join(resolvedPath, 'restore-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`\nRestore summary saved to ${summaryPath}`);
  console.log('Done.');

  client.release();
  await pool.end();
}

main().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
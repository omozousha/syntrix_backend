const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

require('dotenv').config({ path: path.resolve(__dirname, '../.env.local') });

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || '',
  database: process.env.PGDATABASE || 'syntrix',
});

const AUTH_SCHEMA_STUB = `
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  email text UNIQUE,
  password_hash text,
  email_verified boolean DEFAULT false,
  is_anonymous boolean DEFAULT false,
  disabled boolean DEFAULT false,
  metadata jsonb DEFAULT '{}'::jsonb
);
`;

async function main() {
  console.log('Connecting to PostgreSQL to initialize schema...');
  const client = await pool.connect();
  console.log(`Connected to database: ${process.env.PGDATABASE || 'syntrix'}\n`);

  console.log('1. Creating auth schema and stub table...');
  await client.query(AUTH_SCHEMA_STUB);
  console.log('   OK');

  console.log('2. Running base schema (schema.sql)...');
  const schemaPath = path.resolve(__dirname, '../database/schema.sql');
  const baseSchema = fs.readFileSync(schemaPath, 'utf-8');
  await client.query(baseSchema);
  console.log('   OK');

  console.log('3. Running migration scripts...');
  const migrationsDir = path.resolve(__dirname, '../database/migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    process.stdout.write(`   Applying ${file}... `);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    try {
      await client.query(sql);
      console.log('OK');
    } catch (err) {
      console.log(`WARN: ${err.message}`);
    }
  }

  console.log('\nDatabase schema initialized successfully!');
  client.release();
  await pool.end();
}

main().catch(err => {
  console.error('\nInitialization failed:', err.message);
  process.exit(1);
});

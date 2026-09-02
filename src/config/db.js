const { Pool } = require('pg');
const { env } = require('./env');

const connectionString = env.databaseUrl || process.env.DATABASE_URL;

if (!connectionString) {
  console.warn('DATABASE_URL not set in env, PostgreSQL pool will not be able to connect.');
}

const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false,
  },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle PostgreSQL client:', err.message);
});

async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV === 'development' && duration > 200) {
    console.warn(`[DB Slow Query] ${duration}ms: ${text.slice(0, 100)}`);
  }
  return res;
}

async function getClient() {
  const client = await pool.connect();
  return client;
}

module.exports = { pool, query, getClient };

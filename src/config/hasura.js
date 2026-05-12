const axios = require('axios');
const { env } = require('./env');

const hasuraClient = axios.create({
  baseURL: env.hasuraUrl,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    'x-hasura-admin-secret': env.hasuraAdminSecret,
  },
});

function buildHasuraSiblingEndpoint(pathname) {
  const url = new URL(env.hasuraUrl);
  url.pathname = pathname;
  url.search = '';
  return url.toString();
}

const hasuraMetadataClient = axios.create({
  baseURL: buildHasuraSiblingEndpoint('/v1/metadata'),
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    'x-hasura-admin-secret': env.hasuraAdminSecret,
  },
});

const hasuraQueryClient = axios.create({
  baseURL: buildHasuraSiblingEndpoint('/v2/query'),
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
    'x-hasura-admin-secret': env.hasuraAdminSecret,
  },
});

async function executeHasura(query, variables = {}) {
  const { data } = await hasuraClient.post('', { query, variables });

  if (data.errors?.length) {
    const primaryError = data.errors[0];
    const message = primaryError.message || 'Hasura query failed';
    const error = new Error(message);
    error.statusCode = 400;
    error.details = data.errors;
    throw error;
  }

  return data.data;
}

async function executeHasuraMetadata(type, args = {}) {
  const { data } = await hasuraMetadataClient.post('', { type, args });
  return data;
}

async function executeHasuraSql(sql) {
  const { data } = await hasuraQueryClient.post('', {
    type: 'run_sql',
    args: {
      source: 'default',
      sql,
    },
  });
  return data;
}

const trackedTables = new Set();

async function ensureHasuraTableTracked(tableName, schema = 'public') {
  const cacheKey = `${schema}.${tableName}`;
  if (trackedTables.has(cacheKey)) return;

  try {
    await executeHasuraMetadata('pg_track_table', {
      source: 'default',
      table: {
        schema,
        name: tableName,
      },
    });
  } catch (error) {
    const message = String(error.response?.data?.error || error.response?.data?.message || error.message || '').toLowerCase();
    const tableMissing = message.includes('no such table') || message.includes('no such table/view');
    const alreadyTracked = message.includes('already') || message.includes('already tracked') || message.includes('is already tracked');
    if (tableMissing || !alreadyTracked) {
      throw error;
    }
  }

  trackedTables.add(cacheKey);
}

module.exports = { hasuraClient, executeHasura, executeHasuraMetadata, executeHasuraSql, ensureHasuraTableTracked };

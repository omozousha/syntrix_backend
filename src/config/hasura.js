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

module.exports = { hasuraClient, executeHasura };

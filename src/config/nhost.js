const axios = require('axios');
const { env } = require('./env');

const nhostAuthClient = axios.create({
  baseURL: env.nhostAuthUrl,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

const nhostStorageClient = axios.create({
  baseURL: env.nhostStorageUrl,
  timeout: 60000,
});

module.exports = { nhostAuthClient, nhostStorageClient };

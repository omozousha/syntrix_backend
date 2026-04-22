const dotenv = require('dotenv');

dotenv.config();

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toCsvList(value, fallback = '') {
  const source = value == null || value === '' ? fallback : value;
  return String(source)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function toBoolean(value, fallback) {
  if (value == null || value === '') {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) {
    return true;
  }
  if (['false', '0', 'no', 'n', 'off'].includes(normalized)) {
    return false;
  }
  return fallback;
}

function getRequired(name, fallback) {
  const value = process.env[name] || fallback;

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

const env = {
  port: toNumber(process.env.PORT, 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  serveTestUi: toBoolean(process.env.SERVE_TEST_UI, (process.env.NODE_ENV || 'development') !== 'production'),
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
  apiBodyLimit: process.env.API_BODY_LIMIT || '10mb',
  hasuraUrl: getRequired('HASURA_URL'),
  hasuraAdminSecret: getRequired('HASURA_ADMIN_SECRET'),
  nhostAuthUrl: getRequired('NHOST_AUTH_URL', process.env.NHOST_AUTH_URL),
  nhostStorageUrl: getRequired('NHOST_STORAGE_URL'),
  nhostEmailRedirectTo: process.env.NHOST_EMAIL_REDIRECT_TO || '',
  defaultStorageBucket: process.env.DEFAULT_STORAGE_BUCKET || 'default',
  maxUploadSizeMb: toNumber(process.env.MAX_UPLOAD_SIZE_MB, 25),
  imageUploadMaxSizeMb: toNumber(process.env.IMAGE_UPLOAD_MAX_SIZE_MB, 5),
  authRateLimitWindowMs: toNumber(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  authRateLimitMax: toNumber(process.env.AUTH_RATE_LIMIT_MAX, 25),
  apiRateLimitWindowMs: toNumber(process.env.API_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  apiRateLimitMax: toNumber(process.env.API_RATE_LIMIT_MAX, 500),
  importMaxRows: toNumber(process.env.IMPORT_MAX_ROWS, 2000),
  importAllowedEntitiesAdmin: toCsvList(process.env.IMPORT_ALLOWED_ENTITIES_ADMIN, 'devices,pops,projects,regions'),
  importAllowedEntitiesUserAllRegion: toCsvList(process.env.IMPORT_ALLOWED_ENTITIES_USER_ALL_REGION, 'devices,pops,projects'),
  importAllowedEntitiesUserRegion: toCsvList(process.env.IMPORT_ALLOWED_ENTITIES_USER_REGION, 'devices,pops'),
  bootstrapAdminSecret: process.env.BOOTSTRAP_ADMIN_SECRET || '',
};

module.exports = { env };

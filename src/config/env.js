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

function toCorsOrigins(value) {
  return Array.from(new Set([
    ...toCsvList(value, 'http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,https://syntrix.vercel.app,https://syntrix-one.vercel.app'),
    'http://localhost', 'https://localhost', 'capacitor://localhost',
    'http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000',
    'https://syntrix.vercel.app',
  ]));
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
  corsOrigins: toCorsOrigins(process.env.CORS_ORIGINS),
  apiBodyLimit: process.env.API_BODY_LIMIT || '10mb',
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
  validationWorkflowEnabled: toBoolean(process.env.VALIDATION_WORKFLOW_ENABLED, true),
  validationWorkflowAllowedRegionIds: toCsvList(process.env.VALIDATION_WORKFLOW_ALLOWED_REGION_IDS, ''),
  validationNotificationUrgentAfterHours: toNumber(process.env.VALIDATION_NOTIFICATION_URGENT_AFTER_HOURS, 8),
  fcmEnabled: toBoolean(process.env.FCM_ENABLED, false),
  firebaseProjectId: process.env.FIREBASE_PROJECT_ID || '',
  firebaseClientEmail: process.env.FIREBASE_CLIENT_EMAIL || '',
  firebasePrivateKey: process.env.FIREBASE_PRIVATE_KEY || '',
  firebaseServiceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || '',
  firebaseServiceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '',
  firebaseWebApiKey: process.env.FIREBASE_WEB_API_KEY || '',
  r2AccountId: process.env.R2_ACCOUNT_ID || '',
  r2AccessKeyId: process.env.R2_ACCESS_KEY_ID || '',
  r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
  r2BucketName: process.env.R2_BUCKET_NAME || 'syntrix-storage',
  r2PublicUrl: process.env.R2_PUBLIC_URL || '',
  databaseUrl: process.env.DATABASE_URL || '',
};

module.exports = { env };

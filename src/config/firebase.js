const { env } = require('./env');

let firebaseAdmin = null;

function normalizePrivateKey(value) {
  return String(value || '').replace(/\\n/g, '\n');
}

function getFirebaseAdmin() {
  if (!env.fcmEnabled) return null;
  if (firebaseAdmin) return firebaseAdmin;

  if (!env.firebaseProjectId || !env.firebaseClientEmail || !env.firebasePrivateKey) {
    console.warn('FCM is enabled but Firebase service account environment is incomplete.');
    return null;
  }

  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: env.firebaseProjectId,
        clientEmail: env.firebaseClientEmail,
        privateKey: normalizePrivateKey(env.firebasePrivateKey),
      }),
    });
  }

  firebaseAdmin = admin;
  return firebaseAdmin;
}

function getFirebaseHealth() {
  const privateKey = normalizePrivateKey(env.firebasePrivateKey);
  const clientEmail = String(env.firebaseClientEmail || '');
  const health = {
    fcmEnabled: Boolean(env.fcmEnabled),
    projectIdSet: Boolean(env.firebaseProjectId),
    clientEmailSet: Boolean(clientEmail),
    privateKeySet: Boolean(env.firebasePrivateKey),
    privateKeyStartsOk: privateKey.startsWith('-----BEGIN PRIVATE KEY-----'),
    privateKeyEndsOk: privateKey.trim().endsWith('-----END PRIVATE KEY-----'),
    privateKeyLineCount: privateKey ? privateKey.split('\n').length : 0,
    privateKeyHasLiteralNewlines: String(env.firebasePrivateKey || '').includes('\\n'),
    privateKeyHasActualNewlines: String(env.firebasePrivateKey || '').includes('\n'),
    clientEmailLooksPlaceholder: clientEmail.includes('xxxx'),
    privateKeyLooksPlaceholder: privateKey.includes('...'),
    firebaseAdminReady: false,
    firebaseInitError: null,
  };

  try {
    health.firebaseAdminReady = Boolean(getFirebaseAdmin());
  } catch (error) {
    health.firebaseInitError = error.message || 'Firebase admin initialization failed';
  }

  return health;
}

module.exports = { getFirebaseAdmin, getFirebaseHealth };

const fs = require('fs');
const path = require('path');
const { env } = require('./env');

let firebaseAdmin = null;
let firebaseInitError = null;

function normalizePrivateKey(value) {
  return String(value || '').replace(/\\n/g, '\n');
}

function buildCredential() {
  // 1. Prefer loading service account from JSON env var string (Vercel compatible)
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '';
  if (serviceAccountJson && serviceAccountJson.trim() !== '') {
    try {
      const parsed = JSON.parse(serviceAccountJson);
      if (parsed && parsed.project_id && parsed.client_email && parsed.private_key) {
        return {
          projectId: parsed.project_id,
          clientEmail: parsed.client_email,
          privateKey: parsed.private_key,
        };
      }
      console.warn('FIREBASE_SERVICE_ACCOUNT_JSON present but missing required fields.');
    } catch (error) {
      console.warn('Failed to parse FIREBASE_SERVICE_ACCOUNT_JSON:', error.message);
    }
  }

  // 2. Prefer loading service account JSON file if configured (local dev only)
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (serviceAccountPath && serviceAccountPath !== 'CUSTOM' && fs.existsSync(serviceAccountPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf-8'));
      if (parsed && parsed.project_id && parsed.client_email && parsed.private_key) {
        return {
          projectId: parsed.project_id,
          clientEmail: parsed.client_email,
          privateKey: parsed.private_key,
        };
      }
    } catch (error) {
      console.warn('Failed to parse Firebase service account file:', error.message);
    }
  }

  // 3. Fallback to environment variables
  if (env.firebaseProjectId && env.firebaseClientEmail && env.firebasePrivateKey) {
    return {
      projectId: env.firebaseProjectId,
      clientEmail: env.firebaseClientEmail,
      privateKey: normalizePrivateKey(env.firebasePrivateKey),
    };
  }

  return null;
}

function getFirebaseAdmin() {
  if (firebaseAdmin) return firebaseAdmin;

  const credential = buildCredential();
  if (!credential) {
    console.warn('Firebase service account is not configured (missing credentials).');
    return null;
  }

  const admin = require('firebase-admin');
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(credential),
    });
  }

  firebaseAdmin = admin;
  return firebaseAdmin;
}

function getFirebaseHealth() {
  const credential = buildCredential();
  const privateKey = credential?.privateKey || '';
  const clientEmail = String(credential?.clientEmail || '');
  const health = {
    credentialSource: process.env.FIREBASE_SERVICE_ACCOUNT_PATH ? 'file' : 'env',
    projectIdSet: Boolean(credential?.projectId),
    clientEmailSet: Boolean(clientEmail),
    privateKeySet: Boolean(privateKey),
    privateKeyStartsOk: privateKey.startsWith('-----BEGIN PRIVATE KEY-----'),
    privateKeyEndsOk: privateKey.trim().endsWith('-----END PRIVATE KEY-----'),
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

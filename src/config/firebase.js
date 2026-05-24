const { env } = require('./env');

let firebaseAdmin = null;

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
        privateKey: env.firebasePrivateKey.replace(/\\n/g, '\n'),
      }),
    });
  }

  firebaseAdmin = admin;
  return firebaseAdmin;
}

module.exports = { getFirebaseAdmin };

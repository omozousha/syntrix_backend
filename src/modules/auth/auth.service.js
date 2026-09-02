const jwt = require('jsonwebtoken');
const { getFirebaseAdmin } = require('../../config/firebase');
const { query: dbQuery } = require('../../config/db');

const JWT_SECRET = process.env.JWT_SECRET || 'syntrix-dev-jwt-secret-2026';
const JWT_EXPIRES_IN = '7d';
const REFRESH_EXPIRES_IN = '30d';

function signAccessToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

function signRefreshToken(payload) {
  return jwt.sign({ ...payload, type: 'refresh' }, JWT_SECRET, { expiresIn: REFRESH_EXPIRES_IN });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

async function loginWithPassword(email, password) {
  const admin = getFirebaseAdmin();
  if (!admin) {
    throw new Error('Firebase Admin SDK not configured');
  }

  // Firebase Admin SDK can't verify passwords directly
  // We sign in via Firebase Auth REST API using signInWithPassword
  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  const projectId = process.env.FIREBASE_PROJECT_ID;

  if (!apiKey) {
    throw new Error('FIREBASE_WEB_API_KEY not configured in .env');
  }

  const signInUrl = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
  const response = await fetch(signInUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });

  const data = await response.json();

  if (data.error) {
    throw new Error(data.error.message || 'Login failed');
  }

  // data contains: localId, idToken, refreshToken, expiresIn
  const uid = data.localId;
  const idToken = data.idToken;
  const refreshTokenFirebase = data.refreshToken;
  const expiresIn = Number(data.expiresIn) || 3600;

  return {
    uid,
    idToken,
    refreshTokenFirebase,
    expiresIn,
  };
}

async function signUpUser({ email, password, displayName }) {
  const admin = getFirebaseAdmin();
  if (!admin) throw new Error('Firebase Admin SDK not configured');

  const userRecord = await admin.auth().createUser({
    email,
    password,
    displayName,
    emailVerified: false,
    disabled: false,
  });

  return userRecord;
}

async function logout(refreshToken) {
  return { success: true };
}

async function refreshSession(refreshToken) {
  try {
    const decoded = verifyToken(refreshToken);
    if (decoded.type !== 'refresh') {
      throw new Error('Invalid refresh token');
    }

    const newAccessToken = signAccessToken({
      uid: decoded.uid,
      email: decoded.email,
    });
    const newRefreshToken = signRefreshToken({
      uid: decoded.uid,
      email: decoded.email,
    });

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      accessTokenExpiresIn: 7 * 24 * 60 * 60, // 7 days
    };
  } catch (err) {
    throw new Error('Invalid or expired refresh token');
  }
}

async function changePassword(token, newPassword) {
  const admin = getFirebaseAdmin();
  if (!admin) throw new Error('Firebase Admin SDK not configured');

  const decoded = verifyToken(token);
  await admin.auth().updateUser(decoded.uid, { password: newPassword });
  return { success: true };
}

async function requestPasswordReset(email) {
  const admin = getFirebaseAdmin();
  if (!admin) throw new Error('Firebase Admin SDK not configured');

  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  if (!apiKey) {
    throw new Error('FIREBASE_WEB_API_KEY not configured');
  }

  const resetUrl = `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${apiKey}`;
  const response = await fetch(resetUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestType: 'PASSWORD_RESET', email }),
  });

  const data = await response.json();
  if (data.error) {
    throw new Error(data.error.message || 'Password reset failed');
  }

  return { success: true };
}

async function findAppUserByEmail(email) {
  const result = await dbQuery(
    'SELECT * FROM public.app_users WHERE email = $1 LIMIT 1',
    [email]
  );
  return result.rows[0] || null;
}

async function findAppUserByAuthUserId(authUserId) {
  const result = await dbQuery(
    'SELECT * FROM public.app_users WHERE auth_user_id = $1 LIMIT 1',
    [authUserId]
  );
  return result.rows[0] || null;
}

async function createAppUser(object) {
  const keys = Object.keys(object);
  const vals = Object.values(object);
  const placeholders = keys.map((_, i) => `$${i + 1}`);

  const result = await dbQuery(
    `INSERT INTO public.app_users (${keys.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
    vals
  );
  return result.rows[0];
}

async function countAppUsers() {
  const result = await dbQuery('SELECT COUNT(*)::int as count FROM public.app_users');
  return result.rows[0].count;
}

async function activateAppUserByAuthUserId(authUserId) {
  const result = await dbQuery(
    'UPDATE public.app_users SET is_active = true WHERE auth_user_id = $1',
    [authUserId]
  );
  return result.rowCount || 0;
}

async function insertUserRegionScopes(appUserId, regionIds = []) {
  if (!regionIds.length) return [];

  const objects = regionIds.map((regionId) => ({ app_user_id: appUserId, region_id: regionId }));
  const results = [];

  for (const obj of objects) {
    const result = await dbQuery(
      'INSERT INTO public.user_region_scopes (app_user_id, region_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *',
      [obj.app_user_id, obj.region_id]
    );
    if (result.rows[0]) results.push(result.rows[0]);
  }

  return results;
}

async function loadAttachmentById(id) {
  const result = await dbQuery('SELECT * FROM public.attachments WHERE id = $1 LIMIT 1', [id]);
  return result.rows[0] || null;
}

async function updateOwnProfileByAuthUserId(authUserId, changes) {
  const keys = Object.keys(changes);
  const vals = Object.values(changes);
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');

  const result = await dbQuery(
    `UPDATE public.app_users SET ${setClause}, updated_at = NOW() WHERE auth_user_id = $${keys.length + 1} RETURNING *`,
    [...vals, authUserId]
  );
  return result.rows[0] || null;
}

async function cleanupUnusedAvatarAttachment(attachmentId) {
  if (!attachmentId) return false;
  const attachment = await loadAttachmentById(attachmentId);
  if (!attachment) return false;
  if (attachment.file_category !== 'image') return false;

  const result = await dbQuery(
    'DELETE FROM public.attachments WHERE id = $1 RETURNING id',
    [attachmentId]
  );
  return result.rowCount > 0;
}

async function listOrphanAvatarAttachments(limit = 100) {
  const result = await dbQuery(
    `SELECT * FROM public.attachments
     WHERE entity_type = 'user_profile' AND file_category = 'image'
       AND id NOT IN (SELECT avatar_attachment_id FROM public.app_users WHERE avatar_attachment_id IS NOT NULL)
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

async function cleanupOrphanAvatarAttachments(limit = 100) {
  const orphans = await listOrphanAvatarAttachments(limit);
  const results = [];
  for (const item of orphans) {
    await dbQuery('DELETE FROM public.attachments WHERE id = $1', [item.id]);
    results.push({ id: item.id, attachment_id: item.attachment_id, original_name: item.original_name, cleaned: true });
  }
  return { total_orphans: orphans.length, cleaned_count: results.length, cleaned_items: results };
}

module.exports = {
  loginWithPassword,
  signUpUser,
  logout,
  refreshSession,
  changePassword,
  requestPasswordReset,
  createAppUser,
  countAppUsers,
  findAppUserByEmail,
  findAppUserByAuthUserId,
  activateAppUserByAuthUserId,
  insertUserRegionScopes,
  loadAttachmentById,
  updateOwnProfileByAuthUserId,
  cleanupUnusedAvatarAttachment,
  listOrphanAvatarAttachments,
  cleanupOrphanAvatarAttachments,
  signAccessToken,
  signRefreshToken,
  verifyToken,
};

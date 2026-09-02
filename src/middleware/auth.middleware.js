const { query: dbQuery } = require('../config/db');
const { getFirebaseAdmin } = require('../config/firebase');
const { createHttpError } = require('../utils/httpError');
const { normalizeRoleName } = require('../utils/roles');

function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length < 2) {
    throw createHttpError(401, 'Invalid access token');
  }
  const payload = parts[1];
  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const json = Buffer.from(padded, 'base64').toString('utf8');
  return JSON.parse(json);
}

async function loadAppUserDirect(userId) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId);
  const userRes = isUuid
    ? await dbQuery(
        `SELECT id, user_code, auth_user_id, full_name, email, role_name, default_region_id, is_active, avatar_attachment_id, metadata
         FROM public.app_users
         WHERE auth_user_id = $1 OR id = $1::uuid
         LIMIT 1`,
        [userId]
      )
    : await dbQuery(
        `SELECT id, user_code, auth_user_id, full_name, email, role_name, default_region_id, is_active, avatar_attachment_id, metadata
         FROM public.app_users
         WHERE auth_user_id = $1
         LIMIT 1`,
        [userId]
      );

  const appUser = userRes.rows[0] || null;
  if (!appUser) return null;

  const scopeRes = await dbQuery(
    `SELECT region_id FROM public.user_region_scopes WHERE app_user_id = $1`,
    [appUser.id]
  );
  appUser.user_region_scopes = scopeRes.rows || [];

  return appUser;
}

async function loadAuthUserVerificationDirect(userId) {
  const res = await dbQuery(
    `SELECT id, email, email_verified as "emailVerified" FROM auth.users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  return res.rows[0] || null;
}

async function activatePendingAppUserDirect(userId) {
  await dbQuery(
    `UPDATE public.app_users SET is_active = true WHERE auth_user_id = $1 OR id = $1`,
    [userId]
  );
}

async function authenticate(req, _res, next) {
  try {
    const authHeader = req.headers.authorization || '';

    if (!authHeader.startsWith('Bearer ')) {
      throw createHttpError(401, 'Missing bearer token');
    }

    const token = authHeader.replace('Bearer ', '').trim();
    let claims = null;
    let userId = null;

    // Coba verifikasi dengan Firebase Admin SDK jika aktif
    const firebaseAdmin = getFirebaseAdmin();
    if (firebaseAdmin) {
      try {
        const decoded = await firebaseAdmin.auth().verifyIdToken(token);
        userId = decoded.uid;
        claims = decoded;
      } catch (fbErr) {
        // Fallback decode token manual (JWT payload)
        claims = decodeJwtPayload(token);
        userId = claims.sub || claims.user_id || claims['https://hasura.io/jwt/claims']?.['x-hasura-user-id'];
      }
    } else {
      claims = decodeJwtPayload(token);
      userId = claims.sub || claims.user_id || claims['https://hasura.io/jwt/claims']?.['x-hasura-user-id'];
    }

    if (!userId) {
      throw createHttpError(401, 'Token does not include a valid user id');
    }

    const appUser = await loadAppUserDirect(userId);

    if (!appUser) {
      throw createHttpError(403, 'User is not registered in Syntrix');
    }

    if (!appUser.is_active) {
      const pendingVerification = Boolean(appUser.metadata?.pending_email_verification);

      if (pendingVerification) {
        const authUser = await loadAuthUserVerificationDirect(userId);

        if (!authUser?.emailVerified) {
          throw createHttpError(403, 'Please verify your email before accessing Syntrix');
        }

        await activatePendingAppUserDirect(userId);
        const refreshed = await loadAppUserDirect(userId);
        if (refreshed) {
          Object.assign(appUser, refreshed);
        }
      } else {
        throw createHttpError(403, 'User is inactive in Syntrix');
      }
    }

    req.auth = {
      token,
      claims,
      userId,
      appUser,
      role: appUser.role_name,
      normalizedRole: normalizeRoleName(appUser.role_name),
      regions: (appUser.user_region_scopes || []).map((scope) => scope.region_id),
    };

    return next();
  } catch (error) {
    return next(
      createHttpError(
        error.statusCode || error.response?.status || 401,
        error.response?.data?.message || error.message || 'Authentication failed',
      ),
    );
  }
}

function requireRole(...allowedRoles) {
  return (req, _res, next) => {
    if (!req.auth) {
      return next(createHttpError(401, 'Authentication required'));
    }

    const allowedNormalizedRoles = new Set(allowedRoles.map((role) => normalizeRoleName(role)));
    const requesterRole = req.auth.normalizedRole || normalizeRoleName(req.auth.role);
    if (!allowedNormalizedRoles.has(requesterRole)) {
      return next(createHttpError(403, 'You do not have permission to access this resource'));
    }

    return next();
  };
}

module.exports = { authenticate, requireRole };

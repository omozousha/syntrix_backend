const { nhostAuthClient } = require('../config/nhost');
const { executeHasura } = require('../config/hasura');
const { createHttpError } = require('../utils/httpError');

function decodeJwtPayload(token) {
  const [, payload] = token.split('.');

  if (!payload) {
    throw createHttpError(401, 'Invalid access token');
  }

  const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const json = Buffer.from(padded, 'base64').toString('utf8');

  return JSON.parse(json);
}

async function loadAppUser(userId) {
  const query = `
    query LoadAppUser($userId: uuid!) {
      app_users(where: { auth_user_id: { _eq: $userId } }, limit: 1) {
        id
        user_code
        auth_user_id
        full_name
        email
        role_name
        default_region_id
        is_active
        metadata
      }
    }
  `;

  const data = await executeHasura(query, { userId });
  const appUser = data.app_users?.[0] || null;

  if (!appUser) {
    return null;
  }

  const scopeQuery = `
    query LoadUserScopes($appUserId: uuid!) {
      user_region_scopes(where: { app_user_id: { _eq: $appUserId } }) {
        region_id
      }
    }
  `;

  const scopeData = await executeHasura(scopeQuery, { appUserId: appUser.id });
  appUser.user_region_scopes = scopeData.user_region_scopes || [];

  return appUser;
}

async function authenticate(req, _res, next) {
  try {
    const authHeader = req.headers.authorization || '';

    if (!authHeader.startsWith('Bearer ')) {
      throw createHttpError(401, 'Missing bearer token');
    }

    const token = authHeader.replace('Bearer ', '').trim();

    await nhostAuthClient.post(
      '/token/verify',
      { token },
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    const claims = decodeJwtPayload(token);
    const userId = claims.sub || claims['https://hasura.io/jwt/claims']?.['x-hasura-user-id'];

    if (!userId) {
      throw createHttpError(401, 'Token does not include a valid user id');
    }

    const appUser = await loadAppUser(userId);

    if (!appUser || !appUser.is_active) {
      throw createHttpError(403, 'User is not registered or inactive in Syntrix');
    }

    req.auth = {
      token,
      claims,
      userId,
      appUser,
      role: appUser.role_name,
      regions: appUser.user_region_scopes.map((scope) => scope.region_id),
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

    if (!allowedRoles.includes(req.auth.role)) {
      return next(createHttpError(403, 'You do not have permission to access this resource'));
    }

    return next();
  };
}

module.exports = { authenticate, requireRole };

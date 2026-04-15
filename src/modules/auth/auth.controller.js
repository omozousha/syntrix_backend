const { sendSuccess } = require('../../utils/response');
const { createHttpError } = require('../../utils/httpError');
const { env } = require('../../config/env');
const {
  loginWithPassword,
  signUpUser,
  logout,
  createAppUser,
  countAppUsers,
  findAppUserByEmail,
  findAuthUserByEmail,
  insertUserRegionScopes,
} = require('./auth.service');

function validateRegistrationPayload(payload, { allowAdmin = true } = {}) {
  const {
    email,
    password,
    full_name,
    role_name,
    default_region_id,
    region_ids = [],
  } = payload;

  if (!email || !password || !full_name || !role_name) {
    throw createHttpError(400, 'email, password, full_name, and role_name are required');
  }

  if (!['admin', 'user_region', 'user_all_region'].includes(role_name)) {
    throw createHttpError(400, 'role_name must be admin, user_region, or user_all_region');
  }

  if (!allowAdmin && role_name === 'admin') {
    throw createHttpError(403, 'Creating another admin from this endpoint is not allowed');
  }

  if (role_name === 'user_region' && !(default_region_id || region_ids.length)) {
    throw createHttpError(400, 'Regional user must have at least one assigned region');
  }
}

async function createSyntrixUser(payload) {
  const {
    email,
    password,
    full_name,
    role_name,
    default_region_id,
    region_ids = [],
    metadata = {},
  } = payload;

  const existingUser = await findAppUserByEmail(email);

  if (existingUser) {
    throw createHttpError(409, 'A Syntrix user with this email already exists');
  }

  let authUser = await findAuthUserByEmail(email);

  if (!authUser) {
    await signUpUser({ email, password, displayName: full_name, metadata });
    authUser = await findAuthUserByEmail(email);
  }

  const authUserId = authUser?.id;

  if (!authUserId) {
    throw createHttpError(500, 'Nhost signup succeeded but auth user id was not returned');
  }

  const appUser = await createAppUser({
    auth_user_id: authUserId,
    full_name,
    email,
    role_name,
    default_region_id: default_region_id || null,
    is_active: true,
    metadata,
  });

  const scopes = await insertUserRegionScopes(appUser.id, region_ids);

  return {
    auth_user_id: authUserId,
    app_user: appUser,
    region_scopes: scopes,
  };
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw createHttpError(400, 'email and password are required');
    }

    const data = await loginWithPassword(email, password);
    return sendSuccess(res, data, 'Login successful');
  } catch (error) {
    return next(createHttpError(error.response?.status || 400, error.response?.data?.message || error.message));
  }
}

async function register(req, res, next) {
  try {
    validateRegistrationPayload(req.body);
    const result = await createSyntrixUser(req.body);
    return sendSuccess(res, result, 'User registered successfully', 201);
  } catch (error) {
    return next(createHttpError(error.response?.status || error.statusCode || 400, error.response?.data?.message || error.message));
  }
}

async function bootstrapAdmin(req, res, next) {
  try {
    if (!env.bootstrapAdminSecret) {
      throw createHttpError(500, 'BOOTSTRAP_ADMIN_SECRET is not configured on the server');
    }

    const bootstrapSecret = req.headers['x-bootstrap-secret'];

    if (!bootstrapSecret || bootstrapSecret !== env.bootstrapAdminSecret) {
      throw createHttpError(401, 'Invalid bootstrap secret');
    }

    const existingCount = await countAppUsers();

    if (existingCount > 0) {
      throw createHttpError(409, 'Bootstrap admin is disabled because Syntrix users already exist');
    }

    validateRegistrationPayload(
      {
        ...req.body,
        role_name: 'admin',
      },
      { allowAdmin: true },
    );

    const result = await createSyntrixUser({
      ...req.body,
      role_name: 'admin',
      region_ids: [],
    });

    return sendSuccess(res, result, 'Bootstrap admin created successfully', 201);
  } catch (error) {
    return next(createHttpError(error.response?.status || error.statusCode || 400, error.response?.data?.message || error.message));
  }
}

async function me(req, res) {
  return sendSuccess(res, {
    id: req.auth.userId,
    role: req.auth.role,
    app_user: req.auth.appUser,
    region_ids: req.auth.regions,
  }, 'Current user fetched successfully');
}

async function signout(req, res, next) {
  try {
    const { refresh_token } = req.body;

    if (!refresh_token) {
      throw createHttpError(400, 'refresh_token is required');
    }

    const data = await logout(refresh_token);
    return sendSuccess(res, data, 'Logout successful');
  } catch (error) {
    return next(createHttpError(error.response?.status || 400, error.response?.data?.message || error.message));
  }
}

module.exports = { login, register, bootstrapAdmin, me, signout };

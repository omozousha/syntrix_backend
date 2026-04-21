const { sendSuccess } = require('../../utils/response');
const { createHttpError } = require('../../utils/httpError');
const { env } = require('../../config/env');
const {
  loginWithPassword,
  signUpUser,
  logout,
  changePassword,
  requestPasswordReset,
  createAppUser,
  countAppUsers,
  findAppUserByEmail,
  findAuthUserByEmail,
  activateAppUserByAuthUserId,
  insertUserRegionScopes,
  loadAttachmentById,
  updateOwnProfileByAuthUserId,
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
    require_email_verification = true,
    email_redirect_to,
  } = payload;

  const existingUser = await findAppUserByEmail(email);

  if (existingUser) {
    throw createHttpError(409, 'A Syntrix user with this email already exists');
  }

  let authUser = await findAuthUserByEmail(email);

  if (!authUser) {
    await signUpUser({
      email,
      password,
      displayName: full_name,
      metadata,
      redirectTo: email_redirect_to || env.nhostEmailRedirectTo || '',
    });
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
    is_active: !require_email_verification,
    metadata: {
      ...(metadata || {}),
      pending_email_verification: !!require_email_verification,
      verification_email_sent_at: new Date().toISOString(),
    },
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
    const appUser = await findAppUserByEmail(email);

    if (!appUser) {
      throw createHttpError(403, 'User is not registered in Syntrix');
    }

    if (!appUser.is_active) {
      const pendingVerification = Boolean(appUser.metadata?.pending_email_verification);

      if (!pendingVerification) {
        throw createHttpError(403, 'User is inactive in Syntrix');
      }

      const authUser = await findAuthUserByEmail(email);
      if (!authUser?.emailVerified) {
        throw createHttpError(403, 'Please verify your email before logging in');
      }

      await activateAppUserByAuthUserId(authUser.id);
    }

    return sendSuccess(res, data, 'Login successful');
  } catch (error) {
    return next(createHttpError(error.response?.status || 400, error.response?.data?.message || error.message));
  }
}

async function register(req, res, next) {
  try {
    validateRegistrationPayload(req.body);
    const result = await createSyntrixUser({
      ...req.body,
      require_email_verification: true,
    });
    return sendSuccess(
      res,
      result,
      'User created. Verification email has been sent to the user email address.',
      201,
    );
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
      require_email_verification: false,
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

async function updateMe(req, res, next) {
  try {
    const { full_name, avatar_attachment_id } = req.body || {};
    const changes = {};

    if (full_name !== undefined) {
      const nextName = String(full_name || '').trim();
      if (!nextName) {
        throw createHttpError(400, 'full_name cannot be empty');
      }
      changes.full_name = nextName;
    }

    if (avatar_attachment_id !== undefined) {
      if (avatar_attachment_id === null || avatar_attachment_id === '') {
        changes.avatar_attachment_id = null;
      } else {
        const attachment = await loadAttachmentById(avatar_attachment_id);
        if (!attachment) {
          throw createHttpError(404, 'Avatar attachment not found');
        }
        if (attachment.file_category !== 'image') {
          throw createHttpError(400, 'Avatar attachment must be an image');
        }
        if (
          req.auth.role !== 'admin'
          && attachment.uploaded_by_user_id
          && attachment.uploaded_by_user_id !== req.auth.appUser.id
        ) {
          throw createHttpError(403, 'You can only use your own uploaded image as avatar');
        }
        changes.avatar_attachment_id = attachment.id;
      }
    }

    if (!Object.keys(changes).length) {
      throw createHttpError(400, 'No profile field to update');
    }

    const updated = await updateOwnProfileByAuthUserId(req.auth.userId, changes);
    if (!updated) {
      throw createHttpError(404, 'Profile not found');
    }

    return sendSuccess(res, updated, 'Profile updated successfully');
  } catch (error) {
    return next(createHttpError(error.response?.status || error.statusCode || 400, error.response?.data?.message || error.message));
  }
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

async function changeCurrentPassword(req, res, next) {
  try {
    const { new_password } = req.body;

    if (!new_password || String(new_password).length < 8) {
      throw createHttpError(400, 'new_password is required and must be at least 8 characters');
    }

    const data = await changePassword(req.auth.token, new_password);
    return sendSuccess(res, data, 'Password changed successfully');
  } catch (error) {
    return next(createHttpError(error.response?.status || 400, error.response?.data?.message || error.message));
  }
}

async function resetPassword(req, res, next) {
  try {
    const { email, redirect_to } = req.body;

    if (!email) {
      throw createHttpError(400, 'email is required');
    }

    const data = await requestPasswordReset(email, redirect_to || env.nhostEmailRedirectTo || '');
    return sendSuccess(res, data, 'Password reset email sent successfully');
  } catch (error) {
    return next(createHttpError(error.response?.status || 400, error.response?.data?.message || error.message));
  }
}

module.exports = { login, register, bootstrapAdmin, me, updateMe, signout, changeCurrentPassword, resetPassword };

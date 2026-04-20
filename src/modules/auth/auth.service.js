const { nhostAuthClient } = require('../../config/nhost');
const { executeHasura } = require('../../config/hasura');

async function loginWithPassword(email, password) {
  const { data } = await nhostAuthClient.post('/signin/email-password', { email, password });
  return data;
}

async function signUpUser({ email, password, displayName, metadata = {}, redirectTo = '' }) {
  const options = {
    displayName,
    metadata,
  };

  if (redirectTo) {
    options.redirectTo = redirectTo;
  }

  const { data } = await nhostAuthClient.post('/signup/email-password', {
    email,
    password,
    options,
  });

  return data;
}

async function logout(refreshToken) {
  const { data } = await nhostAuthClient.post('/signout', { refreshToken });
  return data;
}

async function changePassword(token, newPassword) {
  const { data } = await nhostAuthClient.post(
    '/user/password',
    { newPassword },
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  return data;
}

async function requestPasswordReset(email, redirectTo = '') {
  const payload = { email };

  if (redirectTo) {
    payload.options = { redirectTo };
  }

  const { data } = await nhostAuthClient.post('/user/password/reset', payload);
  return data;
}

async function createAppUser(object) {
  const mutation = `
    mutation CreateAppUser($object: app_users_insert_input!) {
      item: insert_app_users_one(object: $object) {
        id
        user_code
        auth_user_id
        full_name
        email
        role_name
        default_region_id
        is_active
        metadata
        created_at
      }
    }
  `;

  const data = await executeHasura(mutation, { object });
  return data.item;
}

async function countAppUsers() {
  const query = `
    query CountAppUsers {
      app_users_aggregate {
        aggregate {
          count
        }
      }
    }
  `;

  const data = await executeHasura(query);
  return data.app_users_aggregate.aggregate.count;
}

async function findAppUserByEmail(email) {
  const query = `
    query FindAppUserByEmail($email: String!) {
      app_users(where: { email: { _eq: $email } }, limit: 1) {
        id
        user_code
        auth_user_id
        full_name
        email
        role_name
        default_region_id
        is_active
        metadata
        created_at
      }
    }
  `;

  const data = await executeHasura(query, { email });
  return data.app_users?.[0] || null;
}

async function findAuthUserByEmail(email) {
  const query = `
    query FindAuthUserByEmail($email: citext!) {
      users(where: { email: { _eq: $email } }, limit: 1) {
        id
        email
        emailVerified
        displayName
        createdAt
      }
    }
  `;

  const data = await executeHasura(query, { email });
  return data.users?.[0] || null;
}

async function activateAppUserByAuthUserId(authUserId) {
  const mutation = `
    mutation ActivateAppUserByAuthUserId($authUserId: uuid!) {
      update_app_users(
        where: { auth_user_id: { _eq: $authUserId } }
        _set: { is_active: true }
      ) {
        affected_rows
      }
    }
  `;

  const data = await executeHasura(mutation, { authUserId });
  return data.update_app_users?.affected_rows || 0;
}

async function insertUserRegionScopes(appUserId, regionIds = []) {
  if (!regionIds.length) {
    return [];
  }

  const mutation = `
    mutation InsertScopes($objects: [user_region_scopes_insert_input!]!) {
      items: insert_user_region_scopes(objects: $objects) {
        returning {
          id
          app_user_id
          region_id
        }
      }
    }
  `;

  const objects = regionIds.map((regionId) => ({ app_user_id: appUserId, region_id: regionId }));
  const data = await executeHasura(mutation, { objects });
  return data.items.returning;
}

module.exports = {
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
};

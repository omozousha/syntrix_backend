const { nhostAuthClient, nhostStorageClient } = require('../../config/nhost');
const { executeHasura } = require('../../config/hasura');
const { env } = require('../../config/env');

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
        avatar_attachment_id
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
        avatar_attachment_id
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

async function loadAttachmentById(id) {
  const query = `
    query LoadAttachmentById($id: uuid!) {
      item: attachments_by_pk(id: $id) {
        id
        storage_file_id
        entity_type
        file_category
        uploaded_by_user_id
      }
    }
  `;

  const data = await executeHasura(query, { id });
  return data.item || null;
}

async function countUsersReferencingAvatar(attachmentId) {
  const query = `
    query CountUsersReferencingAvatar($contains: jsonb!, $attachmentId: uuid!) {
      app_users_aggregate(
        where: {
          _or: [
            { metadata: { _contains: $contains } },
            { avatar_attachment_id: { _eq: $attachmentId } }
          ]
        }
      ) {
        aggregate {
          count
        }
      }
    }
  `;

  const data = await executeHasura(query, {
    contains: { avatar_attachment_id: attachmentId },
    attachmentId,
  });

  return data.app_users_aggregate?.aggregate?.count || 0;
}

async function deleteAttachmentById(id) {
  const mutation = `
    mutation DeleteAttachmentById($id: uuid!) {
      item: delete_attachments_by_pk(id: $id) {
        id
      }
    }
  `;

  const data = await executeHasura(mutation, { id });
  return data.item || null;
}

async function tryDeleteStorageFileById(storageFileId) {
  if (!storageFileId) return false;

  try {
    const response = await nhostStorageClient.delete(`/files/${storageFileId}`, {
      headers: {
        'x-hasura-admin-secret': env.hasuraAdminSecret,
      },
      validateStatus: (status) => status < 500,
    });

    return response.status < 400 || response.status === 404;
  } catch {
    return false;
  }
}

async function cleanupUnusedAvatarAttachment(attachmentId) {
  if (!attachmentId) return false;

  const stillUsed = await countUsersReferencingAvatar(attachmentId);
  if (stillUsed > 0) {
    return false;
  }

  const attachment = await loadAttachmentById(attachmentId);
  if (!attachment) return false;

  // Safety guard: cleanup only for user profile images.
  if (attachment.file_category !== 'image') return false;
  if (attachment.entity_type && attachment.entity_type !== 'user_profile') return false;

  await deleteAttachmentById(attachmentId);
  await tryDeleteStorageFileById(attachment.storage_file_id);
  return true;
}

async function loadUserAvatarAttachmentIds() {
  const query = `
    query LoadUserAvatarAttachmentIds {
      app_users(
        where: {
          _or: [
            { metadata: { _has_key: "avatar_attachment_id" } },
            { avatar_attachment_id: { _is_null: false } }
          ]
        }
      ) {
        id
        avatar_attachment_id
        metadata
      }
    }
  `;

  const data = await executeHasura(query);
  const ids = new Set();

  for (const item of data.app_users || []) {
    const fromMetadata = item?.metadata?.avatar_attachment_id;
    const fromColumn = item?.avatar_attachment_id;
    if (fromMetadata) ids.add(fromMetadata);
    if (fromColumn) ids.add(fromColumn);
  }

  return Array.from(ids);
}

async function listAvatarAttachmentCandidates(limit = 100) {
  const query = `
    query ListAvatarAttachmentCandidates($limit: Int!) {
      attachments(
        where: {
          entity_type: { _eq: "user_profile" }
          file_category: { _eq: "image" }
        }
        order_by: [{ created_at: desc }]
        limit: $limit
      ) {
        id
        attachment_id
        storage_file_id
        original_name
        size_bytes
        uploaded_by_user_id
        created_at
      }
    }
  `;

  const data = await executeHasura(query, { limit });
  return data.attachments || [];
}

async function listOrphanAvatarAttachments(limit = 100) {
  const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 1000);
  const [usedAvatarIds, candidates] = await Promise.all([
    loadUserAvatarAttachmentIds(),
    listAvatarAttachmentCandidates(safeLimit),
  ]);

  const usedSet = new Set(usedAvatarIds);
  return candidates.filter((item) => !usedSet.has(item.id));
}

async function cleanupOrphanAvatarAttachments(limit = 100) {
  const orphans = await listOrphanAvatarAttachments(limit);
  const results = [];

  for (const item of orphans) {
    await deleteAttachmentById(item.id);
    await tryDeleteStorageFileById(item.storage_file_id);
    results.push({
      id: item.id,
      attachment_id: item.attachment_id,
      original_name: item.original_name,
      cleaned: true,
    });
  }

  return {
    total_orphans: orphans.length,
    cleaned_count: results.length,
    cleaned_items: results,
  };
}

async function updateOwnProfileByAuthUserId(authUserId, changes) {
  const mutation = `
    mutation UpdateOwnProfileByAuthUserId(
      $authUserId: uuid!,
      $set: app_users_set_input!
    ) {
      item: update_app_users(
        where: { auth_user_id: { _eq: $authUserId } }
        _set: $set
      ) {
        returning {
          id
          user_code
          auth_user_id
          full_name
          email
          role_name
          default_region_id
          is_active
          avatar_attachment_id
          metadata
          updated_at
        }
      }
    }
  `;

  const data = await executeHasura(mutation, {
    authUserId,
    set: changes,
  });

  return data.item?.returning?.[0] || null;
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
  loadAttachmentById,
  updateOwnProfileByAuthUserId,
  cleanupUnusedAvatarAttachment,
  listOrphanAvatarAttachments,
  cleanupOrphanAvatarAttachments,
};

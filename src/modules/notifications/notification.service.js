const { executeHasura, ensureHasuraTableTracked } = require('../../config/hasura');
const { getFirebaseAdmin } = require('../../config/firebase');
const { env } = require('../../config/env');
const { getResourceById } = require('../../shared/resource.service');
const { getResourceConfig } = require('../resource/resource.registry');

const HIGH_PRIORITY_CHANNEL_ID = 'syntrix_high_priority';

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeDeviceTypeLabel(value) {
  const key = String(value || '').trim().toUpperCase();
  const labels = {
    ODP: 'ODP',
    OLT: 'OLT',
    ODC: 'ODC',
    ONT: 'ONT',
    POLE: 'Pole',
    GROUNDING: 'Grounding',
    ROUTE: 'Route',
    CUSTOMER: 'Customer',
    PROJECT: 'Project',
  };
  return labels[key] || (key ? key : 'Device');
}

function pickFirstText(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function pickDeviceNameFromRequest(request = {}) {
  const snapshot = request.payload_snapshot || {};
  return pickFirstText(
    snapshot.device?.device_name,
    snapshot.resource_payload?.device_name,
    snapshot.device_name,
  );
}

function resolveDeviceDisplayName(request = {}, context = null) {
  return pickFirstText(
    context?.device?.device_name,
    pickDeviceNameFromRequest(request),
    context?.device?.device_code,
    context?.device?.inventory_id,
    context?.device?.device_id,
    request.request_id,
    'Device',
  );
}

function resolveDeviceTypeKey(request = {}, context = null) {
  const snapshot = request.payload_snapshot || {};
  return pickFirstText(
    context?.device?.device_type_key,
    snapshot.device?.device_type_key,
    snapshot.resource_payload?.device_type_key,
    context?.device?.asset_group,
    snapshot.device?.asset_group,
    snapshot.resource_payload?.asset_group,
  ).toUpperCase();
}

function shouldSkipValidationTaskNotification(request = {}, context = null) {
  return ['CUSTOMER', 'ONT'].includes(resolveDeviceTypeKey(request, context));
}

function stringifyData(data = {}) {
  return Object.entries(data).reduce((acc, [key, value]) => {
    if (value === undefined || value === null) return acc;
    acc[key] = typeof value === 'string' ? value : JSON.stringify(value);
    return acc;
  }, {});
}

async function ensureNotificationTablesTracked() {
  await ensureHasuraTableTracked('user_push_tokens');
  await ensureHasuraTableTracked('app_notifications');
}

async function registerPushToken({ userId, token, platform = 'android', deviceId = null, appVersion = null }) {
  const cleanToken = String(token || '').trim();
  if (!cleanToken) {
    const error = new Error('token is required');
    error.statusCode = 400;
    throw error;
  }

  await ensureNotificationTablesTracked();
  const mutation = `
    mutation RegisterPushToken($object: user_push_tokens_insert_input!) {
      item: insert_user_push_tokens_one(
        object: $object
        on_conflict: {
          constraint: uq_user_push_tokens_token
          update_columns: [user_id, platform, device_id, app_version, is_active, revoked_at, last_seen_at]
        }
      ) {
        id
        user_id
        platform
        is_active
        last_seen_at
      }
    }
  `;

  const data = await executeHasura(mutation, {
    object: {
      user_id: userId,
      token: cleanToken,
      platform,
      device_id: deviceId,
      app_version: appVersion,
      is_active: true,
      revoked_at: null,
      last_seen_at: new Date().toISOString(),
    },
  });
  return data.item;
}

async function revokePushToken({ userId, token }) {
  const cleanToken = String(token || '').trim();
  if (!cleanToken) return { affected_rows: 0 };

  await ensureNotificationTablesTracked();
  const mutation = `
    mutation RevokePushToken($userId: uuid!, $token: String!, $now: timestamptz!) {
      result: update_user_push_tokens(
        where: { user_id: { _eq: $userId }, token: { _eq: $token } }
        _set: { is_active: false, revoked_at: $now }
      ) {
        affected_rows
      }
    }
  `;
  const data = await executeHasura(mutation, { userId, token: cleanToken, now: new Date().toISOString() });
  return data.result;
}

async function listUserNotifications({ userId, limit = 30 }) {
  await ensureNotificationTablesTracked();
  const query = `
    query ListUserNotifications($userId: uuid!, $limit: Int!) {
      items: app_notifications(
        where: { recipient_user_id: { _eq: $userId } }
        order_by: [{ created_at: desc }]
        limit: $limit
      ) {
        id
        notification_type
        title
        body
        data
        entity_type
        entity_id
        request_id
        region_id
        read_at
        pushed_at
        created_at
      }
      unread: app_notifications_aggregate(
        where: { recipient_user_id: { _eq: $userId }, read_at: { _is_null: true } }
      ) {
        aggregate { count }
      }
    }
  `;
  const data = await executeHasura(query, { userId, limit: Math.max(1, Math.min(Number(limit) || 30, 100)) });
  return {
    unread_count: data.unread?.aggregate?.count || 0,
    items: data.items || [],
  };
}

async function markNotificationRead({ userId, notificationId }) {
  await ensureNotificationTablesTracked();
  const mutation = `
    mutation MarkNotificationRead($userId: uuid!, $id: uuid!, $now: timestamptz!) {
      result: update_app_notifications(
        where: { id: { _eq: $id }, recipient_user_id: { _eq: $userId } }
        _set: { read_at: $now }
      ) {
        returning {
          id
          recipient_user_id
          read_at
        }
      }
    }
  `;
  const data = await executeHasura(mutation, { userId, id: notificationId, now: new Date().toISOString() });
  return data.result?.returning?.[0] || null;
}

async function markAllNotificationsRead({ userId }) {
  await ensureNotificationTablesTracked();
  const mutation = `
    mutation MarkAllNotificationsRead($userId: uuid!, $now: timestamptz!) {
      result: update_app_notifications(
        where: { recipient_user_id: { _eq: $userId }, read_at: { _is_null: true } }
        _set: { read_at: $now }
      ) {
        affected_rows
      }
    }
  `;
  const data = await executeHasura(mutation, { userId, now: new Date().toISOString() });
  return data.result || { affected_rows: 0 };
}

async function loadActiveTokens(userIds) {
  if (!userIds.length) return [];
  await ensureNotificationTablesTracked();
  const query = `
    query LoadActivePushTokens($userIds: [uuid!]!) {
      items: user_push_tokens(
        where: { user_id: { _in: $userIds }, is_active: { _eq: true } }
      ) {
        id
        user_id
        token
      }
    }
  `;
  const data = await executeHasura(query, { userIds });
  return data.items || [];
}

async function deactivateTokens(tokens) {
  if (!tokens.length) return;
  await ensureNotificationTablesTracked();
  const mutation = `
    mutation DeactivatePushTokens($tokens: [String!]!, $now: timestamptz!) {
      update_user_push_tokens(
        where: { token: { _in: $tokens } }
        _set: { is_active: false, revoked_at: $now }
      ) {
        affected_rows
      }
    }
  `;
  await executeHasura(mutation, { tokens, now: new Date().toISOString() });
}

async function createInboxRows({ userIds, notificationType, title, body, data, entityType, entityId, requestId, regionId }) {
  if (!userIds.length) return [];
  await ensureNotificationTablesTracked();
  const mutation = `
    mutation CreateAppNotifications($objects: [app_notifications_insert_input!]!) {
      items: insert_app_notifications(objects: $objects) {
        returning {
          id
          recipient_user_id
        }
      }
    }
  `;
  const objects = userIds.map((userId) => ({
    recipient_user_id: userId,
    notification_type: notificationType,
    title,
    body,
    data,
    entity_type: entityType,
    entity_id: entityId,
    request_id: requestId,
    region_id: regionId,
  }));
  const result = await executeHasura(mutation, { objects });
  return result.items?.returning || [];
}

async function markRowsPushed(rowIds, pushError = null) {
  if (!rowIds.length) return;
  const mutation = `
    mutation MarkRowsPushed($ids: [uuid!]!, $now: timestamptz!, $pushError: String) {
      update_app_notifications(
        where: { id: { _in: $ids } }
        _set: { pushed_at: $now, push_error: $pushError }
      ) {
        affected_rows
      }
    }
  `;
  await executeHasura(mutation, { ids: rowIds, now: new Date().toISOString(), pushError });
}

async function markRowsPushError(rowIds, pushError) {
  if (!rowIds.length || !pushError) return;
  const mutation = `
    mutation MarkRowsPushError($ids: [uuid!]!, $pushError: String) {
      update_app_notifications(
        where: { id: { _in: $ids } }
        _set: { push_error: $pushError }
      ) {
        affected_rows
      }
    }
  `;
  await executeHasura(mutation, { ids: rowIds, pushError });
}

async function sendNotificationToUsers({
  userIds,
  notificationType,
  title,
  body,
  data = {},
  entityType = null,
  entityId = null,
  requestId = null,
  regionId = null,
}) {
  const recipients = unique(userIds);
  if (!recipients.length) return { recipients: 0, pushed: 0 };

  let inboxRows = [];
  try {
    inboxRows = await createInboxRows({
      userIds: recipients,
      notificationType,
      title,
      body,
      data,
      entityType,
      entityId,
      requestId,
      regionId,
    });

    const admin = getFirebaseAdmin();
    if (!admin || !env.fcmEnabled) {
      await markRowsPushError(inboxRows.map((row) => row.id), 'FCM disabled or Firebase admin unavailable');
      return { recipients: recipients.length, pushed: 0, skipped: true };
    }

    const tokenRows = await loadActiveTokens(recipients);
    const tokens = unique(tokenRows.map((row) => row.token));
    if (!tokens.length) {
      await markRowsPushError(inboxRows.map((row) => row.id), 'No active push tokens for recipients');
      return { recipients: recipients.length, pushed: 0 };
    }

    const isPersistent = data?.persistent === true || data?.persistent === 'true';
    const message = {
      tokens,
      data: stringifyData({
        ...data,
        title,
        body,
        channel_id: HIGH_PRIORITY_CHANNEL_ID,
      }),
      android: {
        priority: 'high',
      },
    };

    if (!isPersistent) {
      message.notification = { title, body };
      message.android.notification = {
          channelId: HIGH_PRIORITY_CHANNEL_ID,
          priority: 'high',
          visibility: 'public',
          sound: 'default',
      };
    }

    const response = await admin.messaging().sendEachForMulticast(message);

    const invalidTokens = [];
    response.responses.forEach((item, index) => {
      const code = item.error?.code || '';
      if (code.includes('registration-token-not-registered') || code.includes('invalid-registration-token')) {
        invalidTokens.push(tokens[index]);
      }
    });
    await deactivateTokens(invalidTokens);
    await markRowsPushed(inboxRows.map((row) => row.id), response.failureCount ? `${response.failureCount} push delivery failed` : null);

    return { recipients: recipients.length, pushed: response.successCount, failed: response.failureCount };
  } catch (error) {
    console.warn('Push notification delivery failed:', error.message || error);
    await markRowsPushError(inboxRows.map((row) => row.id), error.message || 'push failed').catch(() => undefined);
    return { recipients: recipients.length, pushed: 0, error: error.message || 'push failed' };
  }
}

async function loadDeviceNotificationContext(deviceId) {
  if (!deviceId) return null;
  const identifier = String(deviceId).trim();
  const devicesConfig = getResourceConfig('devices');
  const deviceFields = `
        id
        device_id
        device_code
        device_name
        inventory_id
        device_type_key
        asset_group
        pop_id
        region_id
  `;

  let device = null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(identifier)) {
    device = await getResourceById(devicesConfig, identifier).catch(() => null);
  }

  if (!device) {
    const data = await executeHasura(`
      query FindDeviceNotificationContext($identifier: String!) {
        devices(
          where: {
            _or: [
              { device_id: { _eq: $identifier } }
              { device_code: { _eq: $identifier } }
              { inventory_id: { _eq: $identifier } }
            ]
          }
          limit: 1
        ) {
          ${deviceFields}
        }
      }
    `, { identifier });
    device = data.devices?.[0] || null;
  }

  if (!device) return null;

  let pop = null;
  if (device.pop_id) {
    const popData = await executeHasura(`
      query LoadPopNotificationContext($id: uuid!) {
        pop: pops_by_pk(id: $id) {
          id
          pop_name
          pop_code
        }
      }
    `, { id: device.pop_id }).catch(() => ({ pop: null }));
    pop = popData.pop || null;
  }

  return {
    device,
    deviceName: resolveDeviceDisplayName({}, { device }),
    deviceTypeLabel: normalizeDeviceTypeLabel(device.device_type_key || device.asset_group),
    popName: pop?.pop_name || pop?.pop_code || 'POP terkait',
  };
}

async function listValidatorUserIdsByRegion(regionId) {
  if (!regionId) return [];
  const data = await executeHasura(`
    query ListRegionalValidators($regionId: uuid!) {
      validators: app_users(
        where: {
          is_active: { _eq: true }
          role_name: { _in: ["validator", "user_region"] }
        }
      ) { id default_region_id }
      scopedUsers: user_region_scopes(
        where: { region_id: { _eq: $regionId } }
      ) { app_user_id }
    }
  `, { regionId });

  const scopedUserIds = new Set((data.scopedUsers || []).map((row) => row.app_user_id));
  return unique([
    ...(data.validators || [])
      .filter((row) => row.default_region_id === regionId || scopedUserIds.has(row.id))
      .map((row) => row.id),
  ]);
}

async function filterUserIdsByRegion(userIds, regionId) {
  const ids = unique(userIds);
  if (!ids.length || !regionId) return [];

  const data = await executeHasura(`
    query FilterNotificationRecipientsByRegion($userIds: [uuid!]!, $regionId: uuid!) {
      users: app_users(
        where: { id: { _in: $userIds }, is_active: { _eq: true } }
      ) {
        id
        default_region_id
      }
      scopedUsers: user_region_scopes(
        where: { app_user_id: { _in: $userIds }, region_id: { _eq: $regionId } }
      ) {
        app_user_id
      }
    }
  `, { userIds: ids, regionId });

  const scopedUserIds = new Set((data.scopedUsers || []).map((row) => row.app_user_id));
  return unique((data.users || [])
    .filter((row) => row.default_region_id === regionId || scopedUserIds.has(row.id))
    .map((row) => row.id));
}

async function notifyValidationRequestStatus({ request, status, actorRole }) {
  const context = await loadDeviceNotificationContext(request.entity_id).catch(() => null);
  const deviceType = context?.deviceTypeLabel || 'Device';
  const deviceName = resolveDeviceDisplayName(request, context);
  const statusCopy = {
    approved_by_adminregion: {
      title: 'Request validasi disetujui adminregion',
      body: `${deviceType} ${deviceName} diteruskan ke review superadmin.`,
    },
    rejected_by_adminregion: {
      title: 'Request validasi ditolak adminregion',
      body: `${deviceType} ${deviceName} perlu diperbaiki sebelum diajukan ulang.`,
    },
    approved_by_superadmin: {
      title: 'Request validasi disetujui superadmin',
      body: `${deviceType} ${deviceName} sudah masuk data utama Syntrix.`,
    },
    rejected_by_superadmin: {
      title: 'Request validasi ditolak superadmin',
      body: `${deviceType} ${deviceName} perlu direview ulang oleh adminregion.`,
    },
  }[status];

  if (!statusCopy || !request.submitted_by_user_id) return;
  const regionalRecipients = await filterUserIdsByRegion([request.submitted_by_user_id], request.region_id).catch(() => []);
  if (!regionalRecipients.length) return;

  await sendNotificationToUsers({
    userIds: regionalRecipients,
    notificationType: status,
    title: statusCopy.title,
    body: statusCopy.body,
    entityType: request.entity_type,
    entityId: request.entity_id,
    requestId: request.id,
    regionId: request.region_id,
    data: {
      type: status,
      actor_role: actorRole,
      entity_type: request.entity_type,
      entity_id: request.entity_id,
      request_id: request.id,
      request_code: request.request_id,
      device_name: deviceName,
      region_id: request.region_id,
      route: 'validation_status',
    },
  });
}

async function notifyValidationTaskCreated({ request }) {
  const context = await loadDeviceNotificationContext(request.entity_id).catch(() => null);
  if (shouldSkipValidationTaskNotification(request, context)) return;

  const validatorUserIds = await listValidatorUserIdsByRegion(request.region_id).catch(() => []);
  if (!validatorUserIds.length) return;

  const deviceType = context?.deviceTypeLabel || 'Device';
  const deviceName = resolveDeviceDisplayName(request, context);
  const popName = context?.popName || 'POP terkait';

  await sendNotificationToUsers({
    userIds: validatorUserIds,
    notificationType: 'validation_task_created',
    title: `${deviceType} baru siap divalidasi`,
    body: `${deviceName} di ${popName} sudah disetujui superadmin.`,
    entityType: request.entity_type,
    entityId: request.entity_id,
    requestId: request.id,
    regionId: request.region_id,
    data: {
      type: 'validation_task_created',
      entity_type: request.entity_type,
      entity_id: request.entity_id,
      request_id: request.id,
      request_code: request.request_id,
      device_name: deviceName,
      region_id: request.region_id,
      route: 'asset_detail',
    },
  });
}

async function sendValidationReminder({ deviceId, validatorUserId, actorUserId, actorRole, actorRegionIds = [] }) {
  const context = await loadDeviceNotificationContext(deviceId).catch(() => null);
  if (!context?.device?.id) {
    const error = new Error('Device not found');
    error.statusCode = 404;
    throw error;
  }

  const regionId = context.device.region_id;
  if (actorRole !== 'superadmin' && !actorRegionIds.includes(regionId)) {
    const error = new Error('You do not have access to this device region');
    error.statusCode = 403;
    throw error;
  }

  const regionalRecipients = await filterUserIdsByRegion([validatorUserId], regionId).catch(() => []);
  if (!regionalRecipients.length) {
    const error = new Error('Validator is not active or outside device region');
    error.statusCode = 403;
    throw error;
  }

  const validatorData = await executeHasura(`
    query LoadReminderValidator($id: uuid!) {
      validator: app_users_by_pk(id: $id) {
        id
        role_name
        is_active
      }
    }
  `, { id: regionalRecipients[0] });
  const validator = validatorData.validator || null;
  if (!validator?.is_active || !['validator', 'user_region'].includes(validator.role_name)) {
    const error = new Error('Selected recipient must be an active validator');
    error.statusCode = 400;
    throw error;
  }

  const deviceType = context.deviceTypeLabel || 'Device';
  const deviceName = context.deviceName || resolveDeviceDisplayName({}, context);
  const popName = context.popName || 'POP terkait';

  return sendNotificationToUsers({
    userIds: [validator.id],
    notificationType: 'validation_reminder',
    title: `Reminder validasi ${deviceType}`,
    body: `${deviceName} di ${popName} menunggu validasi lapangan.`,
    entityType: 'device',
    entityId: context.device.id,
    regionId,
    data: {
      type: 'validation_reminder',
      persistent: true,
      dismiss_action: true,
      actor_user_id: actorUserId,
      entity_type: 'device',
      entity_id: context.device.id,
      device_name: deviceName,
      region_id: regionId,
      route: 'asset_detail',
    },
  });
}

module.exports = {
  HIGH_PRIORITY_CHANNEL_ID,
  registerPushToken,
  revokePushToken,
  listUserNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  sendNotificationToUsers,
  sendValidationReminder,
  notifyValidationRequestStatus,
  notifyValidationTaskCreated,
};

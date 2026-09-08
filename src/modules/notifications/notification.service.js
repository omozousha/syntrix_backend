const { query } = require('../../config/db');
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

async function registerPushToken({ userId, token, platform = 'android', deviceId = null, appVersion = null }) {
  const cleanToken = String(token || '').trim();
  if (!cleanToken) {
    const error = new Error('token is required');
    error.statusCode = 400;
    throw error;
  }

  const sql = `
    INSERT INTO public.user_push_tokens
      (user_id, token, platform, device_id, app_version, is_active, revoked_at, last_seen_at)
    VALUES ($1, $2, $3, $4, $5, true, null, NOW())
    ON CONFLICT (token) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      platform = EXCLUDED.platform,
      device_id = EXCLUDED.device_id,
      app_version = EXCLUDED.app_version,
      is_active = true,
      revoked_at = null,
      last_seen_at = NOW()
    RETURNING id, user_id, platform, is_active, last_seen_at;
  `;

  const res = await query(sql, [userId, cleanToken, platform, deviceId, appVersion]);
  return res.rows[0];
}

async function revokePushToken({ userId, token }) {
  const cleanToken = String(token || '').trim();
  if (!cleanToken) return { affected_rows: 0 };

  const sql = `
    UPDATE public.user_push_tokens
    SET is_active = false, revoked_at = NOW()
    WHERE user_id = $1 AND token = $2;
  `;
  const res = await query(sql, [userId, cleanToken]);
  return { affected_rows: res.rowCount };
}

async function listUserNotifications({ userId, limit = 30 }) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 30, 100));

  const itemsSql = `
    SELECT
      id,
      notification_type,
      title,
      body,
      data,
      entity_type,
      entity_id,
      request_id,
      region_id,
      read_at,
      pushed_at,
      created_at
    FROM public.app_notifications
    WHERE recipient_user_id = $1
    ORDER BY created_at DESC
    LIMIT $2;
  `;

  const countSql = `
    SELECT COUNT(*)::int AS unread_count
    FROM public.app_notifications
    WHERE recipient_user_id = $1 AND read_at IS NULL;
  `;

  const [itemsRes, countRes] = await Promise.all([
    query(itemsSql, [userId, safeLimit]),
    query(countSql, [userId]),
  ]);

  return {
    unread_count: countRes.rows[0]?.unread_count || 0,
    items: itemsRes.rows || [],
  };
}

async function markNotificationRead({ userId, notificationId }) {
  const sql = `
    UPDATE public.app_notifications
    SET read_at = NOW()
    WHERE id = $1 AND recipient_user_id = $2
    RETURNING id, recipient_user_id, read_at;
  `;
  const res = await query(sql, [notificationId, userId]);
  return res.rows[0] || null;
}

async function markAllNotificationsRead({ userId }) {
  const sql = `
    UPDATE public.app_notifications
    SET read_at = NOW()
    WHERE recipient_user_id = $1 AND read_at IS NULL;
  `;
  const res = await query(sql, [userId]);
  return { affected_rows: res.rowCount };
}

async function loadActiveTokens(userIds) {
  if (!userIds.length) return [];
  const sql = `
    SELECT id, user_id, token
    FROM public.user_push_tokens
    WHERE user_id = ANY($1::uuid[]) AND is_active = true;
  `;
  const res = await query(sql, [userIds]);
  return res.rows || [];
}

async function deactivateTokens(tokens) {
  if (!tokens.length) return;
  const sql = `
    UPDATE public.user_push_tokens
    SET is_active = false, revoked_at = NOW()
    WHERE token = ANY($1::text[]);
  `;
  await query(sql, [tokens]);
}

async function createInboxRows({ userIds, notificationType, title, body, data, entityType, entityId, requestId, regionId }) {
  if (!userIds.length) return [];

  const values = [];
  const placeholders = [];
  let idx = 1;

  for (const userId of userIds) {
    placeholders.push(`($${idx}, $${idx + 1}, $${idx + 2}, $${idx + 3}, $${idx + 4}, $${idx + 5}, $${idx + 6}, $${idx + 7}, $${idx + 8})`);
    values.push(
      userId,
      notificationType,
      title,
      body,
      data ? JSON.stringify(data) : null,
      entityType,
      entityId,
      requestId,
      regionId
    );
    idx += 9;
  }

  const sql = `
    INSERT INTO public.app_notifications
      (recipient_user_id, notification_type, title, body, data, entity_type, entity_id, request_id, region_id)
    VALUES ${placeholders.join(', ')}
    RETURNING id, recipient_user_id;
  `;

  const res = await query(sql, values);
  return res.rows || [];
}

async function markRowsPushed(rowIds, pushError = null) {
  if (!rowIds.length) return;
  const sql = `
    UPDATE public.app_notifications
    SET pushed_at = NOW(), push_error = $1
    WHERE id = ANY($2::uuid[]);
  `;
  await query(sql, [pushError, rowIds]);
}

async function markRowsPushError(rowIds, pushError) {
  if (!rowIds.length || !pushError) return;
  const sql = `
    UPDATE public.app_notifications
    SET push_error = $1
    WHERE id = ANY($2::uuid[]);
  `;
  await query(sql, [pushError, rowIds]);
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
    const payloadData = stringifyData({
      ...data,
      title,
      body,
      channel_id: HIGH_PRIORITY_CHANNEL_ID,
    });

    const messaging = admin.messaging();
    const sendResults = await Promise.allSettled(
      tokens.map((token) =>
        messaging.send({
          token,
          notification: { title, body },
          data: payloadData,
          android: {
            priority: 'high',
            notification: {
              channelId: HIGH_PRIORITY_CHANNEL_ID,
              priority: 'high',
              visibility: 'public',
              sound: 'default',
            },
          },
        })
      )
    );

    const invalidTokens = [];
    let successCount = 0;
    let failureCount = 0;

    sendResults.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        successCount += 1;
      } else {
        failureCount += 1;
        const code = result.reason?.code || result.reason?.message || '';
        if (
          code.includes('registration-token-not-registered') ||
          code.includes('invalid-registration-token') ||
          code.includes('messaging/registration-token-not-registered') ||
          code.includes('messaging/invalid-registration-token')
        ) {
          invalidTokens.push(tokens[index]);
        }
      }
    });

    if (invalidTokens.length) {
      await deactivateTokens(invalidTokens);
    }

    await markRowsPushed(
      inboxRows.map((row) => row.id),
      failureCount ? `${failureCount} push delivery failed` : null
    );

    return { recipients: recipients.length, pushed: successCount, failed: failureCount };
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

  let device = null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(identifier)) {
    device = await getResourceById(devicesConfig, identifier).catch(() => null);
  }

  if (!device) {
    const res = await query(
      `SELECT id, device_id, device_code, device_name, inventory_id, device_type_key, asset_group, pop_id, region_id
       FROM public.devices
       WHERE device_id = $1 OR device_code = $1 OR inventory_id = $1
       LIMIT 1`,
      [identifier]
    );
    device = res.rows[0] || null;
  }

  if (!device) return null;

  let pop = null;
  if (device.pop_id) {
    const popRes = await query(
      `SELECT id, pop_name, pop_code FROM public.pops WHERE id = $1 LIMIT 1`,
      [device.pop_id]
    ).catch(() => ({ rows: [] }));
    pop = popRes.rows[0] || null;
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
  const sql = `
    SELECT u.id
    FROM public.app_users u
    LEFT JOIN public.user_region_scopes s ON s.app_user_id = u.id
    WHERE u.is_active = true
      AND u.role_name IN ('validator', 'user_region')
      AND (u.default_region_id = $1 OR s.region_id = $1);
  `;
  const res = await query(sql, [regionId]);
  return unique(res.rows.map((r) => r.id));
}

async function filterUserIdsByRegion(userIds, regionId) {
  const ids = unique(userIds);
  if (!ids.length || !regionId) return [];

  const sql = `
    SELECT u.id
    FROM public.app_users u
    LEFT JOIN public.user_region_scopes s ON s.app_user_id = u.id
    WHERE u.id = ANY($1::uuid[])
      AND u.is_active = true
      AND (u.default_region_id = $2 OR s.region_id = $2);
  `;
  const res = await query(sql, [ids, regionId]);
  return unique(res.rows.map((r) => r.id));
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

  const validatorRes = await query(
    `SELECT id, role_name, is_active FROM public.app_users WHERE id = $1 LIMIT 1`,
    [regionalRecipients[0]]
  );
  const validator = validatorRes.rows[0] || null;
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

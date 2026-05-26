const { createHttpError } = require('../../utils/httpError');
const { sendSuccess } = require('../../utils/response');
const { getFirebaseHealth } = require('../../config/firebase');
const {
  listUserNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  registerPushToken,
  revokePushToken,
  sendValidationReminder,
} = require('./notification.service');

async function registerToken(req, res, next) {
  try {
    const item = await registerPushToken({
      userId: req.auth.appUser.id,
      token: req.body?.token,
      platform: req.body?.platform || 'android',
      deviceId: req.body?.device_id || null,
      appVersion: req.body?.app_version || null,
    });
    return sendSuccess(res, item, 'Push token registered');
  } catch (error) {
    return next(createHttpError(error.statusCode || 400, error.message || 'Failed to register push token'));
  }
}

async function revokeToken(req, res, next) {
  try {
    const token = req.params.token || req.body?.token;
    const result = await revokePushToken({
      userId: req.auth.appUser.id,
      token,
    });
    return sendSuccess(res, result, 'Push token revoked');
  } catch (error) {
    return next(createHttpError(error.statusCode || 400, error.message || 'Failed to revoke push token'));
  }
}

async function listNotifications(req, res, next) {
  try {
    const result = await listUserNotifications({
      userId: req.auth.appUser.id,
      limit: req.query?.limit,
    });
    return sendSuccess(res, result, 'Notifications loaded');
  } catch (error) {
    return next(createHttpError(error.statusCode || 400, error.message || 'Failed to load notifications'));
  }
}

async function readNotification(req, res, next) {
  try {
    const item = await markNotificationRead({
      userId: req.auth.appUser.id,
      notificationId: req.params.id,
    });
    if (!item) throw createHttpError(404, 'Notification not found');
    return sendSuccess(res, item, 'Notification marked as read');
  } catch (error) {
    return next(createHttpError(error.statusCode || 400, error.message || 'Failed to update notification'));
  }
}

async function readAllNotifications(req, res, next) {
  try {
    const result = await markAllNotificationsRead({
      userId: req.auth.appUser.id,
    });
    return sendSuccess(res, result, 'Notifications marked as read');
  } catch (error) {
    return next(createHttpError(error.statusCode || 400, error.message || 'Failed to update notifications'));
  }
}

async function getFcmHealth(_req, res, next) {
  try {
    return sendSuccess(res, getFirebaseHealth(), 'FCM health loaded');
  } catch (error) {
    return next(createHttpError(error.statusCode || 400, error.message || 'Failed to load FCM health'));
  }
}

async function createValidationReminder(req, res, next) {
  try {
    const result = await sendValidationReminder({
      deviceId: req.body?.device_id,
      validatorUserId: req.body?.validator_user_id,
      actorUserId: req.auth.appUser.id,
      actorRole: req.auth.normalizedRole,
      actorRegionIds: req.auth.regions || [],
    });
    return sendSuccess(res, result, 'Validation reminder sent');
  } catch (error) {
    return next(createHttpError(error.statusCode || 400, error.message || 'Failed to send validation reminder'));
  }
}

module.exports = {
  registerToken,
  revokeToken,
  listNotifications,
  readNotification,
  readAllNotifications,
  getFcmHealth,
  createValidationReminder,
};

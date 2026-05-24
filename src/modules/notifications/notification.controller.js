const { createHttpError } = require('../../utils/httpError');
const { sendSuccess } = require('../../utils/response');
const {
  listUserNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  registerPushToken,
  revokePushToken,
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

module.exports = {
  registerToken,
  revokeToken,
  listNotifications,
  readNotification,
  readAllNotifications,
};

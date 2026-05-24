const express = require('express');
const { authenticate, requireRole } = require('../../middleware/auth.middleware');
const controller = require('./notification.controller');

const notificationRouter = express.Router();

notificationRouter.use(authenticate);
notificationRouter.post('/push-tokens', controller.registerToken);
notificationRouter.delete('/push-tokens/:token', controller.revokeToken);
notificationRouter.post('/push-tokens/revoke', controller.revokeToken);
notificationRouter.get('/notifications', controller.listNotifications);
notificationRouter.get('/notifications/fcm-health', requireRole('superadmin'), controller.getFcmHealth);
notificationRouter.patch('/notifications/read-all', controller.readAllNotifications);
notificationRouter.post('/notifications/read-all', controller.readAllNotifications);
notificationRouter.patch('/notifications/:id/read', controller.readNotification);
notificationRouter.post('/notifications/:id/read', controller.readNotification);

module.exports = { notificationRouter };

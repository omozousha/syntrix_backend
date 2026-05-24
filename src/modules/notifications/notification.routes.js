const express = require('express');
const { authenticate } = require('../../middleware/auth.middleware');
const controller = require('./notification.controller');

const notificationRouter = express.Router();

notificationRouter.use(authenticate);
notificationRouter.post('/push-tokens', controller.registerToken);
notificationRouter.delete('/push-tokens/:token', controller.revokeToken);
notificationRouter.post('/push-tokens/revoke', controller.revokeToken);
notificationRouter.get('/notifications', controller.listNotifications);
notificationRouter.post('/notifications/:id/read', controller.readNotification);

module.exports = { notificationRouter };

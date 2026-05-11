const express = require('express');
const { authenticate, requireRole } = require('../../middleware/auth.middleware');
const controller = require('./auth.controller');

const authRouter = express.Router();

authRouter.post('/login', controller.login);
authRouter.post('/bootstrap-admin', controller.bootstrapAdmin);
authRouter.post('/register', authenticate, requireRole('admin', 'user_all_region'), controller.register);
authRouter.get('/me', authenticate, controller.me);
authRouter.patch('/me', authenticate, requireRole('admin', 'user_region', 'user_all_region'), controller.updateMe);
authRouter.post('/logout', controller.signout);
authRouter.post('/refresh', controller.refresh);
authRouter.post('/change-password', authenticate, requireRole('admin', 'user_region', 'user_all_region'), controller.changeCurrentPassword);
authRouter.post('/reset-password', controller.resetPassword);
authRouter.get('/avatar-orphans', authenticate, requireRole('admin'), controller.auditAvatarOrphans);
authRouter.post('/avatar-orphans/cleanup', authenticate, requireRole('admin'), controller.cleanupAvatarOrphans);

module.exports = { authRouter };

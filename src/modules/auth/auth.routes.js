const express = require('express');
const { authenticate, requireRole } = require('../../middleware/auth.middleware');
const controller = require('./auth.controller');

const authRouter = express.Router();

authRouter.post('/login', controller.login);
authRouter.post('/bootstrap-admin', controller.bootstrapAdmin);
authRouter.post('/register', authenticate, requireRole('admin'), controller.register);
authRouter.get('/me', authenticate, controller.me);
authRouter.post('/logout', controller.signout);

module.exports = { authRouter };

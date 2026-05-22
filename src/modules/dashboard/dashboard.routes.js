const express = require('express');
const { authenticate, requireRole } = require('../../middleware/auth.middleware');
const controller = require('./dashboard.controller');

const dashboardRouter = express.Router();

dashboardRouter.get('/summary', authenticate, requireRole('admin', 'user_region', 'user_all_region'), controller.summary);
dashboardRouter.get('/validation-progress', authenticate, requireRole('admin', 'user_region', 'user_all_region'), controller.validationProgress);

module.exports = { dashboardRouter };

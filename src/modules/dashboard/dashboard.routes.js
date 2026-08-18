const express = require('express');
const { authenticate, requireRole } = require('../../middleware/auth.middleware');
const controller = require('./dashboard.controller');
const odpSummaryController = require('./odp-summary.controller');

const dashboardRouter = express.Router();

dashboardRouter.get('/summary', authenticate, requireRole('admin', 'user_region', 'user_all_region'), controller.summary);
dashboardRouter.get('/validation-progress', authenticate, requireRole('admin', 'user_region', 'user_all_region'), controller.validationProgress);
dashboardRouter.get('/odp-summary', authenticate, requireRole('admin', 'user_region', 'user_all_region'), odpSummaryController.getSummary);

module.exports = { dashboardRouter };

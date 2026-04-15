const express = require('express');
const { authenticate, requireRole } = require('../../middleware/auth.middleware');
const controller = require('./dashboard.controller');

const dashboardRouter = express.Router();

dashboardRouter.get('/summary', authenticate, requireRole('admin', 'user_region', 'user_all_region'), controller.summary);

module.exports = { dashboardRouter };

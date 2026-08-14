const express = require('express');
const { getRoute } = require('./routing.controller');
const { authenticate, requireRole } = require('../../middleware/auth.middleware');

const routingRouter = express.Router();

// GET /api/v1/routing/route?origin=lng,lat&destination=lng,lat
routingRouter.get(
  '/route',
  authenticate,
  requireRole('admin', 'user_region', 'user_all_region'),
  getRoute,
);

module.exports = { routingRouter };

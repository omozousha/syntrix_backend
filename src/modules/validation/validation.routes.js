const express = require('express');
const { authenticate } = require('../../middleware/auth.middleware');
const {
  submitValidationRequest,
  listValidationRequests,
  approveByAdminRegion,
  rejectByAdminRegion,
  approveBySuperAdmin,
  rejectBySuperAdmin,
  getValidationRequestHistory,
  getRejectReasonMetrics,
} = require('./validation.controller');

const validationRouter = express.Router();

validationRouter.use(authenticate);

validationRouter.post('/', submitValidationRequest);
validationRouter.get('/', listValidationRequests);
validationRouter.get('/metrics/reject-reasons', getRejectReasonMetrics);
validationRouter.get('/:id/history', getValidationRequestHistory);

validationRouter.post('/:id/adminregion/approve', approveByAdminRegion);
validationRouter.post('/:id/adminregion/reject', rejectByAdminRegion);

validationRouter.post('/:id/superadmin/approve', approveBySuperAdmin);
validationRouter.post('/:id/superadmin/reject', rejectBySuperAdmin);

module.exports = { validationRouter };

const { sendSuccess } = require('../../utils/response');
const { createHttpError } = require('../../utils/httpError');
const { env } = require('../../config/env');
const { createAuditLog } = require('../../shared/audit.service');
const {
  STATUS,
  ACTION,
  normalizeRole,
  assertRejectNote,
  assertHasRegionAccess,
  loadDeviceById,
  loadRequestById,
  loadActiveRequestByEntity,
  createRequest,
  resubmitActiveRequest,
  insertRequestLog,
  listRequestsByQueue,
  listQualityQueueRequests,
  listRequestsForValidator,
  listRequestsByEntity,
  updateRequestStatus,
  listRequestHistory,
  listRejectReasonMetrics,
  listNotificationInbox,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getNotificationDigest,
  applyValidationPayloadToAsset,
} = require('./validation.service');

function getRequestContext(req) {
  return {
    actorUserId: req.auth.appUser.id,
    actorRole: normalizeRole(req.auth.role),
    regionIds: req.auth.regions || [],
  };
}

function isValidator(role) {
  return role === 'validator';
}

function isAdminRegion(role) {
  return role === 'adminregion';
}

function isSuperAdmin(role) {
  return role === 'superadmin';
}

function assertValidationWorkflowEnabled() {
  if (!env.validationWorkflowEnabled) {
    throw createHttpError(503, 'Validation approval workflow is disabled by feature flag');
  }
}

function assertPilotRegionAllowed(regionId) {
  const allowed = env.validationWorkflowAllowedRegionIds || [];
  if (!allowed.length) return;
  if (!allowed.includes(String(regionId || ''))) {
    throw createHttpError(403, 'Region is not enabled for validation workflow pilot');
  }
}

async function submitValidationRequest(req, res, next) {
  try {
    assertValidationWorkflowEnabled();
    const { actorUserId, actorRole } = getRequestContext(req);
    if (!isValidator(actorRole)) {
      throw createHttpError(403, 'Only validator can submit validation request');
    }

    const {
      entity_id: entityId,
      payload_snapshot: payloadSnapshot = {},
      evidence_attachments: evidenceAttachments = [],
      checklist = {},
      finding_note: findingNote = null,
    } = req.body || {};

    if (!entityId) {
      throw createHttpError(400, 'entity_id is required');
    }

    const device = await loadDeviceById(entityId);
    if (!device) {
      throw createHttpError(404, 'Device not found');
    }

    assertHasRegionAccess(req.auth, device.region_id);
    assertPilotRegionAllowed(device.region_id);

    const activeRequest = await loadActiveRequestByEntity(entityId);
    if (activeRequest && activeRequest.current_status === STATUS.PENDING_ASYNC) {
      throw createHttpError(
        409,
        'Validation request sedang menunggu review superadmin. Tunggu keputusan sebelum submit ulang.',
      );
    }
    if (activeRequest && activeRequest.current_status === STATUS.REJECTED_SUPERADMIN) {
      throw createHttpError(
        409,
        'Validation request ditolak superadmin. Adminregion harus review dan resubmit ke superadmin terlebih dahulu.',
      );
    }

    let request;
    let auditActionName = 'validation_request_submitted';
    let actionType = ACTION.SUBMITTED;
    let beforeStatus = STATUS.UNVALIDATED;
    let responseCode = 201;
    let message = 'Validation request submitted';

    if (activeRequest && [STATUS.ONGOING, STATUS.REJECTED_ADMINREGION].includes(activeRequest.current_status)) {
      request = await resubmitActiveRequest({
        requestId: activeRequest.id,
        submittedByUserId: actorUserId,
        nextStatus: STATUS.ONGOING,
        payloadSnapshot,
        evidenceAttachments,
        checklist,
        findingNote,
      });
      auditActionName = 'validation_request_resubmitted_by_validator';
      actionType = ACTION.RESUBMIT_VALIDATOR;
      beforeStatus = activeRequest.current_status;
      responseCode = 200;
      message = 'Validation request resubmitted';
    } else {
      request = await createRequest({
        entityId,
        regionId: device.region_id,
        submittedByUserId: actorUserId,
        payloadSnapshot,
        evidenceAttachments,
        checklist,
        findingNote,
      });
    }

    await insertRequestLog({
      requestId: request.id,
      actionType,
      actorUserId,
      actorRole,
      beforeStatus,
      afterStatus: STATUS.ONGOING,
      payloadPatch: payloadSnapshot,
    });

    await createAuditLog({
      actorUserId,
      actionName: auditActionName,
      entityType: 'validation_requests',
      entityId: request.id,
      beforeData: { status: beforeStatus },
      afterData: {
        request_id: request.request_id,
        status: STATUS.ONGOING,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] || null,
    });

    return sendSuccess(res, request, message, responseCode);
  } catch (error) {
    return next(error);
  }
}

async function listValidationRequests(req, res, next) {
  try {
    assertValidationWorkflowEnabled();
    const { actorRole, regionIds, actorUserId } = getRequestContext(req);
    const entityId = String(req.query.entity_id || '').trim();
    if (isValidator(actorRole)) {
      if (!entityId) {
        throw createHttpError(400, 'entity_id is required for validator queue');
      }
      const items = await listRequestsForValidator({
        submittedByUserId: actorUserId,
        entityId,
        regionIds,
      });
      return sendSuccess(res, items, 'Validation requests loaded');
    }

    if (entityId) {
      const items = await listRequestsByEntity({
        entityId,
        role: actorRole,
        regionIds,
      });
      return sendSuccess(res, items, 'Validation requests loaded');
    }

    const queue = String(req.query.queue || '').trim();
    if (!['adminregion', 'superadmin'].includes(queue)) {
      throw createHttpError(400, 'queue must be adminregion or superadmin');
    }

    if (queue === 'adminregion' && !isAdminRegion(actorRole)) {
      throw createHttpError(403, 'Only adminregion can access adminregion queue');
    }
    if (queue === 'superadmin' && !isSuperAdmin(actorRole)) {
      throw createHttpError(403, 'Only superadmin can access superadmin queue');
    }

    const items = await listRequestsByQueue({
      queue,
      regionIds,
    });
    return sendSuccess(res, items, 'Validation requests loaded');
  } catch (error) {
    return next(error);
  }
}

async function listValidationQualityQueue(req, res, next) {
  try {
    assertValidationWorkflowEnabled();
    const { actorRole, regionIds } = getRequestContext(req);
    if (!isAdminRegion(actorRole) && !isSuperAdmin(actorRole)) {
      throw createHttpError(403, 'Only adminregion or superadmin can access validation quality queue');
    }
    const queueKey = String(req.query.queue || '').trim();
    if (!['pending_adminregion', 'pending_superadmin', 'rejected_adminregion', 'rejected_superadmin', 'evidence_missing'].includes(queueKey)) {
      throw createHttpError(400, 'queue must be a supported quality queue');
    }
    const regionIdFilter = String(req.query.region_id || '').trim() || null;
    const items = await listQualityQueueRequests({
      queueKey,
      regionIds,
      actorRole,
      regionIdFilter,
    });
    return sendSuccess(res, items, 'Validation quality queue loaded');
  } catch (error) {
    return next(error);
  }
}

async function approveByAdminRegion(req, res, next) {
  try {
    assertValidationWorkflowEnabled();
    const { actorUserId, actorRole } = getRequestContext(req);
    if (!isAdminRegion(actorRole)) {
      throw createHttpError(403, 'Only adminregion can approve this stage');
    }

    const request = await loadRequestById(req.params.id);
    if (!request) throw createHttpError(404, 'Validation request not found');
    assertHasRegionAccess(req.auth, request.region_id);
    assertPilotRegionAllowed(request.region_id);

    if (request.current_status !== STATUS.ONGOING) {
      throw createHttpError(409, 'Request is not in ongoing_validated status');
    }

    const updated = await updateRequestStatus({
      requestId: request.id,
      nextStatus: STATUS.PENDING_ASYNC,
      approvedByUserId: actorUserId,
      rejectedByUserId: null,
    });

    await insertRequestLog({
      requestId: request.id,
      actionType: ACTION.APPROVED_ADMINREGION,
      actorUserId,
      actorRole,
      beforeStatus: STATUS.ONGOING,
      afterStatus: STATUS.PENDING_ASYNC,
    });

    await createAuditLog({
      actorUserId,
      actionName: 'validation_request_approved_by_adminregion',
      entityType: 'validation_requests',
      entityId: request.id,
      beforeData: {
        request_id: request.request_id,
        status: STATUS.ONGOING,
      },
      afterData: {
        request_id: request.request_id,
        status: STATUS.PENDING_ASYNC,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] || null,
    });

    return sendSuccess(res, updated, 'Approved by adminregion');
  } catch (error) {
    return next(error);
  }
}

async function rejectByAdminRegion(req, res, next) {
  try {
    assertValidationWorkflowEnabled();
    const { actorUserId, actorRole } = getRequestContext(req);
    if (!isAdminRegion(actorRole)) {
      throw createHttpError(403, 'Only adminregion can reject this stage');
    }

    const note = String(req.body?.note || '').trim();
    assertRejectNote(note);

    const request = await loadRequestById(req.params.id);
    if (!request) throw createHttpError(404, 'Validation request not found');
    assertHasRegionAccess(req.auth, request.region_id);
    assertPilotRegionAllowed(request.region_id);

    if (request.current_status !== STATUS.ONGOING) {
      throw createHttpError(409, 'Request is not in ongoing_validated status');
    }

    const updated = await updateRequestStatus({
      requestId: request.id,
      nextStatus: STATUS.REJECTED_ADMINREGION,
      adminregionReviewNote: note,
      rejectedByUserId: actorUserId,
      approvedByUserId: null,
    });

    await insertRequestLog({
      requestId: request.id,
      actionType: ACTION.REJECTED_ADMINREGION,
      actorUserId,
      actorRole,
      beforeStatus: STATUS.ONGOING,
      afterStatus: STATUS.REJECTED_ADMINREGION,
      note,
    });

    await createAuditLog({
      actorUserId,
      actionName: 'validation_request_rejected_by_adminregion',
      entityType: 'validation_requests',
      entityId: request.id,
      beforeData: {
        request_id: request.request_id,
        status: STATUS.ONGOING,
      },
      afterData: {
        request_id: request.request_id,
        status: STATUS.REJECTED_ADMINREGION,
        note,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] || null,
    });

    return sendSuccess(res, updated, 'Rejected by adminregion');
  } catch (error) {
    return next(error);
  }
}

async function resubmitByAdminRegion(req, res, next) {
  try {
    assertValidationWorkflowEnabled();
    const { actorUserId, actorRole } = getRequestContext(req);
    if (!isAdminRegion(actorRole)) {
      throw createHttpError(403, 'Only adminregion can resubmit this stage');
    }

    const request = await loadRequestById(req.params.id);
    if (!request) throw createHttpError(404, 'Validation request not found');
    assertHasRegionAccess(req.auth, request.region_id);
    assertPilotRegionAllowed(request.region_id);

    if (request.current_status !== STATUS.REJECTED_SUPERADMIN) {
      throw createHttpError(409, 'Request is not in rejected_by_superadmin status');
    }

    const updated = await updateRequestStatus({
      requestId: request.id,
      nextStatus: STATUS.PENDING_ASYNC,
      approvedByUserId: actorUserId,
      rejectedByUserId: null,
    });

    await insertRequestLog({
      requestId: request.id,
      actionType: ACTION.RESUBMIT_ADMINREGION,
      actorUserId,
      actorRole,
      beforeStatus: STATUS.REJECTED_SUPERADMIN,
      afterStatus: STATUS.PENDING_ASYNC,
    });

    await createAuditLog({
      actorUserId,
      actionName: 'validation_request_resubmitted_by_adminregion',
      entityType: 'validation_requests',
      entityId: request.id,
      beforeData: {
        request_id: request.request_id,
        status: STATUS.REJECTED_SUPERADMIN,
      },
      afterData: {
        request_id: request.request_id,
        status: STATUS.PENDING_ASYNC,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] || null,
    });

    return sendSuccess(res, updated, 'Resubmitted by adminregion');
  } catch (error) {
    return next(error);
  }
}

async function approveBySuperAdmin(req, res, next) {
  try {
    assertValidationWorkflowEnabled();
    const { actorUserId, actorRole } = getRequestContext(req);
    if (!isSuperAdmin(actorRole)) {
      throw createHttpError(403, 'Only superadmin can approve this stage');
    }

    const request = await loadRequestById(req.params.id);
    if (!request) throw createHttpError(404, 'Validation request not found');
    assertPilotRegionAllowed(request.region_id);

    if (request.current_status !== STATUS.PENDING_ASYNC) {
      throw createHttpError(409, 'Request is not in pending_async status');
    }

    const applyResult = await applyValidationPayloadToAsset({ request, actorUserId });

    await insertRequestLog({
      requestId: request.id,
      actionType: ACTION.APPLIED_TO_ASSET,
      actorUserId,
      actorRole,
      beforeStatus: STATUS.PENDING_ASYNC,
      afterStatus: STATUS.PENDING_ASYNC,
      payloadPatch: request.payload_snapshot || {},
    });

    await createAuditLog({
      actorUserId,
      actionName: 'validation_request_applied_to_asset',
      entityType: 'validation_requests',
      entityId: request.id,
      beforeData: applyResult.before,
      afterData: applyResult.after,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] || null,
    });

    const updated = await updateRequestStatus({
      requestId: request.id,
      nextStatus: STATUS.VALIDATED,
      approvedByUserId: actorUserId,
      rejectedByUserId: null,
    });

    await insertRequestLog({
      requestId: request.id,
      actionType: ACTION.APPROVED_SUPERADMIN,
      actorUserId,
      actorRole,
      beforeStatus: STATUS.PENDING_ASYNC,
      afterStatus: STATUS.VALIDATED,
    });

    await createAuditLog({
      actorUserId,
      actionName: 'validation_request_approved_by_superadmin',
      entityType: 'validation_requests',
      entityId: request.id,
      beforeData: {
        request_id: request.request_id,
        status: STATUS.PENDING_ASYNC,
      },
      afterData: {
        request_id: request.request_id,
        status: STATUS.VALIDATED,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] || null,
    });

    return sendSuccess(res, updated, 'Approved by superadmin');
  } catch (error) {
    return next(error);
  }
}

async function rejectBySuperAdmin(req, res, next) {
  try {
    assertValidationWorkflowEnabled();
    const { actorUserId, actorRole } = getRequestContext(req);
    if (!isSuperAdmin(actorRole)) {
      throw createHttpError(403, 'Only superadmin can reject this stage');
    }

    const note = String(req.body?.note || '').trim();
    assertRejectNote(note);

    const request = await loadRequestById(req.params.id);
    if (!request) throw createHttpError(404, 'Validation request not found');
    assertPilotRegionAllowed(request.region_id);
    if (request.current_status !== STATUS.PENDING_ASYNC) {
      throw createHttpError(409, 'Request is not in pending_async status');
    }

    const updated = await updateRequestStatus({
      requestId: request.id,
      nextStatus: STATUS.REJECTED_SUPERADMIN,
      superadminReviewNote: note,
      rejectedByUserId: actorUserId,
      approvedByUserId: null,
    });

    await insertRequestLog({
      requestId: request.id,
      actionType: ACTION.REJECTED_SUPERADMIN,
      actorUserId,
      actorRole,
      beforeStatus: STATUS.PENDING_ASYNC,
      afterStatus: STATUS.REJECTED_SUPERADMIN,
      note,
    });

    await createAuditLog({
      actorUserId,
      actionName: 'validation_request_rejected_by_superadmin',
      entityType: 'validation_requests',
      entityId: request.id,
      beforeData: {
        request_id: request.request_id,
        status: STATUS.PENDING_ASYNC,
      },
      afterData: {
        request_id: request.request_id,
        status: STATUS.REJECTED_SUPERADMIN,
        note,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] || null,
    });

    return sendSuccess(res, updated, 'Rejected by superadmin');
  } catch (error) {
    return next(error);
  }
}

async function getValidationRequestHistory(req, res, next) {
  try {
    assertValidationWorkflowEnabled();
    const { actorRole } = getRequestContext(req);
    const request = await loadRequestById(req.params.id);
    if (!request) throw createHttpError(404, 'Validation request not found');
    if (!isSuperAdmin(actorRole)) {
      assertHasRegionAccess(req.auth, request.region_id);
    }

    const logs = await listRequestHistory(request.id);
    return sendSuccess(res, {
      request,
      history: logs,
    }, 'Validation request history loaded');
  } catch (error) {
    return next(error);
  }
}

async function getRejectReasonMetrics(req, res, next) {
  try {
    assertValidationWorkflowEnabled();
    const { actorRole, regionIds } = getRequestContext(req);
    if (!isAdminRegion(actorRole) && !isSuperAdmin(actorRole)) {
      throw createHttpError(403, 'Only adminregion/superadmin can access reject reason metrics');
    }
    const limit = Number(req.query.limit || 1000);
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 5000)) : 1000;
    const report = await listRejectReasonMetrics({
      regionIds: isSuperAdmin(actorRole) ? null : regionIds,
      limit: safeLimit,
    });
    return sendSuccess(res, report, 'Reject reason metrics loaded');
  } catch (error) {
    return next(error);
  }
}

async function listValidationNotifications(req, res, next) {
  try {
    assertValidationWorkflowEnabled();
    const { actorRole, regionIds, actorUserId } = getRequestContext(req);
    if (!isAdminRegion(actorRole) && !isSuperAdmin(actorRole)) {
      throw createHttpError(403, 'Only adminregion/superadmin can access notifications');
    }

    const queue = isSuperAdmin(actorRole) ? 'superadmin' : 'adminregion';
    const limit = Number(req.query.limit || 10);
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(limit, 50)) : 10;
    const regionIdFilter = String(req.query.region_id || '').trim() || null;
    if (regionIdFilter && !isSuperAdmin(actorRole) && !regionIds.includes(regionIdFilter)) {
      throw createHttpError(403, 'Requested region filter is outside your scope');
    }
    const inbox = await listNotificationInbox({
      queue,
      regionIds,
      actorUserId,
      limit: safeLimit,
      urgentAfterHours: env.validationNotificationUrgentAfterHours,
      regionIdFilter,
    });

    return sendSuccess(res, inbox, 'Validation notifications loaded');
  } catch (error) {
    return next(error);
  }
}

async function getValidationNotificationDigest(req, res, next) {
  try {
    assertValidationWorkflowEnabled();
    const { actorRole, regionIds, actorUserId } = getRequestContext(req);
    if (!isAdminRegion(actorRole) && !isSuperAdmin(actorRole)) {
      throw createHttpError(403, 'Only adminregion/superadmin can access notifications');
    }

    const queue = isSuperAdmin(actorRole) ? 'superadmin' : 'adminregion';
    const window = String(req.query.window || 'daily').trim().toLowerCase();
    if (!['daily', 'weekly'].includes(window)) {
      throw createHttpError(400, 'window must be daily or weekly');
    }
    const regionIdFilter = String(req.query.region_id || '').trim() || null;
    if (regionIdFilter && !isSuperAdmin(actorRole) && !regionIds.includes(regionIdFilter)) {
      throw createHttpError(403, 'Requested region filter is outside your scope');
    }

    const report = await getNotificationDigest({
      queue,
      regionIds,
      actorUserId,
      window,
      urgentAfterHours: env.validationNotificationUrgentAfterHours,
      regionIdFilter,
    });
    return sendSuccess(res, report, 'Validation notification digest loaded');
  } catch (error) {
    return next(error);
  }
}

async function markValidationNotificationRead(req, res, next) {
  try {
    assertValidationWorkflowEnabled();
    const { actorRole, actorUserId } = getRequestContext(req);
    if (!isAdminRegion(actorRole) && !isSuperAdmin(actorRole)) {
      throw createHttpError(403, 'Only adminregion/superadmin can update notifications');
    }

    const request = await loadRequestById(req.params.id);
    if (!request) throw createHttpError(404, 'Validation request not found');
    if (!isSuperAdmin(actorRole)) {
      assertHasRegionAccess(req.auth, request.region_id);
    }

    const item = await markNotificationAsRead({
      requestId: request.id,
      actorUserId,
    });
    return sendSuccess(res, item, 'Notification marked as read');
  } catch (error) {
    return next(error);
  }
}

async function markAllValidationNotificationsRead(req, res, next) {
  try {
    assertValidationWorkflowEnabled();
    const { actorRole, actorUserId, regionIds } = getRequestContext(req);
    if (!isAdminRegion(actorRole) && !isSuperAdmin(actorRole)) {
      throw createHttpError(403, 'Only adminregion/superadmin can update notifications');
    }

    const queue = isSuperAdmin(actorRole) ? 'superadmin' : 'adminregion';
    const regionIdFilter = String(req.body?.region_id || '').trim() || null;
    if (regionIdFilter && !isSuperAdmin(actorRole) && !regionIds.includes(regionIdFilter)) {
      throw createHttpError(403, 'Requested region filter is outside your scope');
    }
    const result = await markAllNotificationsAsRead({
      queue,
      regionIds,
      actorUserId,
      regionIdFilter,
    });
    return sendSuccess(res, result, 'All notifications marked as read');
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  submitValidationRequest,
  listValidationRequests,
  listValidationQualityQueue,
  approveByAdminRegion,
  rejectByAdminRegion,
  resubmitByAdminRegion,
  approveBySuperAdmin,
  rejectBySuperAdmin,
  getValidationRequestHistory,
  getRejectReasonMetrics,
  listValidationNotifications,
  getValidationNotificationDigest,
  markValidationNotificationRead,
  markAllValidationNotificationsRead,
};

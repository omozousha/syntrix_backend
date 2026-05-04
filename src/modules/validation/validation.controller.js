const { sendSuccess } = require('../../utils/response');
const { createHttpError } = require('../../utils/httpError');
const { createAuditLog } = require('../../shared/audit.service');
const {
  STATUS,
  ACTION,
  normalizeRole,
  assertRejectNote,
  assertHasRegionAccess,
  loadDeviceById,
  loadRequestById,
  createRequest,
  insertRequestLog,
  listRequestsByQueue,
  listRequestsForValidator,
  updateRequestStatus,
  listRequestHistory,
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

async function submitValidationRequest(req, res, next) {
  try {
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

    const request = await createRequest({
      entityId,
      regionId: device.region_id,
      submittedByUserId: actorUserId,
      payloadSnapshot,
      evidenceAttachments,
      checklist,
      findingNote,
    });

    await insertRequestLog({
      requestId: request.id,
      actionType: ACTION.SUBMITTED,
      actorUserId,
      actorRole,
      beforeStatus: STATUS.UNVALIDATED,
      afterStatus: STATUS.ONGOING,
      payloadPatch: payloadSnapshot,
    });

    await createAuditLog({
      actorUserId,
      actionName: 'validation_request_submitted',
      entityType: 'validation_requests',
      entityId: request.id,
      beforeData: { status: STATUS.UNVALIDATED },
      afterData: {
        request_id: request.request_id,
        status: STATUS.ONGOING,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'] || null,
    });

    return sendSuccess(res, request, 'Validation request submitted', 201);
  } catch (error) {
    return next(error);
  }
}

async function listValidationRequests(req, res, next) {
  try {
    const { actorRole, regionIds, actorUserId } = getRequestContext(req);
    if (isValidator(actorRole)) {
      const entityId = String(req.query.entity_id || '').trim();
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

async function approveByAdminRegion(req, res, next) {
  try {
    const { actorUserId, actorRole } = getRequestContext(req);
    if (!isAdminRegion(actorRole)) {
      throw createHttpError(403, 'Only adminregion can approve this stage');
    }

    const request = await loadRequestById(req.params.id);
    if (!request) throw createHttpError(404, 'Validation request not found');
    assertHasRegionAccess(req.auth, request.region_id);

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
    const { actorUserId, actorRole } = getRequestContext(req);
    if (!isAdminRegion(actorRole)) {
      throw createHttpError(403, 'Only adminregion can reject this stage');
    }

    const note = String(req.body?.note || '').trim();
    assertRejectNote(note);

    const request = await loadRequestById(req.params.id);
    if (!request) throw createHttpError(404, 'Validation request not found');
    assertHasRegionAccess(req.auth, request.region_id);

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

async function approveBySuperAdmin(req, res, next) {
  try {
    const { actorUserId, actorRole } = getRequestContext(req);
    if (!isSuperAdmin(actorRole)) {
      throw createHttpError(403, 'Only superadmin can approve this stage');
    }

    const request = await loadRequestById(req.params.id);
    if (!request) throw createHttpError(404, 'Validation request not found');

    if (request.current_status !== STATUS.PENDING_ASYNC) {
      throw createHttpError(409, 'Request is not in pending_async status');
    }

    const applyResult = await applyValidationPayloadToAsset({ request });

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
    const { actorUserId, actorRole } = getRequestContext(req);
    if (!isSuperAdmin(actorRole)) {
      throw createHttpError(403, 'Only superadmin can reject this stage');
    }

    const note = String(req.body?.note || '').trim();
    assertRejectNote(note);

    const request = await loadRequestById(req.params.id);
    if (!request) throw createHttpError(404, 'Validation request not found');
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

module.exports = {
  submitValidationRequest,
  listValidationRequests,
  approveByAdminRegion,
  rejectByAdminRegion,
  approveBySuperAdmin,
  rejectBySuperAdmin,
  getValidationRequestHistory,
};

const { executeHasura } = require('../../config/hasura');
const { createHttpError } = require('../../utils/httpError');

const STATUS = {
  UNVALIDATED: 'unvalidated',
  ONGOING: 'ongoing_validated',
  PENDING_ASYNC: 'pending_async',
  VALIDATED: 'validated',
  REJECTED_ADMINREGION: 'rejected_by_adminregion',
  REJECTED_SUPERADMIN: 'rejected_by_superadmin',
};

const ACTION = {
  SUBMITTED: 'submitted',
  RESUBMIT_VALIDATOR: 'resubmitted_by_validator',
  APPROVED_ADMINREGION: 'approved_by_adminregion',
  REJECTED_ADMINREGION: 'rejected_by_adminregion',
  APPROVED_SUPERADMIN: 'approved_by_superadmin',
  REJECTED_SUPERADMIN: 'rejected_by_superadmin',
  RESUBMIT_ADMINREGION: 'resubmitted_by_adminregion',
};

function normalizeRole(role) {
  if (role === 'admin') return 'superadmin';
  if (role === 'user_all_region') return 'adminregion';
  if (role === 'user_region') return 'validator';
  return role;
}

function assertRejectNote(note) {
  if (!note || String(note).trim().length < 10) {
    throw createHttpError(400, 'reject note is required and must be at least 10 characters');
  }
}

function assertHasRegionAccess(auth, regionId) {
  const role = normalizeRole(auth.role);
  if (role === 'superadmin') return;
  if (!auth.regions?.includes(regionId)) {
    throw createHttpError(403, 'You do not have access to this region');
  }
}

async function loadDeviceById(deviceId) {
  const query = `
    query LoadDeviceById($id: uuid!) {
      item: devices_by_pk(id: $id) {
        id
        region_id
        validation_status
      }
    }
  `;
  const data = await executeHasura(query, { id: deviceId });
  return data.item || null;
}

async function loadRequestById(requestId) {
  const query = `
    query LoadValidationRequestById($id: uuid!) {
      item: validation_requests_by_pk(id: $id) {
        id
        request_id
        entity_type
        entity_id
        region_id
        submitted_by_user_id
        current_status
        payload_snapshot
        evidence_attachments
        checklist
        finding_note
        adminregion_review_note
        superadmin_review_note
        approved_by_user_id
        approved_at
        rejected_by_user_id
        rejected_at
        created_at
        updated_at
      }
    }
  `;
  const data = await executeHasura(query, { id: requestId });
  return data.item || null;
}

async function createRequest({
  entityId,
  regionId,
  submittedByUserId,
  payloadSnapshot = {},
  evidenceAttachments = [],
  checklist = {},
  findingNote = null,
}) {
  const mutation = `
    mutation CreateValidationRequest($object: validation_requests_insert_input!) {
      item: insert_validation_requests_one(object: $object) {
        id
        request_id
        entity_type
        entity_id
        region_id
        submitted_by_user_id
        current_status
        payload_snapshot
        evidence_attachments
        checklist
        finding_note
        created_at
        updated_at
      }
    }
  `;
  const data = await executeHasura(mutation, {
    object: {
      entity_type: 'device',
      entity_id: entityId,
      region_id: regionId,
      submitted_by_user_id: submittedByUserId,
      current_status: STATUS.ONGOING,
      payload_snapshot: payloadSnapshot,
      evidence_attachments: evidenceAttachments,
      checklist,
      finding_note: findingNote,
    },
  });
  return data.item;
}

async function insertRequestLog({ requestId, actionType, actorUserId, actorRole, beforeStatus, afterStatus, note = null, payloadPatch = {} }) {
  const mutation = `
    mutation InsertValidationRequestLog($object: validation_request_logs_insert_input!) {
      item: insert_validation_request_logs_one(object: $object) {
        id
      }
    }
  `;
  await executeHasura(mutation, {
    object: {
      request_id: requestId,
      action_type: actionType,
      actor_user_id: actorUserId,
      actor_role: actorRole,
      before_status: beforeStatus,
      after_status: afterStatus,
      note,
      payload_patch: payloadPatch,
    },
  });
}

async function listRequestsByQueue({ queue, regionIds }) {
  const where = queue === 'superadmin'
    ? 'current_status: { _eq: "pending_async" }'
    : 'current_status: { _eq: "ongoing_validated" }';
  const regionFilter = queue === 'superadmin'
    ? ''
    : 'region_id: { _in: $regionIds }';
  const andFilter = regionFilter ? `, ${regionFilter}` : '';

  const query = `
    query ListValidationRequests($regionIds: [uuid!]) {
      items: validation_requests(
        where: { ${where}${andFilter} }
        order_by: [{ updated_at: desc }]
      ) {
        id
        request_id
        entity_type
        entity_id
        region_id
        submitted_by_user_id
        current_status
        payload_snapshot
        evidence_attachments
        checklist
        finding_note
        adminregion_review_note
        superadmin_review_note
        created_at
        updated_at
      }
    }
  `;
  const data = await executeHasura(query, { regionIds });
  return data.items || [];
}

async function updateRequestStatus({
  requestId,
  nextStatus,
  adminregionReviewNote,
  superadminReviewNote,
  approvedByUserId,
  rejectedByUserId,
}) {
  const setObj = {
    current_status: nextStatus,
  };
  if (adminregionReviewNote !== undefined) setObj.adminregion_review_note = adminregionReviewNote;
  if (superadminReviewNote !== undefined) setObj.superadmin_review_note = superadminReviewNote;
  if (approvedByUserId !== undefined) setObj.approved_by_user_id = approvedByUserId;
  if (rejectedByUserId !== undefined) setObj.rejected_by_user_id = rejectedByUserId;
  if (nextStatus === STATUS.VALIDATED || nextStatus === STATUS.PENDING_ASYNC) setObj.approved_at = 'now()';
  if (nextStatus === STATUS.REJECTED_ADMINREGION || nextStatus === STATUS.REJECTED_SUPERADMIN) setObj.rejected_at = 'now()';

  const mutation = `
    mutation UpdateValidationRequestStatus($id: uuid!, $set: validation_requests_set_input!) {
      item: update_validation_requests_by_pk(pk_columns: { id: $id }, _set: $set) {
        id
        request_id
        entity_type
        entity_id
        region_id
        submitted_by_user_id
        current_status
        payload_snapshot
        evidence_attachments
        checklist
        finding_note
        adminregion_review_note
        superadmin_review_note
        approved_by_user_id
        approved_at
        rejected_by_user_id
        rejected_at
        created_at
        updated_at
      }
    }
  `;

  const setForHasura = { ...setObj };
  delete setForHasura.approved_at;
  delete setForHasura.rejected_at;

  if (setObj.approved_at === 'now()') setForHasura.approved_at = new Date().toISOString();
  if (setObj.rejected_at === 'now()') setForHasura.rejected_at = new Date().toISOString();

  const data = await executeHasura(mutation, { id: requestId, set: setForHasura });
  return data.item;
}

async function listRequestHistory(requestId) {
  const query = `
    query ListValidationRequestHistory($requestId: uuid!) {
      items: validation_request_logs(
        where: { request_id: { _eq: $requestId } }
        order_by: [{ created_at: asc }]
      ) {
        id
        action_type
        actor_user_id
        actor_role
        before_status
        after_status
        note
        payload_patch
        created_at
      }
    }
  `;
  const data = await executeHasura(query, { requestId });
  return data.items || [];
}

module.exports = {
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
  updateRequestStatus,
  listRequestHistory,
};


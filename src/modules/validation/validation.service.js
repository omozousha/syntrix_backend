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
  APPLIED_TO_ASSET: 'applied_to_asset',
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
  const fields = `
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
  `;

  if (queue === 'superadmin') {
    const query = `
      query ListValidationRequestsSuperadmin {
        items: validation_requests(
          where: { current_status: { _eq: "pending_async" } }
          order_by: [{ updated_at: desc }]
        ) {
          ${fields}
        }
      }
    `;
    const data = await executeHasura(query, {});
    return data.items || [];
  }

  const query = `
    query ListValidationRequestsAdminregion($regionIds: [uuid!]) {
      items: validation_requests(
        where: {
          current_status: { _eq: "ongoing_validated" }
          region_id: { _in: $regionIds }
        }
        order_by: [{ updated_at: desc }]
      ) {
        ${fields}
      }
    }
  `;
  const data = await executeHasura(query, { regionIds });
  return data.items || [];
}

async function listRequestsForValidator({ submittedByUserId, entityId, regionIds }) {
  const query = `
    query ListValidationRequestsForValidator($submittedByUserId: uuid!, $entityId: uuid!, $regionIds: [uuid!]) {
      items: validation_requests(
        where: {
          submitted_by_user_id: { _eq: $submittedByUserId }
          entity_id: { _eq: $entityId }
          region_id: { _in: $regionIds }
        }
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
  const data = await executeHasura(query, { submittedByUserId, entityId, regionIds });
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

async function listRejectReasonMetrics({ regionIds = null, limit = 1000 } = {}) {
  const isRegionScoped = Array.isArray(regionIds) && regionIds.length > 0;
  const query = isRegionScoped
    ? `
      query ListRejectReasonsScoped($regionIds: [uuid!], $limit: Int!) {
        items: validation_requests(
          where: {
            current_status: { _in: ["rejected_by_adminregion", "rejected_by_superadmin"] }
            region_id: { _in: $regionIds }
          }
          order_by: [{ updated_at: desc }]
          limit: $limit
        ) {
          id
          request_id
          region_id
          current_status
          adminregion_review_note
          superadmin_review_note
          updated_at
        }
      }
    `
    : `
      query ListRejectReasonsGlobal($limit: Int!) {
        items: validation_requests(
          where: {
            current_status: { _in: ["rejected_by_adminregion", "rejected_by_superadmin"] }
          }
          order_by: [{ updated_at: desc }]
          limit: $limit
        ) {
          id
          request_id
          region_id
          current_status
          adminregion_review_note
          superadmin_review_note
          updated_at
        }
      }
    `;

  const variables = isRegionScoped ? { regionIds, limit } : { limit };
  const data = await executeHasura(query, variables);
  const rows = data.items || [];
  const buckets = new Map();

  for (const row of rows) {
    const note = String(
      row.current_status === STATUS.REJECTED_ADMINREGION
        ? row.adminregion_review_note || ''
        : row.superadmin_review_note || '',
    )
      .trim()
      .toLowerCase();
    if (!note) continue;
    const key = note;
    if (!buckets.has(key)) {
      buckets.set(key, {
        reason: note,
        count: 0,
        by_status: {
          rejected_by_adminregion: 0,
          rejected_by_superadmin: 0,
        },
      });
    }
    const bucket = buckets.get(key);
    bucket.count += 1;
    if (row.current_status === STATUS.REJECTED_ADMINREGION) bucket.by_status.rejected_by_adminregion += 1;
    if (row.current_status === STATUS.REJECTED_SUPERADMIN) bucket.by_status.rejected_by_superadmin += 1;
  }

  const top_reasons = Array.from(buckets.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  return {
    total_rejected: rows.length,
    distinct_reason_count: buckets.size,
    top_reasons,
  };
}

function pickObject(source, keys) {
  return keys.reduce((acc, key) => {
    if (source[key] !== undefined) {
      acc[key] = source[key];
    }
    return acc;
  }, {});
}

async function loadDeviceSnapshot(deviceId) {
  const query = `
    query LoadDeviceSnapshot($deviceId: uuid!) {
      device: devices_by_pk(id: $deviceId) {
        id
        device_name
        status
        validation_status
        validation_date
        splitter_ratio
        total_ports
        used_ports
        address
        longitude
        latitude
        updated_at
      }
      ports: device_ports(
        where: {
          device_id: { _eq: $deviceId }
          deleted_at: { _is_null: true }
        }
        order_by: [{ port_index: asc }]
      ) {
        id
        port_index
        port_label
        status
        customer_id
        ont_device_id
        notes
        updated_at
      }
    }
  `;
  const data = await executeHasura(query, { deviceId });
  return {
    device: data.device || null,
    ports: data.ports || [],
  };
}

async function updateDeviceById(deviceId, changes) {
  const mutation = `
    mutation UpdateDeviceById($id: uuid!, $changes: devices_set_input!) {
      item: update_devices_by_pk(pk_columns: { id: $id }, _set: $changes) {
        id
      }
    }
  `;
  const data = await executeHasura(mutation, { id: deviceId, changes });
  return data.item;
}

async function updateDevicePortById(portId, changes) {
  const mutation = `
    mutation UpdateDevicePortById($id: uuid!, $changes: device_ports_set_input!) {
      item: update_device_ports_by_pk(pk_columns: { id: $id }, _set: $changes) {
        id
      }
    }
  `;
  const data = await executeHasura(mutation, { id: portId, changes });
  return data.item;
}

async function applyValidationPayloadToAsset({ request }) {
  const payload = request.payload_snapshot || {};
  const payloadDevice = payload.device || {};
  const payloadPorts = Array.isArray(payload.device_ports) ? payload.device_ports : [];

  const before = await loadDeviceSnapshot(request.entity_id);
  if (!before.device) {
    throw createHttpError(404, 'Target device for apply not found');
  }

  const currentPortMap = new Map(before.ports.map((port) => [String(port.id), port]));

  const deviceChanges = pickObject(payloadDevice, [
    'device_name',
    'status',
    'splitter_ratio',
    'total_ports',
    'used_ports',
    'address',
    'longitude',
    'latitude',
  ]);
  // `validation_requests.current_status` uses `validated`,
  // while `devices.validation_status` still uses legacy enum (`valid|warning|invalid|unvalidated`).
  deviceChanges.validation_status = 'valid';
  deviceChanges.validation_date = new Date().toISOString().slice(0, 10);

  const changedPorts = [];
  try {
    if (Object.keys(deviceChanges).length > 0) {
      await updateDeviceById(request.entity_id, deviceChanges);
    }

    for (const portPatch of payloadPorts) {
      const portId = String(portPatch.id || '').trim();
      if (!portId || !currentPortMap.has(portId)) continue;
      const changes = pickObject(portPatch, ['port_label', 'status', 'customer_id', 'ont_device_id', 'notes']);
      if (!Object.keys(changes).length) continue;
      await updateDevicePortById(portId, changes);
      changedPorts.push(portId);
    }
  } catch (error) {
    // rollback best effort
    try {
      const rollbackDevice = pickObject(before.device, [
        'device_name',
        'status',
        'validation_status',
        'validation_date',
        'splitter_ratio',
        'total_ports',
        'used_ports',
        'address',
        'longitude',
        'latitude',
      ]);
      await updateDeviceById(request.entity_id, rollbackDevice);

      for (const portId of changedPorts) {
        const oldPort = currentPortMap.get(portId);
        if (!oldPort) continue;
        const rollbackPort = pickObject(oldPort, ['port_label', 'status', 'customer_id', 'ont_device_id', 'notes']);
        await updateDevicePortById(portId, rollbackPort);
      }
    } catch (_rollbackError) {
      // swallow rollback error; original error is more important
    }
    throw error;
  }

  const after = await loadDeviceSnapshot(request.entity_id);
  return { before, after };
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
  listRequestsForValidator,
  updateRequestStatus,
  listRequestHistory,
  listRejectReasonMetrics,
  applyValidationPayloadToAsset,
};

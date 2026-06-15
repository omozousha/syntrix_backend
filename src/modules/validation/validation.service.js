const { executeHasura, executeHasuraSql } = require('../../config/hasura');
const { createHttpError } = require('../../utils/httpError');
const {
  createResource,
  deleteResource,
  getResourceById,
  updateResource,
} = require('../../shared/resource.service');
const { RESOURCE_CONFIG } = require('../resource/resource.registry');
const { validateFiberCoreRangeForConnection } = require('../device/fiber-core-policy.service');

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

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'null';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function parseRunSqlRows(response) {
  const result = response?.result || [];
  const [headers = [], ...rows] = result;
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index]])));
}

function parseJsonColumn(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function attachmentKey(attachment) {
  if (typeof attachment === 'string') return attachment.trim();
  if (!attachment || typeof attachment !== 'object') return '';
  return String(attachment.id || attachment.attachment_id || attachment.file_id || '').trim();
}

function collectInspectionAttachments(fieldInspection) {
  const refs = [];
  if (!fieldInspection || typeof fieldInspection !== 'object') return refs;

  ['initial_photos', 'condition_checks'].forEach((groupKey) => {
    const group = fieldInspection[groupKey];
    if (!group || typeof group !== 'object') return;

    Object.values(group).forEach((item) => {
      if (!item || typeof item !== 'object' || !item.attachment) return;
      refs.push(item.attachment);
    });
  });

  return refs;
}

function collectApprovedValidationAttachments(request) {
  const payload = request.payload_snapshot || {};
  return [
    ...(Array.isArray(request.evidence_attachments) ? request.evidence_attachments : []),
    ...collectInspectionAttachments(payload.field_inspection),
  ];
}

function mergeAttachmentRefs(...attachmentGroups) {
  const merged = [];
  const seen = new Set();

  attachmentGroups.flat().forEach((attachment) => {
    const key = attachmentKey(attachment);
    if (!key || seen.has(key)) return;
    seen.add(key);
    merged.push(attachment);
  });

  return merged;
}

async function loadSubmitterMap(userIds) {
  const ids = Array.from(new Set((userIds || []).filter(Boolean)));
  if (!ids.length) return new Map();
  const query = `
    query LoadValidationRequestSubmitters($ids: [uuid!]!) {
      items: app_users(where: { id: { _in: $ids } }) {
        id
        user_code
        full_name
        email
      }
    }
  `;
  const data = await executeHasura(query, { ids });
  return new Map((data.items || []).map((item) => [item.id, item]));
}

function toActorDisplay(user) {
  if (!user) return { name: null, email: null, user_code: null };
  return {
    name: user.full_name || user.email || user.user_code || null,
    email: user.email || null,
    user_code: user.user_code || null,
  };
}

async function loadRequestActorTimelineMap(requestIds) {
  const ids = Array.from(new Set((requestIds || []).filter(Boolean)));
  if (!ids.length) return new Map();

  const sql = `
    select
      l.request_id::text,
      l.action_type,
      l.actor_user_id::text,
      l.actor_role,
      l.before_status,
      l.after_status,
      l.note,
      l.created_at,
      au.full_name as actor_name,
      au.email as actor_email,
      au.user_code as actor_user_code
    from public.validation_request_logs l
    left join public.app_users au on au.id = l.actor_user_id
    where l.request_id in (${ids.map((id) => `${sqlLiteral(id)}::uuid`).join(', ')})
    order by l.created_at asc;
  `;
  const rows = parseRunSqlRows(await executeHasuraSql(sql));
  const timelineMap = new Map();
  rows.forEach((row) => {
    const timeline = timelineMap.get(row.request_id) || [];
    timeline.push({
      action_type: row.action_type,
      actor_user_id: row.actor_user_id || null,
      actor_role: normalizeRole(row.actor_role),
      actor_name: row.actor_name || row.actor_email || row.actor_user_code || null,
      actor_email: row.actor_email || null,
      actor_user_code: row.actor_user_code || null,
      before_status: row.before_status || null,
      after_status: row.after_status || null,
      note: row.note || null,
      created_at: row.created_at || null,
    });
    timelineMap.set(row.request_id, timeline);
  });
  return timelineMap;
}

function latestTimelineAction(timeline, actionTypes) {
  return [...(timeline || [])].reverse().find((item) => actionTypes.includes(item.action_type)) || null;
}

async function enrichRequestsWithActors(items) {
  const submitterMap = await loadSubmitterMap((items || []).map((item) => item.submitted_by_user_id));
  const timelineMap = await loadRequestActorTimelineMap((items || []).map((item) => item.id));
  return (items || []).map((item) => {
    const submitter = submitterMap.get(item.submitted_by_user_id);
    const submitterActor = toActorDisplay(submitter);
    const actorTimeline = timelineMap.get(item.id) || [];
    const adminregionActor = latestTimelineAction(actorTimeline, [
      ACTION.APPROVED_ADMINREGION,
      ACTION.REJECTED_ADMINREGION,
      ACTION.RESUBMIT_ADMINREGION,
    ]);
    const superadminActor = latestTimelineAction(actorTimeline, [
      ACTION.APPROVED_SUPERADMIN,
      ACTION.REJECTED_SUPERADMIN,
    ]);
    return {
      ...item,
      submitted_by_name: submitterActor.name,
      submitted_by_email: submitterActor.email,
      submitted_by_user_code: submitterActor.user_code,
      adminregion_actor_name: adminregionActor?.actor_name || null,
      adminregion_actor_email: adminregionActor?.actor_email || null,
      adminregion_actor_user_code: adminregionActor?.actor_user_code || null,
      adminregion_action_at: adminregionActor?.created_at || null,
      adminregion_action_type: adminregionActor?.action_type || null,
      superadmin_actor_name: superadminActor?.actor_name || null,
      superadmin_actor_email: superadminActor?.actor_email || null,
      superadmin_actor_user_code: superadminActor?.actor_user_code || null,
      superadmin_action_at: superadminActor?.created_at || null,
      superadmin_action_type: superadminActor?.action_type || null,
      actor_timeline: actorTimeline,
    };
  });
}

const enrichRequestsWithSubmitters = enrichRequestsWithActors;

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

async function loadActiveRequestByEntity(entityId) {
  const query = `
    query LoadActiveValidationRequestByEntity($entityId: uuid!) {
      items: validation_requests(
        where: {
          entity_type: { _eq: "device" }
          entity_id: { _eq: $entityId }
          current_status: { _in: ["ongoing_validated", "pending_async", "rejected_by_adminregion", "rejected_by_superadmin"] }
        }
        order_by: [{ updated_at: desc }]
        limit: 1
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
        approved_by_user_id
        approved_at
        rejected_by_user_id
        rejected_at
        created_at
        updated_at
      }
    }
  `;
  const data = await executeHasura(query, { entityId });
  return data.items?.[0] || null;
}

async function createRequest({
  entityType = 'device',
  entityId,
  regionId,
  submittedByUserId,
  currentStatus = STATUS.ONGOING,
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
      entity_type: entityType,
      entity_id: entityId,
      region_id: regionId,
      submitted_by_user_id: submittedByUserId,
      current_status: currentStatus,
      payload_snapshot: payloadSnapshot,
      evidence_attachments: evidenceAttachments,
      checklist,
      finding_note: findingNote,
    },
  });
  return data.item;
}

async function resubmitActiveRequest({
  requestId,
  submittedByUserId,
  nextStatus = STATUS.ONGOING,
  payloadSnapshot = {},
  evidenceAttachments = [],
  checklist = {},
  findingNote = null,
}) {
  const mutation = `
    mutation ResubmitActiveValidationRequest($id: uuid!, $set: validation_requests_set_input!) {
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
  const data = await executeHasura(mutation, {
    id: requestId,
    set: {
      submitted_by_user_id: submittedByUserId,
      current_status: nextStatus,
      payload_snapshot: payloadSnapshot,
      evidence_attachments: evidenceAttachments,
      checklist,
      finding_note: findingNote,
      approved_by_user_id: null,
      approved_at: null,
      rejected_by_user_id: null,
      rejected_at: null,
    },
  });
  return data.item || null;
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

async function listRequestsByQueue({ queue, regionIds, regionIdFilter = null }) {
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
    const query = regionIdFilter
      ? `
        query ListValidationRequestsSuperadmin($regionIdFilter: uuid!) {
          items: validation_requests(
            where: { current_status: { _eq: "pending_async" }, region_id: { _eq: $regionIdFilter } }
            order_by: [{ updated_at: desc }]
          ) {
            ${fields}
          }
        }
      `
      : `
        query ListValidationRequestsSuperadmin {
          items: validation_requests(
            where: { current_status: { _eq: "pending_async" } }
            order_by: [{ updated_at: desc }]
          ) {
            ${fields}
          }
        }
      `;
    const variables = regionIdFilter ? { regionIdFilter } : {};
    const data = await executeHasura(query, variables);
    return enrichRequestsWithSubmitters(data.items || []);
  }

  const query = regionIdFilter
    ? `
      query ListValidationRequestsAdminregion($regionIds: [uuid!], $regionIdFilter: uuid!) {
        items: validation_requests(
          where: {
            current_status: { _in: ["ongoing_validated", "rejected_by_superadmin"] }
            region_id: { _in: $regionIds }
            _and: [{ region_id: { _eq: $regionIdFilter } }]
          }
          order_by: [{ updated_at: desc }]
        ) {
          ${fields}
        }
      }
    `
    : `
      query ListValidationRequestsAdminregion($regionIds: [uuid!]) {
        items: validation_requests(
          where: {
            current_status: { _in: ["ongoing_validated", "rejected_by_superadmin"] }
            region_id: { _in: $regionIds }
          }
          order_by: [{ updated_at: desc }]
        ) {
          ${fields}
        }
      }
    `;
  const variables = regionIdFilter ? { regionIds, regionIdFilter } : { regionIds };
  const data = await executeHasura(query, variables);
  return enrichRequestsWithSubmitters(data.items || []);
}

async function listQualityQueueRequests({ queueKey, regionIds, actorRole, regionIdFilter = null }) {
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

  const statusMap = {
    pending_adminregion: ['ongoing_validated'],
    pending_superadmin: ['pending_async'],
    rejected_adminregion: ['rejected_by_adminregion'],
    rejected_superadmin: ['rejected_by_superadmin'],
    evidence_missing: ['ongoing_validated', 'pending_async', 'rejected_by_adminregion', 'rejected_by_superadmin'],
  };
  const statuses = statusMap[queueKey];
  if (!statuses) return [];

  const regionClause = actorRole === 'superadmin'
    ? (regionIdFilter ? 'region_id: { _eq: $regionIdFilter }' : '')
    : regionIdFilter
      ? 'region_id: { _in: $regionIds }, _and: [{ region_id: { _eq: $regionIdFilter } }]'
      : 'region_id: { _in: $regionIds }';

  const whereLines = [
    `current_status: { _in: $statuses }`,
    ...(regionClause ? [regionClause] : []),
  ];

  const variableDefs = [
    '$statuses: [String!]',
    ...(actorRole === 'superadmin' ? [] : ['$regionIds: [uuid!]']),
    ...(regionIdFilter ? ['$regionIdFilter: uuid!'] : []),
  ];
  const query = `
    query ListValidationQualityQueue(${variableDefs.join(', ')}) {
      items: validation_requests(
        where: {
          ${whereLines.join('\n          ')}
        }
        order_by: [{ updated_at: desc }]
      ) {
        ${fields}
      }
    }
  `;
  const variables = {
    statuses,
    ...(actorRole === 'superadmin' ? {} : { regionIds }),
    ...(regionIdFilter ? { regionIdFilter } : {}),
  };
  const data = await executeHasura(query, variables);
  const items = data.items || [];
  const filteredItems = queueKey !== 'evidence_missing'
    ? items
    : items.filter((item) => !Array.isArray(item.evidence_attachments) || item.evidence_attachments.length === 0);
  return enrichRequestsWithActors(filteredItems);
}

async function listRequestsForNotificationInbox({ queue, regionIds, regionIdFilter = null }) {
  if (queue === 'superadmin') {
    return listRequestsByQueue({ queue, regionIds, regionIdFilter });
  }

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

  const query = regionIdFilter
    ? `
      query ListValidationNotificationsAdminregion($regionIds: [uuid!], $regionIdFilter: uuid!) {
        items: validation_requests(
          where: {
            current_status: { _in: ["ongoing_validated", "validated", "rejected_by_superadmin"] }
            region_id: { _in: $regionIds }
            _and: [{ region_id: { _eq: $regionIdFilter } }]
          }
          order_by: [{ updated_at: desc }]
        ) {
          ${fields}
        }
      }
    `
    : `
      query ListValidationNotificationsAdminregion($regionIds: [uuid!]) {
        items: validation_requests(
          where: {
            current_status: { _in: ["ongoing_validated", "validated", "rejected_by_superadmin"] }
            region_id: { _in: $regionIds }
          }
          order_by: [{ updated_at: desc }]
        ) {
          ${fields}
        }
      }
    `;
  const variables = regionIdFilter ? { regionIds, regionIdFilter } : { regionIds };
  const data = await executeHasura(query, variables);
  return enrichRequestsWithActors(data.items || []);
}

async function listRequestsForValidator({ submittedByUserId, entityId, regionIds }) {
  const query = `
    query ListValidationRequestsForValidator($submittedByUserId: uuid!, $entityId: uuid!, $regionIds: [uuid!]) {
      items: validation_requests(
        where: {
          entity_id: { _eq: $entityId }
          region_id: { _in: $regionIds }
          _or: [
            { submitted_by_user_id: { _eq: $submittedByUserId } }
            { current_status: { _eq: "validated" } }
          ]
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
  return enrichRequestsWithActors(data.items || []);
}

async function listValidatorValidationHistory({ validatorUserId, regionIds, limit = 30, offset = 0 }) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 30, 100));
  const safeOffset = Math.max(0, Number(offset) || 0);
  const regionFilter = Array.isArray(regionIds) && regionIds.length
    ? `and vr.region_id in (${regionIds.map((id) => `${sqlLiteral(id)}::uuid`).join(', ')})`
    : '';

  const sql = `
    with scoped_requests as (
      select
        vr.id,
        vr.request_id,
        vr.entity_type,
        vr.entity_id,
        vr.region_id,
        vr.submitted_by_user_id,
        vr.current_status,
        vr.payload_snapshot,
        vr.evidence_attachments,
        vr.checklist,
        vr.finding_note,
        vr.adminregion_review_note,
        vr.superadmin_review_note,
        vr.approved_at,
        vr.rejected_at,
        vr.created_at,
        vr.updated_at,
        d.device_id,
        d.device_code,
        d.device_name,
        d.device_type_key,
        d.asset_group,
        d.serial_number,
        d.total_ports,
        d.used_ports,
        d.validation_status as device_validation_status,
        d.validation_date as device_validation_date,
        d.last_validation_at,
        d.pop_id,
        p.pop_name,
        p.pop_code,
        r.region_name,
        count(*) over()::int as total_count
      from public.validation_requests vr
      left join public.devices d on d.id = vr.entity_id
      left join public.pops p on p.id = d.pop_id
      left join public.regions r on r.id = vr.region_id
      where vr.submitted_by_user_id = ${sqlLiteral(validatorUserId)}::uuid
        ${regionFilter}
      order by vr.updated_at desc
      limit ${safeLimit}
      offset ${safeOffset}
    )
    select
      id::text,
      request_id,
      entity_type,
      entity_id::text,
      region_id::text,
      submitted_by_user_id::text,
      current_status,
      payload_snapshot::text,
      evidence_attachments::text,
      checklist::text,
      finding_note,
      adminregion_review_note,
      superadmin_review_note,
      approved_at,
      rejected_at,
      created_at,
      updated_at,
      device_id,
      device_code,
      device_name,
      device_type_key,
      asset_group,
      serial_number,
      total_ports,
      used_ports,
      device_validation_status,
      device_validation_date,
      last_validation_at,
      pop_id::text,
      pop_name,
      pop_code,
      region_name,
      total_count,
      coalesce(jsonb_array_length(evidence_attachments), 0)::int as evidence_count
    from scoped_requests;
  `;

  const response = await executeHasuraSql(sql);
  const rows = parseRunSqlRows(response);
  const items = rows.map((row) => ({
    id: row.id,
    request_id: row.request_id,
    entity_type: row.entity_type,
    entity_id: row.entity_id,
    region_id: row.region_id,
    submitted_by_user_id: row.submitted_by_user_id,
    current_status: row.current_status,
    payload_snapshot: parseJsonColumn(row.payload_snapshot, {}),
    evidence_attachments: parseJsonColumn(row.evidence_attachments, []),
    checklist: parseJsonColumn(row.checklist, {}),
    finding_note: row.finding_note || null,
    adminregion_review_note: row.adminregion_review_note || null,
    superadmin_review_note: row.superadmin_review_note || null,
    approved_at: row.approved_at || null,
    rejected_at: row.rejected_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    submitted_at: row.created_at,
    evidence_count: Number(row.evidence_count || 0),
    device: {
      id: row.entity_id,
      device_id: row.device_id || null,
      device_code: row.device_code || null,
      device_name: row.device_name || null,
      device_type_key: row.device_type_key || null,
      asset_group: row.asset_group || null,
      serial_number: row.serial_number || null,
      total_ports: row.total_ports === null || row.total_ports === undefined ? null : Number(row.total_ports),
      used_ports: row.used_ports === null || row.used_ports === undefined ? null : Number(row.used_ports),
      validation_status: row.device_validation_status || null,
      validation_date: row.device_validation_date || null,
      last_validation_at: row.last_validation_at || null,
      pop_id: row.pop_id || null,
      region_id: row.region_id || null,
    },
    pop: {
      id: row.pop_id || null,
      pop_name: row.pop_name || null,
      pop_code: row.pop_code || null,
    },
    region: {
      id: row.region_id || null,
      region_name: row.region_name || null,
    },
  }));

  const enrichedItems = await enrichRequestsWithActors(items);
  const total = Number(rows[0]?.total_count || 0);
  const summarySql = `
    select
      count(*)::int as submitted_total,
      count(*) filter (where current_status = 'ongoing_validated')::int as pending_adminregion_total,
      count(*) filter (where current_status = 'pending_async')::int as pending_superadmin_total,
      count(*) filter (where current_status in ('rejected_by_adminregion', 'rejected_by_superadmin'))::int as rejected_total,
      count(*) filter (where current_status = 'validated')::int as approved_total,
      max(created_at) as last_submitted_at
    from public.validation_requests vr
    where vr.submitted_by_user_id = ${sqlLiteral(validatorUserId)}::uuid
      ${regionFilter};
  `;
  const summaryRows = parseRunSqlRows(await executeHasuraSql(summarySql));
  const summaryRow = summaryRows[0] || {};

  return {
    summary: {
      submitted_total: Number(summaryRow.submitted_total || 0),
      pending_adminregion_total: Number(summaryRow.pending_adminregion_total || 0),
      pending_superadmin_total: Number(summaryRow.pending_superadmin_total || 0),
      rejected_total: Number(summaryRow.rejected_total || 0),
      approved_total: Number(summaryRow.approved_total || 0),
      last_submitted_at: summaryRow.last_submitted_at || null,
    },
    items: enrichedItems,
    meta: {
      total,
      limit: safeLimit,
      offset: safeOffset,
    },
  };
}

async function listRequestsByEntity({ entityId, role, regionIds }) {
  const whereParts = ['entity_id: { _eq: $entityId }'];
  if (role !== 'superadmin') {
    whereParts.push('region_id: { _in: $regionIds }');
  }

  const query = `
    query ListValidationRequestsByEntity($entityId: uuid!, $regionIds: [uuid!]) {
      items: validation_requests(
        where: { ${whereParts.join('\n')} }
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
  const variables = role === 'superadmin' ? { entityId } : { entityId, regionIds };
  const data = await executeHasura(query, variables);
  return enrichRequestsWithActors(data.items || []);
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
  if (nextStatus === STATUS.ONGOING || nextStatus === STATUS.PENDING_ASYNC) setObj.rejected_at = null;

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
  const sql = `
    select
      l.id::text,
      l.action_type,
      l.actor_user_id::text,
      l.actor_role,
      l.before_status,
      l.after_status,
      l.note,
      l.payload_patch::text,
      l.created_at,
      au.full_name as actor_name,
      au.email as actor_email,
      au.user_code as actor_user_code
    from public.validation_request_logs l
    left join public.app_users au on au.id = l.actor_user_id
    where l.request_id = ${sqlLiteral(requestId)}::uuid
    order by l.created_at asc;
  `;
  const rows = parseRunSqlRows(await executeHasuraSql(sql));
  return rows.map((row) => ({
    id: row.id,
    action_type: row.action_type,
    actor_user_id: row.actor_user_id || null,
    actor_role: normalizeRole(row.actor_role),
    actor_name: row.actor_name || row.actor_email || row.actor_user_code || null,
    actor_email: row.actor_email || null,
    actor_user_code: row.actor_user_code || null,
    before_status: row.before_status || null,
    after_status: row.after_status || null,
    note: row.note || null,
    payload_patch: parseJsonColumn(row.payload_patch, {}),
    created_at: row.created_at || null,
  }));
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

async function listNotificationInbox({ queue, regionIds, actorUserId, limit = 10, urgentAfterHours = 8, regionIdFilter = null }) {
  const rows = await listRequestsForNotificationInbox({ queue, regionIds, regionIdFilter });
  const capped = rows.slice(0, Math.max(1, Math.min(limit, 50)));
  if (!capped.length) {
    return {
      unread_count: 0,
      items: [],
    };
  }

  const requestIds = capped.map((row) => row.id);
  const query = `
    query LoadValidationRequestReads($actorUserId: uuid!, $requestIds: [uuid!]!) {
      items: validation_request_reads(
        where: {
          user_id: { _eq: $actorUserId }
          request_id: { _in: $requestIds }
        }
      ) {
        request_id
        read_at
      }
    }
  `;
  const data = await executeHasura(query, { actorUserId, requestIds });
  const readMap = new Map((data.items || []).map((item) => [String(item.request_id), item.read_at]));

  const items = capped.map((row) => {
    const readAt = readMap.get(String(row.id)) || null;
    const unread = !readAt || new Date(row.updated_at || 0).getTime() > new Date(readAt).getTime();
    const ageMs = Date.now() - new Date(row.updated_at || row.created_at || 0).getTime();
    const ageMinutes = Number.isFinite(ageMs) && ageMs > 0 ? Math.floor(ageMs / 60000) : 0;
    const urgent = ageMinutes >= Math.max(1, Number(urgentAfterHours || 8)) * 60;
    return {
      ...row,
      read_at: readAt,
      unread,
      age_minutes: ageMinutes,
      urgent,
    };
  });

  return {
    unread_count: items.filter((item) => item.unread).length,
    items,
  };
}

async function markNotificationAsRead({ requestId, actorUserId }) {
  const mutation = `
    mutation UpsertValidationRequestRead($object: validation_request_reads_insert_input!) {
      item: insert_validation_request_reads_one(
        object: $object
        on_conflict: {
          constraint: uq_validation_request_reads_request_user
          update_columns: [read_at, updated_at]
        }
      ) {
        id
        request_id
        user_id
        read_at
      }
    }
  `;
  const data = await executeHasura(mutation, {
    object: {
      request_id: requestId,
      user_id: actorUserId,
      read_at: new Date().toISOString(),
    },
  });
  return data.item;
}

async function markAllNotificationsAsRead({ queue, regionIds, actorUserId, regionIdFilter = null }) {
  const rows = await listRequestsForNotificationInbox({ queue, regionIds, regionIdFilter });
  const items = rows.slice(0, 200);
  if (!items.length) return { affected_rows: 0 };

  const now = new Date().toISOString();
  const objects = items.map((item) => ({
    request_id: item.id,
    user_id: actorUserId,
    read_at: now,
  }));

  const mutation = `
    mutation UpsertValidationRequestReads($objects: [validation_request_reads_insert_input!]!) {
      items: insert_validation_request_reads(
        objects: $objects
        on_conflict: {
          constraint: uq_validation_request_reads_request_user
          update_columns: [read_at, updated_at]
        }
      ) {
        affected_rows
      }
    }
  `;
  const data = await executeHasura(mutation, { objects });
  return {
    affected_rows: data.items?.affected_rows || 0,
  };
}

async function getNotificationDigest({
  queue,
  regionIds,
  actorUserId,
  window = 'daily',
  urgentAfterHours = 8,
  regionIdFilter = null,
}) {
  const windowHours = window === 'weekly' ? 24 * 7 : 24;
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const inbox = await listNotificationInbox({
    queue,
    regionIds,
    actorUserId,
    limit: 200,
    urgentAfterHours,
    regionIdFilter,
  });
  const items = inbox.items || [];
  const sinceMs = since.getTime();
  const newInWindow = items.filter((item) => {
    const createdMs = new Date(item.created_at || 0).getTime();
    return Number.isFinite(createdMs) && createdMs >= sinceMs;
  }).length;
  const updatedInWindow = items.filter((item) => {
    const updatedMs = new Date(item.updated_at || 0).getTime();
    return Number.isFinite(updatedMs) && updatedMs >= sinceMs;
  }).length;

  return {
    window,
    since: since.toISOString(),
    pending_total: items.length,
    unread_total: inbox.unread_count || 0,
    urgent_total: items.filter((item) => item.urgent).length,
    new_in_window: newInWindow,
    updated_in_window: updatedInWindow,
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

function normalizeResourcePayloadForApply(resourceName, payload) {
  if (resourceName !== 'projects') {
    return payload;
  }

  const statusMap = {
    active: 'running',
    completed: 'done',
    on_hold: 'hold',
  };
  const status = payload.status ? String(payload.status).toLowerCase() : '';
  if (!statusMap[status]) {
    return payload;
  }

  return {
    ...payload,
    status: statusMap[status],
  };
}

async function loadDeviceSnapshot(deviceId) {
  const query = `
    query LoadDeviceSnapshot($deviceId: uuid!) {
      device: devices_by_pk(id: $deviceId) {
        id
        region_id
        device_name
        status
        validation_status
        validation_date
        deleted_at
        deleted_by_user_id
        splitter_ratio
        odp_type
        installation_type
        total_ports
        used_ports
        address
        longitude
        latitude
        image_attachment_id
        image_attachments
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

async function createDevicePort(object) {
  const mutation = `
    mutation CreateDevicePort($object: device_ports_insert_input!) {
      item: insert_device_ports_one(object: $object) {
        id
      }
    }
  `;
  const data = await executeHasura(mutation, { object });
  return data.item;
}

async function deleteDevicePortById(portId) {
  const mutation = `
    mutation DeleteDevicePortById($id: uuid!) {
      item: delete_device_ports_by_pk(id: $id) {
        id
      }
    }
  `;
  const data = await executeHasura(mutation, { id: portId });
  return data.item;
}

async function syncDevicePortUsage(deviceId) {
  if (!deviceId) return null;

  const query = `
    query DevicePortUsage($deviceId: uuid!, $usedWhere: device_ports_bool_exp!) {
      total_ports: device_ports_aggregate(where: { device_id: { _eq: $deviceId }, deleted_at: { _is_null: true } }) {
        aggregate { count }
      }
      used_ports: device_ports_aggregate(where: $usedWhere) {
        aggregate { count }
      }
      device: devices_by_pk(id: $deviceId) {
        id
      }
    }
  `;

  const usedWhere = {
    device_id: { _eq: deviceId },
    deleted_at: { _is_null: true },
    _or: [
      { status: { _eq: 'used' } },
      { customer_id: { _is_null: false } },
      { ont_device_id: { _is_null: false } },
    ],
  };

  const data = await executeHasura(query, { deviceId, usedWhere });
  if (!data.device?.id) return null;

  const totalPorts = Number(data.total_ports?.aggregate?.count || 0);
  const usedPorts = Number(data.used_ports?.aggregate?.count || 0);

  await updateDeviceById(deviceId, {
    total_ports: totalPorts,
    used_ports: usedPorts,
    updated_at: new Date().toISOString(),
  });

  return { total_ports: totalPorts, used_ports: usedPorts };
}

async function applyProvisionDevicePortsRequest({ request }) {
  const payload = request.payload_snapshot || {};
  const requestedPorts = Array.isArray(payload.port_objects) ? payload.port_objects : [];
  const before = await loadDeviceSnapshot(request.entity_id);
  if (!before.device) {
    throw createHttpError(404, 'Target device for port provisioning apply not found');
  }

  const currentPortByIndex = new Map(before.ports.map((port) => [Number(port.port_index), port]));
  const createdPorts = [];

  for (const port of requestedPorts) {
    const portIndex = Number(port.port_index);
    if (!Number.isInteger(portIndex) || portIndex <= 0 || currentPortByIndex.has(portIndex)) continue;

    const created = await createDevicePort({
      region_id: request.region_id,
      device_id: request.entity_id,
      port_index: portIndex,
      port_label: port.port_label || `#${portIndex}`,
      port_type: port.port_type || 'fiber',
      direction: port.direction || 'bidirectional',
      status: port.status || 'idle',
      speed_profile: port.speed_profile || null,
      core_capacity: port.core_capacity ?? null,
      core_used: port.core_used ?? 0,
      is_active: port.is_active !== false,
      notes: port.notes || null,
    });
    createdPorts.push({ id: created.id, port_index: portIndex });
    currentPortByIndex.set(portIndex, created);
  }

  const usage = await syncDevicePortUsage(request.entity_id);
  const after = await loadDeviceSnapshot(request.entity_id);
  return {
    before,
    after: {
      ...after,
      provision_ports: {
        profile_name: payload.profile_name || 'default',
        created_count: createdPorts.length,
        created_ports: createdPorts,
        usage,
      },
    },
  };
}

async function loadConnectionPortEndpoint(portId) {
  if (!portId) return null;
  const query = `
    query LoadConnectionPortEndpoint($id: uuid!) {
      item: device_ports_by_pk(id: $id) {
        id
        region_id
        deleted_at
      }
    }
  `;
  const data = await executeHasura(query, { id: portId });
  return data.item || null;
}

async function findActiveConnectionByPort(portId, excludeConnectionId = null) {
  if (!portId) return null;
  const where = {
    status: { _in: ['active', 'planned', 'cutover'] },
    _or: [
      { from_port_id: { _eq: portId } },
      { to_port_id: { _eq: portId } },
    ],
  };
  if (excludeConnectionId) {
    where.id = { _neq: excludeConnectionId };
  }

  const query = `
    query FindActiveConnectionByPort($where: port_connections_bool_exp!) {
      items: port_connections(where: $where, limit: 1) {
        id
        connection_id
      }
    }
  `;
  const data = await executeHasura(query, { where });
  return data.items?.[0] || null;
}

async function validatePortConnectionApplyPayload(payload, existing = null) {
  const fromPortId = payload.from_port_id || existing?.from_port_id;
  const toPortId = payload.to_port_id || existing?.to_port_id;
  const regionId = payload.region_id || existing?.region_id;
  if (!fromPortId || !toPortId) return;

  const [fromPort, toPort] = await Promise.all([
    loadConnectionPortEndpoint(fromPortId),
    loadConnectionPortEndpoint(toPortId),
  ]);
  if (!fromPort || !toPort) throw createHttpError(404, 'Connection port endpoint not found');
  if (fromPort.deleted_at || toPort.deleted_at) throw createHttpError(400, 'Cannot connect deleted port');
  if (fromPort.region_id && toPort.region_id && fromPort.region_id !== toPort.region_id) {
    throw createHttpError(400, 'Connection ports must be in the same region');
  }
  if (regionId && fromPort.region_id && regionId !== fromPort.region_id) {
    throw createHttpError(400, 'Connection region must match port region');
  }

  const [fromActive, toActive] = await Promise.all([
    findActiveConnectionByPort(fromPort.id, existing?.id),
    findActiveConnectionByPort(toPort.id, existing?.id),
  ]);
  if (fromActive) throw createHttpError(400, 'from_port_id is already used by an active/planned connection');
  if (toActive) throw createHttpError(400, 'to_port_id is already used by an active/planned connection');

  await validateFiberCoreRangeForConnection(payload, existing);
}

function hasConnectionCoreRange(connection = {}) {
  return Boolean(
    connection.cable_device_id
    && connection.core_start != null
    && connection.core_end != null
    && Number(connection.core_end) >= Number(connection.core_start)
  );
}

async function releaseFiberCoresForPortConnection(connection) {
  if (!connection?.id) {
    return { enabled: false, released_count: 0, reason: 'connection_not_found' };
  }

  const mutation = `
    mutation ReleaseFiberCoresForConnection($connectionId: uuid!) {
      updated: update_fiber_cores(
        where: {
          connection_id: { _eq: $connectionId }
          status: { _nin: ["damaged", "inactive"] }
        }
        _set: {
          status: "available"
          connection_id: null
          from_port_id: null
          to_port_id: null
        }
      ) {
        affected_rows
      }
    }
  `;

  const result = await executeHasura(mutation, { connectionId: connection.id });
  return {
    enabled: true,
    released_count: result.updated?.affected_rows || 0,
  };
}

async function applyFiberCoresForPortConnection(connection) {
  if (!hasConnectionCoreRange(connection)) {
    return { enabled: false, affected_count: 0, reason: 'core_range_not_provided' };
  }

  const status = String(connection.status || '').toLowerCase();
  if (!['active', 'cutover', 'planned'].includes(status)) {
    return { enabled: false, affected_count: 0, reason: 'connection_status_not_occupying_core' };
  }

  const nextStatus = status === 'planned' ? 'reserved' : 'used';
  const mutation = `
    mutation ApplyFiberCoresForConnection(
      $cableDeviceId: uuid!
      $coreStart: Int!
      $coreEnd: Int!
      $set: fiber_cores_set_input!
    ) {
      updated: update_fiber_cores(
        where: {
          cable_device_id: { _eq: $cableDeviceId }
          core_no: { _gte: $coreStart, _lte: $coreEnd }
          status: { _nin: ["damaged", "inactive"] }
        }
        _set: $set
      ) {
        affected_rows
      }
    }
  `;

  const result = await executeHasura(mutation, {
    cableDeviceId: connection.cable_device_id,
    coreStart: Number(connection.core_start),
    coreEnd: Number(connection.core_end),
    set: {
      status: nextStatus,
      connection_id: connection.id,
      from_port_id: connection.from_port_id,
      to_port_id: connection.to_port_id,
    },
  });

  return {
    enabled: true,
    status: nextStatus,
    expected_count: Number(connection.core_end) - Number(connection.core_start) + 1,
    affected_count: result.updated?.affected_rows || 0,
  };
}

async function syncFiberCoresForPortConnection(connection, previousConnection = null) {
  const released = previousConnection
    ? await releaseFiberCoresForPortConnection(previousConnection)
    : { enabled: false, released_count: 0 };
  const applied = await applyFiberCoresForPortConnection(connection);
  return { enabled: true, released, applied };
}

async function findActiveDevicePortAssignment(fieldName, value, excludePortId = null) {
  if (!value) return null;
  const where = {
    deleted_at: { _is_null: true },
    [fieldName]: { _eq: value },
    _or: [
      { status: { _neq: 'idle' } },
      { status: { _is_null: true } },
    ],
  };
  if (excludePortId) {
    where.id = { _neq: excludePortId };
  }

  const query = `
    query FindActiveDevicePortAssignment($where: device_ports_bool_exp!) {
      items: device_ports(where: $where, limit: 1) {
        id
        port_id
        customer_id
        ont_device_id
        status
      }
    }
  `;
  const data = await executeHasura(query, { where });
  return data.items?.[0] || null;
}

async function validateDevicePortAssignmentApplyPayload(payload, existing = null) {
  if (!existing) return;

  const assignmentKeys = ['status', 'customer_id', 'ont_device_id', 'occupied_at'];
  const changesAssignment = assignmentKeys.some((key) => payload[key] !== undefined);
  if (!changesAssignment) return;
  if (existing.deleted_at) throw createHttpError(400, 'Cannot update assignment for deleted port');

  const effectiveStatus = String(payload.status ?? existing.status ?? '').toLowerCase();
  const effectiveCustomerId = payload.customer_id !== undefined ? payload.customer_id : existing.customer_id;
  const effectiveOntDeviceId = payload.ont_device_id !== undefined ? payload.ont_device_id : existing.ont_device_id;

  if (effectiveStatus === 'used' && !effectiveCustomerId && !effectiveOntDeviceId) {
    throw createHttpError(400, 'status=used requires customer_id or ont_device_id');
  }

  const [customerAssignment, ontAssignment] = await Promise.all([
    effectiveCustomerId
      ? findActiveDevicePortAssignment('customer_id', effectiveCustomerId, existing.id)
      : Promise.resolve(null),
    effectiveOntDeviceId
      ? findActiveDevicePortAssignment('ont_device_id', effectiveOntDeviceId, existing.id)
      : Promise.resolve(null),
  ]);
  if (customerAssignment) throw createHttpError(400, 'Customer is already assigned to another active port');
  if (ontAssignment) throw createHttpError(400, 'ONT device is already assigned to another active port');
}

async function applyValidationPayloadToAsset({ request, actorUserId = null }) {
  const payload = request.payload_snapshot || {};
  if (payload.source === 'adminregion-create-device') {
    return applyAdminRegionCreateDeviceRequest({ request });
  }

  if (payload.source === 'adminregion-provision-device-ports') {
    return applyProvisionDevicePortsRequest({ request });
  }

  if (
    payload.source === 'adminregion-create-resource' ||
    payload.source === 'adminregion-update-resource' ||
    payload.source === 'adminregion-archive-resource'
  ) {
    return applyResourceChangeRequest({ request, actorUserId });
  }

  const payloadDevice = payload.device || {};
  const payloadPorts = Array.isArray(payload.device_ports) ? payload.device_ports : [];

  const before = await loadDeviceSnapshot(request.entity_id);
  if (!before.device) {
    throw createHttpError(404, 'Target device for apply not found');
  }

  const currentPortMap = new Map(before.ports.map((port) => [String(port.id), port]));
  const currentPortByIndex = new Map(before.ports.map((port) => [Number(port.port_index), port]));

  const deviceChanges = pickObject(payloadDevice, [
    'status',
    'splitter_ratio',
    'odp_type',
    'installation_type',
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
  deviceChanges.last_validation_at = new Date().toISOString();
  deviceChanges.updated_at = new Date().toISOString();
  deviceChanges.deleted_at = null;
  deviceChanges.deleted_by_user_id = null;

  const approvedGalleryAttachments = mergeAttachmentRefs(
    Array.isArray(before.device.image_attachments) ? before.device.image_attachments : [],
    collectApprovedValidationAttachments(request),
  );
  if (approvedGalleryAttachments.length) {
    deviceChanges.image_attachments = approvedGalleryAttachments;
  }

  const changedPorts = [];
  const createdPorts = [];
  try {
    if (Object.keys(deviceChanges).length > 0) {
      await updateDeviceById(request.entity_id, deviceChanges);
    }

    for (const portPatch of payloadPorts) {
      const requestedPortIndex = Number(portPatch.port_index);
      const existingByIndex = Number.isInteger(requestedPortIndex) ? currentPortByIndex.get(requestedPortIndex) : null;
      const portId = String(portPatch.id || existingByIndex?.id || '').trim();
      const changes = pickObject(portPatch, ['port_label', 'status', 'customer_id', 'ont_device_id', 'notes']);
      if (!Object.keys(changes).length) continue;

      if (!portId || !currentPortMap.has(portId)) {
        if (!Number.isInteger(requestedPortIndex) || requestedPortIndex <= 0) continue;
        const created = await createDevicePort({
          region_id: before.device.region_id,
          device_id: request.entity_id,
          port_index: requestedPortIndex,
          port_label: portPatch.port_label || `#${requestedPortIndex}`,
          port_type: portPatch.port_type || 'fiber',
          direction: portPatch.direction || 'bidirectional',
          status: changes.status || 'idle',
          customer_id: changes.customer_id || null,
          ont_device_id: changes.ont_device_id || null,
          notes: changes.notes || null,
          is_active: true,
        });
        if (created?.id) createdPorts.push(created.id);
        continue;
      }

      await updateDevicePortById(portId, changes);
      changedPorts.push(portId);
    }
  } catch (error) {
    // rollback best effort
    try {
      const rollbackDevice = pickObject(before.device, [
        'status',
        'device_name',
        'validation_status',
        'validation_date',
        'last_validation_at',
        'updated_at',
        'deleted_at',
        'deleted_by_user_id',
        'splitter_ratio',
        'odp_type',
        'installation_type',
        'total_ports',
        'used_ports',
        'address',
        'longitude',
        'latitude',
        'image_attachment_id',
        'image_attachments',
      ]);
      await updateDeviceById(request.entity_id, rollbackDevice);

      for (const portId of changedPorts) {
        const oldPort = currentPortMap.get(portId);
        if (!oldPort) continue;
        const rollbackPort = pickObject(oldPort, ['port_label', 'status', 'customer_id', 'ont_device_id', 'notes']);
        await updateDevicePortById(portId, rollbackPort);
      }

      for (const portId of createdPorts) {
        await deleteDevicePortById(portId);
      }
    } catch (_rollbackError) {
      // swallow rollback error; original error is more important
    }
    throw error;
  }

  const after = await loadDeviceSnapshot(request.entity_id);
  return { before, after };
}

async function applyAdminRegionCreateDeviceRequest({ request }) {
  const payload = request.payload_snapshot || {};
  const payloadDevice = payload.device || {};
  const before = await loadDeviceSnapshot(request.entity_id);
  if (!before.device) {
    throw createHttpError(404, 'Target device for apply not found');
  }

  const deviceChanges = pickObject(payloadDevice, [
    'device_name',
    'status',
    'splitter_ratio',
    'odp_type',
    'installation_type',
    'total_ports',
    'used_ports',
    'address',
    'longitude',
    'latitude',
    'validation_status',
    'validation_date',
    'image_attachment_id',
    'image_attachments',
  ]);
  deviceChanges.deleted_at = null;
  deviceChanges.deleted_by_user_id = null;

  try {
    await updateDeviceById(request.entity_id, deviceChanges);
  } catch (error) {
    try {
      const rollbackDevice = pickObject(before.device, [
        'device_name',
        'status',
        'validation_status',
        'validation_date',
        'deleted_at',
        'deleted_by_user_id',
        'splitter_ratio',
        'odp_type',
        'installation_type',
        'total_ports',
        'used_ports',
        'address',
        'longitude',
        'latitude',
        'image_attachment_id',
        'image_attachments',
      ]);
      await updateDeviceById(request.entity_id, rollbackDevice);
    } catch (_rollbackError) {
      // swallow rollback error; original error is more important
    }
    throw error;
  }

  const after = await loadDeviceSnapshot(request.entity_id);
  return { before, after };
}

async function applyResourceChangeRequest({ request, actorUserId = null }) {
  const payload = request.payload_snapshot || {};
  const resourceName = String(payload.resource_name || '').trim();
  const resourcePayload = normalizeResourcePayloadForApply(resourceName, payload.resource_payload || {});
  const config = RESOURCE_CONFIG[resourceName];

  if (!config) {
    throw createHttpError(400, `Unsupported request resource: ${resourceName || '-'}`);
  }

  if (payload.operation === 'create') {
    const object = {
      ...resourcePayload,
      id: request.entity_id,
      region_id: request.region_id,
    };
    if (resourceName === 'portConnections') {
      await validatePortConnectionApplyPayload(object);
    }
    const item = await createResource(config, object);
    if (resourceName === 'portConnections') {
      const fiberCoreSync = await syncFiberCoresForPortConnection(item);
      return { before: null, after: { ...item, fiber_core_sync: fiberCoreSync } };
    }
    return { before: null, after: item };
  }

  const before = await getResourceById(config, request.entity_id);
  if (!before) {
    throw createHttpError(404, `Target ${resourceName} for apply not found`);
  }

  if (payload.operation === 'update') {
    if (resourceName === 'portConnections') {
      await validatePortConnectionApplyPayload(resourcePayload, before);
    }
    if (resourceName === 'devicePorts') {
      await validateDevicePortAssignmentApplyPayload(resourcePayload, before);
    }
    const item = await updateResource(config, request.entity_id, resourcePayload);
    if (resourceName === 'portConnections') {
      const fiberCoreSync = await syncFiberCoresForPortConnection(item, before);
      return { before, after: { ...item, fiber_core_sync: fiberCoreSync } };
    }
    return { before, after: item };
  }

  if (payload.operation === 'archive' || payload.operation === 'delete') {
    const fiberCoreSync = resourceName === 'portConnections'
      ? await releaseFiberCoresForPortConnection(before)
      : null;
    if (config.softDelete) {
      const item = await updateResource(config, request.entity_id, {
        deleted_at: new Date().toISOString(),
        deleted_by_user_id: actorUserId,
      });
      return {
        before,
        after: fiberCoreSync ? { ...item, fiber_core_sync: fiberCoreSync } : item,
      };
    }
    await deleteResource(config, request.entity_id);
    return {
      before,
      after: fiberCoreSync ? { fiber_core_sync: fiberCoreSync } : null,
    };
  }

  throw createHttpError(400, `Unsupported request operation: ${payload.operation || '-'}`);
}

module.exports = {
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
  listValidatorValidationHistory,
  listRequestsByEntity,
  updateRequestStatus,
  listRequestHistory,
  listRejectReasonMetrics,
  listNotificationInbox,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getNotificationDigest,
  applyValidationPayloadToAsset,
};

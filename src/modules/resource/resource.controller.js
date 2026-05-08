const { randomUUID } = require('crypto');
const { getPagination } = require('../../utils/pagination');
const { sendSuccess } = require('../../utils/response');
const { createHttpError } = require('../../utils/httpError');
const { nhostStorageClient } = require('../../config/nhost');
const { executeHasura } = require('../../config/hasura');
const { createAuditLog } = require('../../shared/audit.service');
const {
  buildWhereClause,
  sanitizePayload,
  listResources,
  getResourceById,
  createResource,
  updateResource,
  deleteResource,
} = require('../../shared/resource.service');
const { validateDevicePayload } = require('../device/device.validation');
const { validatePopPayload } = require('../pop/pop.validation');
const {
  validateDeviceLinkPayload,
  validateDevicePortPayload,
  validatePortConnectionPayload,
} = require('../device/connectivity.validation');
const { buildOdpCoreChainSummary } = require('../device/odp-chain.service');
const {
  STATUS: VALIDATION_STATUS,
  ACTION: VALIDATION_ACTION,
  createRequest: createValidationRequest,
  insertRequestLog: insertValidationRequestLog,
} = require('../validation/validation.service');

const ADMINREGION_CREATE_APPROVAL_RESOURCES = new Set(['devices', 'pops', 'routes', 'projects']);
const REQUEST_ENTITY_TYPE_BY_RESOURCE = {
  devices: 'device',
  pops: 'pop',
  routes: 'route',
  projects: 'project',
};
const REQUEST_LABEL_BY_RESOURCE = {
  devices: 'Device',
  pops: 'POP',
  routes: 'Route',
  projects: 'Project',
};

async function loadDevicePortTemplate(deviceTypeKey, profileName = 'default') {
  const query = `
    query LoadDevicePortTemplate($deviceTypeKey: String!, $profileName: String!) {
      items: device_port_templates(
        where: {
          device_type_key: { _eq: $deviceTypeKey }
          profile_name: { _eq: $profileName }
          is_active: { _eq: true }
        }
        limit: 1
      ) {
        id
        profile_name
        total_ports
        start_port_index
        default_port_type
        default_direction
        default_speed_profile
        default_core_capacity
      }
    }
  `;

  const data = await executeHasura(query, { deviceTypeKey, profileName });
  return data.items?.[0] || null;
}

async function provisionPortsFromTemplate(device) {
  const template = await loadDevicePortTemplate(device.device_type_key, 'default');
  if (!template) {
    return { enabled: false, createdCount: 0, reason: 'template_not_found' };
  }

  const requestedTotalPorts = Number(device.total_ports);
  const totalPorts = Number.isInteger(requestedTotalPorts) && requestedTotalPorts > 0
    ? requestedTotalPorts
    : (Number(template.total_ports) || 0);
  const startPortIndex = Number(template.start_port_index) || 1;
  if (totalPorts <= 0) {
    return { enabled: false, createdCount: 0, reason: 'invalid_template_total_ports' };
  }

  const objects = Array.from({ length: totalPorts }, (_, index) => {
    const portIndex = startPortIndex + index;
    return {
      region_id: device.region_id,
      device_id: device.id,
      port_index: portIndex,
      port_label: `#${portIndex}`,
      port_type: template.default_port_type || 'fiber',
      direction: template.default_direction || 'bidirectional',
      status: 'idle',
      speed_profile: template.default_speed_profile || null,
      core_capacity: template.default_core_capacity ?? null,
      core_used: 0,
      is_active: true,
    };
  });

  const mutation = `
    mutation ProvisionPorts($objects: [device_ports_insert_input!]!) {
      inserted: insert_device_ports(objects: $objects) {
        affected_rows
      }
    }
  `;

  const result = await executeHasura(mutation, { objects });
  return {
    enabled: true,
    templateId: template.id,
    profileName: template.profile_name,
    createdCount: result.inserted?.affected_rows || 0,
  };
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

  await executeHasura(
    `
      mutation UpdateDevicePortUsage($deviceId: uuid!, $set: devices_set_input!) {
        updated: update_devices_by_pk(pk_columns: { id: $deviceId }, _set: $set) {
          id
          total_ports
          used_ports
        }
      }
    `,
    {
      deviceId,
      set: {
        total_ports: totalPorts,
        used_ports: usedPorts,
      },
    },
  );

  return { total_ports: totalPorts, used_ports: usedPorts };
}

async function loadFiberCoresByCableDeviceId(cableDeviceId) {
  const query = `
    query LoadFiberCoresByCableDeviceId($cableDeviceId: uuid!) {
      items: fiber_cores(
        where: { cable_device_id: { _eq: $cableDeviceId } }
        order_by: [{ core_no: asc }]
      ) {
        id
        core_no
        status
        from_port_id
        to_port_id
        connection_id
      }
    }
  `;

  const data = await executeHasura(query, { cableDeviceId });
  return data.items || [];
}

async function syncFiberCoresForCableDevice(device) {
  if (String(device.device_type_key || '').toUpperCase() !== 'CABLE') {
    return { enabled: false, reason: 'not_cable_device' };
  }

  const desired = Math.max(0, Number(device.capacity_core) || 0);
  const existing = await loadFiberCoresByCableDeviceId(device.id);
  const byCoreNo = new Map(existing.map((row) => [Number(row.core_no), row]));

  const createObjects = [];
  for (let coreNo = 1; coreNo <= desired; coreNo += 1) {
    if (!byCoreNo.has(coreNo)) {
      createObjects.push({
        region_id: device.region_id,
        cable_device_id: device.id,
        core_no: coreNo,
        status: 'available',
      });
    }
  }

  if (createObjects.length) {
    const mutation = `
      mutation InsertFiberCores($objects: [fiber_cores_insert_input!]!) {
        inserted: insert_fiber_cores(objects: $objects) {
          affected_rows
        }
      }
    `;
    await executeHasura(mutation, { objects: createObjects });
  }

  const overCapacity = existing.filter((row) => Number(row.core_no) > desired);
  const unassignedOverCapacityIds = overCapacity
    .filter((row) => !row.from_port_id && !row.to_port_id && !row.connection_id && row.status !== 'inactive')
    .map((row) => row.id);
  const assignedOverCapacityCount = overCapacity.length - unassignedOverCapacityIds.length;

  if (unassignedOverCapacityIds.length) {
    const mutation = `
      mutation DeactivateFiberCores($ids: [uuid!]!) {
        updated: update_fiber_cores(where: { id: { _in: $ids } }, _set: { status: "inactive" }) {
          affected_rows
        }
      }
    `;
    await executeHasura(mutation, { ids: unassignedOverCapacityIds });
  }

  const restorableInactiveIds = existing
    .filter(
      (row) =>
        Number(row.core_no) <= desired &&
        row.status === 'inactive' &&
        !row.from_port_id &&
        !row.to_port_id &&
        !row.connection_id,
    )
    .map((row) => row.id);

  if (restorableInactiveIds.length) {
    const mutation = `
      mutation ActivateFiberCores($ids: [uuid!]!) {
        updated: update_fiber_cores(where: { id: { _in: $ids } }, _set: { status: "available" }) {
          affected_rows
        }
      }
    `;
    await executeHasura(mutation, { ids: restorableInactiveIds });
  }

  return {
    enabled: true,
    desired_core_count: desired,
    existing_core_count: existing.length,
    created_count: createObjects.length,
    deactivated_over_capacity_count: unassignedOverCapacityIds.length,
    reactivated_count: restorableInactiveIds.length,
    assigned_over_capacity_count: assignedOverCapacityCount,
  };
}

function validatePayloadByResource(resourceName, payload, mode = 'create') {
  if (resourceName === 'devices') {
    validateDevicePayload(payload, mode);
    return;
  }

  if (resourceName === 'pops') {
    validatePopPayload(payload, mode);
    return;
  }

  if (resourceName === 'deviceLinks') {
    validateDeviceLinkPayload(payload, mode);
    return;
  }

  if (resourceName === 'devicePorts') {
    validateDevicePortPayload(payload, mode);
    return;
  }

  if (resourceName === 'portConnections') {
    validatePortConnectionPayload(payload, mode);
  }
}

function validateUsedPortEndpointState(state) {
  if (String(state.status || '').toLowerCase() !== 'used') return;
  const hasCustomer = state.customer_id != null && String(state.customer_id).trim() !== '';
  const hasOnt = state.ont_device_id != null && String(state.ont_device_id).trim() !== '';
  if (!hasCustomer && !hasOnt) {
    throw createHttpError(400, 'status=used requires customer_id or ont_device_id');
  }
}

function shouldHoldDeviceForSuperadminApproval(req, object) {
  return req.resourceName === 'devices' && req.auth.role === 'user_all_region' && object.region_id;
}

function shouldHoldCreateForSuperadminApproval(req, object) {
  return ADMINREGION_CREATE_APPROVAL_RESOURCES.has(req.resourceName) && req.auth.role === 'user_all_region' && object.region_id;
}

function buildAdminRegionCreateRequestPayload(device) {
  return {
    source: 'adminregion-create-device',
    device: {
      id: device.id,
      region_id: device.region_id || null,
      pop_id: device.pop_id || null,
      project_id: device.project_id || null,
      device_type_key: device.device_type_key || null,
      device_name: device.device_name || null,
      status: device.status || null,
      manufacturer_id: device.manufacturer_id || null,
      brand_id: device.brand_id || null,
      model_id: device.model_id || null,
      serial_number: device.serial_number || null,
      splitter_ratio: device.splitter_ratio || null,
      total_ports: device.total_ports ?? null,
      used_ports: device.used_ports ?? null,
      validation_status: device.validation_status || null,
      validation_date: device.validation_date || null,
      address: device.address || null,
      longitude: device.longitude ?? null,
      latitude: device.latitude ?? null,
    },
    device_ports: [],
  };
}

function buildAdminRegionCreateResourcePayload(resourceName, entityId, object) {
  const resourceLabel = REQUEST_LABEL_BY_RESOURCE[resourceName] || resourceName;
  return {
    source: 'adminregion-create-resource',
    operation: 'create',
    resource_name: resourceName,
    resource_label: resourceLabel,
    [REQUEST_ENTITY_TYPE_BY_RESOURCE[resourceName] || 'resource']: {
      id: entityId,
      ...object,
    },
    resource_payload: object,
  };
}

function getCreateRequestNaturalKey(resourceName, object) {
  if (resourceName === 'devices') {
    const deviceName = String(object.device_name || '').trim();
    if (!deviceName) return null;
    return {
      field: 'device_name',
      value: deviceName,
      extra: object.device_type_key ? { device_type_key: object.device_type_key } : {},
    };
  }

  if (resourceName === 'pops') {
    const popCode = String(object.pop_code || '').trim();
    if (!popCode) return null;
    return { field: 'pop_code', value: popCode };
  }

  if (resourceName === 'routes') {
    const routeName = String(object.route_name || '').trim();
    if (!routeName) return null;
    return { field: 'route_name', value: routeName };
  }

  if (resourceName === 'projects') {
    const projectName = String(object.project_name || '').trim();
    if (!projectName) return null;
    return { field: 'project_name', value: projectName };
  }

  return null;
}

function buildCreateRequestDuplicateMatcher(resourceName, object) {
  const naturalKey = getCreateRequestNaturalKey(resourceName, object);
  if (!naturalKey) return null;

  if (resourceName === 'devices') {
    return {
      source: 'adminregion-create-device',
      device: {
        region_id: object.region_id,
        [naturalKey.field]: naturalKey.value,
        ...naturalKey.extra,
      },
    };
  }

  return {
    source: 'adminregion-create-resource',
    operation: 'create',
    resource_name: resourceName,
    resource_payload: {
      region_id: object.region_id,
      [naturalKey.field]: naturalKey.value,
    },
  };
}

async function findActiveCreateApprovalRequest(req, object) {
  const entityType = REQUEST_ENTITY_TYPE_BY_RESOURCE[req.resourceName];
  const payloadMatcher = buildCreateRequestDuplicateMatcher(req.resourceName, object);
  if (!entityType || !payloadMatcher || !object.region_id) return null;

  const query = `
    query FindActiveCreateApprovalRequest($entityType: String!, $regionId: uuid!, $payloadMatcher: jsonb!) {
      items: validation_requests(
        where: {
          entity_type: { _eq: $entityType }
          region_id: { _eq: $regionId }
          current_status: { _eq: "pending_async" }
          payload_snapshot: { _contains: $payloadMatcher }
        }
        order_by: { created_at: desc }
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
        created_at
        updated_at
      }
    }
  `;

  const data = await executeHasura(query, {
    entityType,
    regionId: object.region_id,
    payloadMatcher,
  });
  return data.items?.[0] || null;
}

function buildAdminRegionChangeResourcePayload(resourceName, operation, existing, changes = {}) {
  const entityType = REQUEST_ENTITY_TYPE_BY_RESOURCE[resourceName] || 'resource';
  const resourceLabel = REQUEST_LABEL_BY_RESOURCE[resourceName] || resourceName;
  const payload = operation === 'update' ? { ...existing, ...changes } : existing;
  return {
    source: operation === 'update' ? 'adminregion-update-resource' : 'adminregion-archive-resource',
    operation,
    resource_name: resourceName,
    resource_label: resourceLabel,
    [entityType]: payload,
    before: existing,
    resource_payload: changes,
  };
}

async function submitAdminRegionAssetRequest({ req, entityId, regionId, operation, payloadSnapshot }) {
  const entityType = REQUEST_ENTITY_TYPE_BY_RESOURCE[req.resourceName];
  const resourceLabel = REQUEST_LABEL_BY_RESOURCE[req.resourceName] || req.resourceName;
  const approvalRequest = await createValidationRequest({
    entityType,
    entityId,
    regionId,
    submittedByUserId: req.auth.appUser.id,
    currentStatus: VALIDATION_STATUS.PENDING_ASYNC,
    payloadSnapshot,
    checklist: {},
    findingNote: `${operation} ${resourceLabel} request by adminregion.`,
  });

  await insertValidationRequestLog({
    requestId: approvalRequest.id,
    actionType: VALIDATION_ACTION.RESUBMIT_ADMINREGION,
    actorUserId: req.auth.appUser.id,
    actorRole: 'adminregion',
    beforeStatus: VALIDATION_STATUS.UNVALIDATED,
    afterStatus: VALIDATION_STATUS.PENDING_ASYNC,
    note: `${operation} ${resourceLabel} request submitted to superadmin.`,
    payloadPatch: payloadSnapshot,
  });

  await createAuditLog({
    actorUserId: req.auth.appUser.id,
    actionName: `asset_${operation}_request_submitted_by_adminregion`,
    entityType: 'validation_requests',
    entityId: approvalRequest.id,
    beforeData: { status: VALIDATION_STATUS.UNVALIDATED },
    afterData: {
      request_id: approvalRequest.request_id,
      status: VALIDATION_STATUS.PENDING_ASYNC,
      source: payloadSnapshot.source,
      operation,
      resource_name: req.resourceName,
      entity_type: entityType,
      entity_id: entityId,
    },
    ipAddress: req.ip,
    userAgent: req.get('user-agent'),
  });

  return approvalRequest;
}

async function list(req, res, next) {
  try {
    const config = req.resourceConfig;
    const { page, limit, offset } = getPagination(req.query);
    const where = buildWhereClause(config, req.query, req.auth);
    const data = await listResources(config, { where, limit, offset, orderBy: config.defaultOrderBy });

    return sendSuccess(res, data.items, `${req.resourceName} fetched successfully`, 200, {
      page,
      limit,
      total: data.aggregate.aggregate.count,
    });
  } catch (error) {
    return next(error);
  }
}

async function getById(req, res, next) {
  try {
    const item = await getResourceById(req.resourceConfig, req.params.id);

    if (!item) {
      throw createHttpError(404, `${req.resourceName} not found`);
    }

    if (req.resourceConfig.regionScoped && req.auth.role === 'user_region') {
      const allowedRegions = new Set(req.auth.regions);
      if (item.region_id && !allowedRegions.has(item.region_id)) {
        throw createHttpError(403, 'You do not have access to this resource region');
      }
    }

    if (req.resourceConfig.softDelete) {
      const includeDeleted = String(req.query.include_deleted || '').toLowerCase() === 'true';
      if (item.deleted_at && (!includeDeleted || req.auth.role !== 'admin')) {
        throw createHttpError(404, `${req.resourceName} not found`);
      }
    }

    return sendSuccess(res, item, `${req.resourceName} fetched successfully`);
  } catch (error) {
    return next(error);
  }
}

async function create(req, res, next) {
  try {
    validatePayloadByResource(req.resourceName, req.body, 'create');
    if (req.resourceName === 'devicePorts') {
      validateUsedPortEndpointState(req.body);
    }
    const object = sanitizePayload(req.resourceConfig, req.body);

    if (
      req.resourceConfig.regionScoped &&
      ['user_region', 'user_all_region'].includes(req.auth.role) &&
      !req.auth.regions.includes(object.region_id)
    ) {
      throw createHttpError(403, 'Regional user can only create records inside assigned regions');
    }

    if (req.resourceName === 'attachments' && !object.uploaded_by_user_id) {
      object.uploaded_by_user_id = req.auth.appUser.id;
    }

    if (req.resourceName === 'imports' && !object.created_by_user_id) {
      object.created_by_user_id = req.auth.appUser.id;
    }

    if (shouldHoldCreateForSuperadminApproval(req, object) && req.resourceName !== 'devices') {
      const existingApprovalRequest = await findActiveCreateApprovalRequest(req, object);
      if (existingApprovalRequest) {
        return sendSuccess(
          res,
          { ...object, approval_request: existingApprovalRequest },
          `${req.resourceName} create request is already waiting for superadmin approval`,
          200,
        );
      }

      const pendingEntityId = randomUUID();
      const payloadSnapshot = buildAdminRegionCreateResourcePayload(req.resourceName, pendingEntityId, object);
      const approvalRequest = await submitAdminRegionAssetRequest({
        req,
        entityId: pendingEntityId,
        regionId: object.region_id,
        operation: 'create',
        payloadSnapshot,
      });

      return sendSuccess(
        res,
        { id: pendingEntityId, ...object, approval_request: approvalRequest },
        `${req.resourceName} create request sent to superadmin approval`,
        201,
      );
    }

    if (shouldHoldDeviceForSuperadminApproval(req, object)) {
      const existingApprovalRequest = await findActiveCreateApprovalRequest(req, object);
      if (existingApprovalRequest) {
        return sendSuccess(
          res,
          { ...object, approval_request: existingApprovalRequest },
          `${req.resourceName} create request is already waiting for superadmin approval`,
          200,
        );
      }
    }

    let item = await createResource(req.resourceConfig, object);

    let provisioningResult = null;
    let fiberSyncResult = null;
    if (req.resourceName === 'devices') {
      try {
        provisioningResult = await provisionPortsFromTemplate(item);
        fiberSyncResult = await syncFiberCoresForCableDevice(item);
      } catch (provisionError) {
        try {
          await deleteResource(req.resourceConfig, item.id);
        } catch {
          // Best effort rollback; keep original error for caller.
        }

        throw createHttpError(
          500,
          `Device creation rolled back because auto-provision ports failed: ${provisionError.message || 'unknown error'}`,
        );
      }
    }
    if (req.resourceName === 'devicePorts') {
      await syncDevicePortUsage(item.device_id);
    }

    let approvalRequest = null;
    if (shouldHoldDeviceForSuperadminApproval(req, object)) {
      try {
        item = await updateResource(req.resourceConfig, item.id, {
          deleted_at: new Date().toISOString(),
          deleted_by_user_id: req.auth.appUser.id,
        });
        approvalRequest = await createValidationRequest({
          entityId: item.id,
          regionId: item.region_id,
          submittedByUserId: req.auth.appUser.id,
          currentStatus: VALIDATION_STATUS.PENDING_ASYNC,
          payloadSnapshot: buildAdminRegionCreateRequestPayload(item),
          checklist: {},
          findingNote: 'Create device request by adminregion.',
        });
        await insertValidationRequestLog({
          requestId: approvalRequest.id,
          actionType: VALIDATION_ACTION.RESUBMIT_ADMINREGION,
          actorUserId: req.auth.appUser.id,
          actorRole: 'adminregion',
          beforeStatus: VALIDATION_STATUS.UNVALIDATED,
          afterStatus: VALIDATION_STATUS.PENDING_ASYNC,
          note: 'Create device request submitted to superadmin.',
          payloadPatch: buildAdminRegionCreateRequestPayload(item),
        });
        await createAuditLog({
          actorUserId: req.auth.appUser.id,
          actionName: 'validation_request_submitted_by_adminregion',
          entityType: 'validation_requests',
          entityId: approvalRequest.id,
          beforeData: { status: VALIDATION_STATUS.UNVALIDATED },
          afterData: {
            request_id: approvalRequest.request_id,
            status: VALIDATION_STATUS.PENDING_ASYNC,
            source: 'adminregion-create-device',
            device_id: item.id,
          },
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
        });
      } catch (approvalError) {
        try {
          await deleteResource(req.resourceConfig, item.id);
        } catch {
          // Best effort rollback; keep approval error for caller.
        }
        throw createHttpError(
          500,
          `Device creation rolled back because approval request failed: ${approvalError.message || 'unknown error'}`,
        );
      }
    }

    await createAuditLog({
      actorUserId: req.auth.appUser.id,
      actionName: `create:${req.resourceName}`,
      entityType: req.resourceName,
      entityId: item.id,
      beforeData: null,
      afterData: req.resourceName === 'devices'
        ? {
          ...item,
          auto_provision: provisioningResult || { enabled: false, createdCount: 0 },
          fiber_core_sync: fiberSyncResult || { enabled: false },
          ...(approvalRequest ? { approval_request_id: approvalRequest.request_id || approvalRequest.id } : {}),
        }
        : item,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });
    return sendSuccess(
      res,
      approvalRequest ? { ...item, approval_request: approvalRequest } : item,
      approvalRequest
        ? `${req.resourceName} created and sent to superadmin approval`
        : `${req.resourceName} created successfully`,
      201,
    );
  } catch (error) {
    return next(error);
  }
}

async function update(req, res, next) {
  try {
    const existing = await getResourceById(req.resourceConfig, req.params.id);

    if (!existing) {
      throw createHttpError(404, `${req.resourceName} not found`);
    }

    validatePayloadByResource(req.resourceName, req.body, 'update');

    if (req.resourceConfig.regionScoped && ['user_region', 'user_all_region'].includes(req.auth.role)) {
      const candidateRegionId = req.body.region_id || existing.region_id;
      if (!req.auth.regions.includes(candidateRegionId)) {
        throw createHttpError(403, 'Regional user can only modify records inside assigned regions');
      }
    }

    const changes = sanitizePayload(req.resourceConfig, req.body);
    if (req.resourceName === 'devicePorts') {
      validateUsedPortEndpointState({ ...existing, ...changes });
    }

    if (req.resourceName === 'devices') {
      const currentType = String(existing.device_type_key || '').toUpperCase();
      const nextType = String(changes.device_type_key || existing.device_type_key || '').toUpperCase();
      const currentValidationStatus = String(existing.validation_status || '').toLowerCase();
      const requestedValidationStatus = changes.validation_status != null
        ? String(changes.validation_status).toLowerCase()
        : null;
      const effectiveValidationStatus = requestedValidationStatus || currentValidationStatus;
      const isValidationStatusChangingToValid = requestedValidationStatus === 'valid' && currentValidationStatus !== 'valid';
      const isChangingIntoValidatedOdp = currentType !== 'ODP' && nextType === 'ODP' && effectiveValidationStatus === 'valid';

      if (nextType === 'ODP' && (isValidationStatusChangingToValid || isChangingIntoValidatedOdp)) {
        const chain = await buildOdpCoreChainSummary(existing.id);
        if (!chain?.is_complete) {
          throw createHttpError(
            400,
            'ODP validation_status cannot be set to valid before core chain is complete (ODC source, splitter, distribution cable, and core mapping)',
          );
        }
      }
    }

    if (shouldHoldCreateForSuperadminApproval(req, { region_id: existing.region_id })) {
      const payloadSnapshot = buildAdminRegionChangeResourcePayload(req.resourceName, 'update', existing, changes);
      const approvalRequest = await submitAdminRegionAssetRequest({
        req,
        entityId: existing.id,
        regionId: existing.region_id,
        operation: 'update',
        payloadSnapshot,
      });

      return sendSuccess(
        res,
        { id: existing.id, approval_request: approvalRequest },
        `${req.resourceName} update request sent to superadmin approval`,
      );
    }

    const item = await updateResource(req.resourceConfig, req.params.id, changes);
    let fiberSyncResult = null;
    let fiberSyncError = null;
    if (req.resourceName === 'devices') {
      try {
        fiberSyncResult = await syncFiberCoresForCableDevice(item);
      } catch (syncError) {
        fiberSyncError = syncError.message || 'fiber core sync failed';
      }
    }
    if (req.resourceName === 'devicePorts') {
      await syncDevicePortUsage(item.device_id);
    }
    await createAuditLog({
      actorUserId: req.auth.appUser.id,
      actionName: `update:${req.resourceName}`,
      entityType: req.resourceName,
      entityId: item.id,
      beforeData: existing,
      afterData: req.resourceName === 'devices'
        ? {
          ...item,
          fiber_core_sync: fiberSyncResult || { enabled: false },
          ...(fiberSyncError ? { fiber_core_sync_error: fiberSyncError } : {}),
        }
        : item,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    const message = fiberSyncError
      ? `${req.resourceName} updated successfully (with topology sync warning)`
      : `${req.resourceName} updated successfully`;

    return sendSuccess(
      res,
      req.resourceName === 'devices'
        ? {
          ...item,
          fiber_core_sync: fiberSyncResult || { enabled: false },
          ...(fiberSyncError ? { fiber_core_sync_error: fiberSyncError } : {}),
        }
        : item,
      message,
    );
  } catch (error) {
    return next(error);
  }
}

async function remove(req, res, next) {
  try {
    const existing = await getResourceById(req.resourceConfig, req.params.id);

    if (!existing) {
      throw createHttpError(404, `${req.resourceName} not found`);
    }

    if (
      req.resourceConfig.regionScoped &&
      ['user_region', 'user_all_region'].includes(req.auth.role) &&
      !req.auth.regions.includes(existing.region_id)
    ) {
      throw createHttpError(403, 'Regional user can only delete records inside assigned regions');
    }

    if (req.resourceName === 'attachments' && existing.storage_file_id) {
      try {
        await nhostStorageClient.delete(`/files/${existing.storage_file_id}`, {
          headers: {
            Authorization: `Bearer ${req.auth.token}`,
          },
        });
      } catch (error) {
        const storageStatus = error.response?.status;

        if (storageStatus !== 404) {
          throw createHttpError(
            storageStatus || 500,
            error.response?.data?.message || error.message || 'Failed to delete file from storage',
            error.response?.data,
          );
        }
      }
    }

    if (shouldHoldCreateForSuperadminApproval(req, { region_id: existing.region_id })) {
      const operation = req.resourceConfig.softDelete ? 'archive' : 'delete';
      const payloadSnapshot = buildAdminRegionChangeResourcePayload(req.resourceName, operation, existing, {});
      const approvalRequest = await submitAdminRegionAssetRequest({
        req,
        entityId: existing.id,
        regionId: existing.region_id,
        operation,
        payloadSnapshot,
      });

      return sendSuccess(
        res,
        { id: existing.id, mode: operation, approval_request: approvalRequest },
        `${req.resourceName} ${operation} request sent to superadmin approval`,
      );
    }

    if (req.resourceConfig.softDelete) {
      await updateResource(req.resourceConfig, req.params.id, {
        deleted_at: new Date().toISOString(),
        deleted_by_user_id: req.auth.appUser.id,
      });
    } else {
      await deleteResource(req.resourceConfig, req.params.id);
    }
    if (req.resourceName === 'devicePorts') {
      await syncDevicePortUsage(existing.device_id);
    }

    await createAuditLog({
      actorUserId: req.auth.appUser.id,
      actionName: `${req.resourceConfig.softDelete ? 'soft_delete' : 'delete'}:${req.resourceName}`,
      entityType: req.resourceName,
      entityId: existing.id,
      beforeData: existing,
      afterData: null,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });
    return sendSuccess(
      res,
      { id: req.params.id, mode: req.resourceConfig.softDelete ? 'soft_delete' : 'delete' },
      `${req.resourceName} ${req.resourceConfig.softDelete ? 'archived' : 'deleted'} successfully`,
    );
  } catch (error) {
    return next(error);
  }
}

async function restore(req, res, next) {
  try {
    if (!req.resourceConfig.softDelete) {
      throw createHttpError(400, `${req.resourceName} does not support restore`);
    }

    const existing = await getResourceById(req.resourceConfig, req.params.id);

    if (!existing) {
      throw createHttpError(404, `${req.resourceName} not found`);
    }

    if (!existing.deleted_at) {
      return sendSuccess(res, existing, `${req.resourceName} is already active`);
    }

    const item = await updateResource(req.resourceConfig, req.params.id, {
      deleted_at: null,
      deleted_by_user_id: null,
    });
    if (req.resourceName === 'devicePorts') {
      await syncDevicePortUsage(item.device_id);
    }

    await createAuditLog({
      actorUserId: req.auth.appUser.id,
      actionName: `restore:${req.resourceName}`,
      entityType: req.resourceName,
      entityId: item.id,
      beforeData: existing,
      afterData: item,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return sendSuccess(res, item, `${req.resourceName} restored successfully`);
  } catch (error) {
    return next(error);
  }
}

async function purge(req, res, next) {
  try {
    if (req.auth.role !== 'admin') {
      throw createHttpError(403, 'Only admin can purge data permanently');
    }

    if (!req.resourceConfig.softDelete) {
      throw createHttpError(400, `${req.resourceName} does not support purge`);
    }

    const existing = await getResourceById(req.resourceConfig, req.params.id);

    if (!existing) {
      throw createHttpError(404, `${req.resourceName} not found`);
    }

    if (!existing.deleted_at) {
      throw createHttpError(409, `${req.resourceName} must be archived before purge`);
    }

    const confirm = String(req.body?.confirm || '').trim().toUpperCase();
    if (confirm !== 'PURGE') {
      throw createHttpError(400, 'Purge confirmation failed');
    }

    await deleteResource(req.resourceConfig, req.params.id);
    if (req.resourceName === 'devicePorts') {
      await syncDevicePortUsage(existing.device_id);
    }

    await createAuditLog({
      actorUserId: req.auth.appUser.id,
      actionName: `purge:${req.resourceName}`,
      entityType: req.resourceName,
      entityId: existing.id,
      beforeData: existing,
      afterData: null,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return sendSuccess(res, { id: req.params.id, mode: 'purge' }, `${req.resourceName} purged permanently`);
  } catch (error) {
    return next(error);
  }
}

module.exports = { list, getById, create, update, remove, restore, purge };

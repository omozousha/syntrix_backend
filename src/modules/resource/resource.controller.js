const { getPagination } = require('../../utils/pagination');
const { sendSuccess } = require('../../utils/response');
const { createHttpError } = require('../../utils/httpError');
const { nhostStorageClient } = require('../../config/nhost');
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

    return sendSuccess(res, item, `${req.resourceName} fetched successfully`);
  } catch (error) {
    return next(error);
  }
}

async function create(req, res, next) {
  try {
    validatePayloadByResource(req.resourceName, req.body, 'create');
    const object = sanitizePayload(req.resourceConfig, req.body);

    if (req.resourceConfig.regionScoped && req.auth.role === 'user_region' && !req.auth.regions.includes(object.region_id)) {
      throw createHttpError(403, 'Regional user can only create records inside assigned regions');
    }

    if (req.resourceName === 'attachments' && !object.uploaded_by_user_id) {
      object.uploaded_by_user_id = req.auth.appUser.id;
    }

    if (req.resourceName === 'imports' && !object.created_by_user_id) {
      object.created_by_user_id = req.auth.appUser.id;
    }

    const item = await createResource(req.resourceConfig, object);
    await createAuditLog({
      actorUserId: req.auth.appUser.id,
      actionName: `create:${req.resourceName}`,
      entityType: req.resourceName,
      entityId: item.id,
      beforeData: null,
      afterData: item,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });
    return sendSuccess(res, item, `${req.resourceName} created successfully`, 201);
  } catch (error) {
    return next(error);
  }
}

async function update(req, res, next) {
  try {
    validatePayloadByResource(req.resourceName, req.body, 'update');
    const existing = await getResourceById(req.resourceConfig, req.params.id);

    if (!existing) {
      throw createHttpError(404, `${req.resourceName} not found`);
    }

    if (req.resourceConfig.regionScoped && req.auth.role === 'user_region') {
      const candidateRegionId = req.body.region_id || existing.region_id;
      if (!req.auth.regions.includes(candidateRegionId)) {
        throw createHttpError(403, 'Regional user can only modify records inside assigned regions');
      }
    }

    const changes = sanitizePayload(req.resourceConfig, req.body);
    const item = await updateResource(req.resourceConfig, req.params.id, changes);
    await createAuditLog({
      actorUserId: req.auth.appUser.id,
      actionName: `update:${req.resourceName}`,
      entityType: req.resourceName,
      entityId: item.id,
      beforeData: existing,
      afterData: item,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });
    return sendSuccess(res, item, `${req.resourceName} updated successfully`);
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

    if (req.resourceConfig.regionScoped && req.auth.role === 'user_region' && !req.auth.regions.includes(existing.region_id)) {
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

    await deleteResource(req.resourceConfig, req.params.id);
    await createAuditLog({
      actorUserId: req.auth.appUser.id,
      actionName: `delete:${req.resourceName}`,
      entityType: req.resourceName,
      entityId: existing.id,
      beforeData: existing,
      afterData: null,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });
    return sendSuccess(res, { id: req.params.id }, `${req.resourceName} deleted successfully`);
  } catch (error) {
    return next(error);
  }
}

module.exports = { list, getById, create, update, remove };

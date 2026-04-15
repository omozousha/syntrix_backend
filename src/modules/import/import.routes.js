const express = require('express');
const multer = require('multer');
const FormData = require('form-data');
const { authenticate, requireRole } = require('../../middleware/auth.middleware');
const { env } = require('../../config/env');
const { createHttpError } = require('../../utils/httpError');
const { sendSuccess } = require('../../utils/response');
const { nhostStorageClient } = require('../../config/nhost');
const { executeHasura } = require('../../config/hasura');
const { createAuditLog } = require('../../shared/audit.service');
const {
  IMPORT_FILE_CATEGORY,
  detectSourceFormat,
  parseSpreadsheet,
  parseKmlOrKmz,
  mapRowToEntity,
  validateMappedEntity,
  insertImportJob,
  insertImportRows,
  updateImportJob,
  bulkInsertEntity,
} = require('./import.service');

const importRouter = express.Router();

const allowedMimeTypes = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/vnd.google-earth.kml+xml',
  'application/vnd.google-earth.kmz',
  'application/octet-stream',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.maxUploadSizeMb * 1024 * 1024,
  },
  fileFilter(_req, file, callback) {
    const ext = (file.originalname.split('.').pop() || '').toLowerCase();
    if (!['xlsx', 'xls', 'csv', 'kml', 'kmz'].includes(ext) && !allowedMimeTypes.has(file.mimetype)) {
      return callback(createHttpError(400, 'Unsupported import file type'));
    }

    return callback(null, true);
  },
});

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || '').trim());
}

function getAllowedImportEntitiesByRole(role) {
  if (role === 'admin') {
    return env.importAllowedEntitiesAdmin;
  }

  if (role === 'user_all_region') {
    return env.importAllowedEntitiesUserAllRegion;
  }

  if (role === 'user_region') {
    return env.importAllowedEntitiesUserRegion;
  }

  return [];
}

async function resolveRegionReferences(rows) {
  const rawRefs = rows
    .map((row) => row.region_id)
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== '');

  const refs = [...new Set(rawRefs.map((value) => String(value).trim()))];
  const unresolvedNames = refs.filter((value) => !isUuid(value));

  if (!unresolvedNames.length) {
    return rows;
  }

  const query = `
    query ResolveRegions($names: [String!]) {
      regions(where: { _or: [{ region_name: { _in: $names } }, { region_id: { _in: $names } }] }) {
        id
        region_name
        region_id
      }
    }
  `;

  const data = await executeHasura(query, { names: unresolvedNames });
  const regionMap = new Map();

  for (const region of data.regions || []) {
    regionMap.set(String(region.region_name).trim().toLowerCase(), region.id);
    regionMap.set(String(region.region_id).trim().toLowerCase(), region.id);
  }

  return rows.map((row) => {
    const value = row.region_id;
    if (value == null || value === '') {
      return row;
    }

    const normalized = String(value).trim();
    if (isUuid(normalized)) {
      return row;
    }

    const resolved = regionMap.get(normalized.toLowerCase());
    return resolved ? { ...row, region_id: resolved } : row;
  });
}

async function storeImportAttachment(req, file, sourceFormat) {
  const bucketId = req.body.bucket_id || env.defaultStorageBucket;
  const formData = new FormData();
  formData.append('file[]', file.buffer, {
    filename: file.originalname,
    contentType: file.mimetype,
  });
  formData.append('bucket-id', bucketId);

  const uploadResponse = await nhostStorageClient.post('/files', formData, {
    headers: {
      ...formData.getHeaders(),
      Authorization: `Bearer ${req.auth.token}`,
    },
  });

  const storageFile = uploadResponse.data?.processedFiles?.[0] || uploadResponse.data;
  const extension = file.originalname.includes('.') ? file.originalname.split('.').pop().toLowerCase() : null;

  const mutation = `
    mutation InsertAttachment($object: attachments_insert_input!) {
      item: insert_attachments_one(object: $object) {
        id
        attachment_id
        storage_file_id
        bucket_id
        original_name
      }
    }
  `;

  const record = await executeHasura(mutation, {
    object: {
      bucket_id: bucketId,
      storage_file_id: storageFile.id,
      entity_type: 'import_job',
      entity_id: null,
      file_category: IMPORT_FILE_CATEGORY[sourceFormat] || 'document',
      original_name: file.originalname,
      stored_name: storageFile.name || file.originalname,
      mime_type: file.mimetype,
      extension,
      size_bytes: file.size,
      is_public: false,
      metadata: {
        source: 'nhost-storage',
        upload_response: storageFile,
      },
      uploaded_by_user_id: req.auth.appUser.id,
    },
  });

  return record.item;
}

importRouter.post('/ingest', authenticate, requireRole('admin', 'user_region', 'user_all_region'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      throw createHttpError(400, 'file is required');
    }

    const entityType = String(req.body.entity_type || '').trim();
    const allowedEntitiesForRole = getAllowedImportEntitiesByRole(req.auth.role);
    if (!allowedEntitiesForRole.includes(entityType)) {
      throw createHttpError(
        403,
        `entity_type ${entityType || '(empty)'} is not allowed for role ${req.auth.role}. Allowed: ${allowedEntitiesForRole.join(', ') || '(none)'}`,
      );
    }

    const sourceFormat = detectSourceFormat(req.file.originalname, req.file.mimetype);
    const applyImport = String(req.body.apply || 'false') === 'true';
    const defaults = {
      region_id: req.body.region_id || null,
      pop_id: req.body.pop_id || null,
      project_id: req.body.project_id || null,
    };

    let parsedRows;
    if (['xlsx', 'xls', 'csv'].includes(sourceFormat)) {
      parsedRows = parseSpreadsheet(req.file.buffer, sourceFormat);
    } else {
      parsedRows = parseKmlOrKmz(req.file.buffer, sourceFormat);
    }

    if (['devices', 'pops', 'projects'].includes(entityType)) {
      parsedRows = await resolveRegionReferences(parsedRows);
    }

    if (parsedRows.length > env.importMaxRows) {
      throw createHttpError(400, `Import file has ${parsedRows.length} rows, exceeds max IMPORT_MAX_ROWS=${env.importMaxRows}`);
    }

    const attachment = await storeImportAttachment(req, req.file, sourceFormat);
    const importJob = await insertImportJob({
      entity_type: entityType,
      source_format: sourceFormat,
      attachment_id: attachment.id,
      status: applyImport ? 'processing' : 'queued',
      total_rows: parsedRows.length,
      success_rows: 0,
      failed_rows: 0,
      mapping_config: { defaults, apply: applyImport },
      summary: {
        preview: parsedRows.slice(0, 5),
      },
      started_at: new Date().toISOString(),
      created_by_user_id: req.auth.appUser.id,
    });

    await insertImportRows(
      parsedRows.map((row, index) => ({
        import_job_id: importJob.id,
        row_number: index + 1,
        row_data: row,
        status: applyImport ? 'pending' : 'success',
        error_message: null,
      })),
    );

    let appliedRows = 0;
    if (applyImport && parsedRows.length) {
      const mappedObjects = parsedRows.map((row, index) => {
        const mapped = mapRowToEntity(entityType, row, defaults);
        validateMappedEntity(entityType, mapped, index);
        return mapped;
      });

      appliedRows = await bulkInsertEntity(entityType, mappedObjects);
    }

    const completedJob = await updateImportJob(importJob.id, {
      status: 'completed',
      success_rows: applyImport ? appliedRows : 0,
      failed_rows: applyImport ? Math.max(parsedRows.length - appliedRows, 0) : 0,
      completed_at: new Date().toISOString(),
      summary: {
        preview: parsedRows.slice(0, 5),
        parsed_count: parsedRows.length,
        applied_count: appliedRows,
      },
    });

    await createAuditLog({
      actorUserId: req.auth.appUser.id,
      actionName: applyImport ? `import:apply:${entityType}` : `import:preview:${entityType}`,
      entityType: 'import_job',
      entityId: importJob.id,
      beforeData: null,
      afterData: completedJob,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
    });

    return sendSuccess(
      res,
      {
        import_job: completedJob,
        attachment,
        preview_rows: parsedRows.slice(0, 5),
      },
      applyImport ? 'Import processed successfully' : 'Import preview created successfully',
      201,
    );
  } catch (error) {
    return next(
      createHttpError(
        error.statusCode || error.response?.status || 500,
        error.response?.data?.message || error.message || 'Import processing failed',
        error.response?.data || error.details,
      ),
    );
  }
});

module.exports = { importRouter };

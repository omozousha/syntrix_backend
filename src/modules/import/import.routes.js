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
  validateOdpImportRow,
  validateOdpTypeReferences,
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
    .map((row) => row.region_id || row.region || row['Region ID'] || row['Region'] || row['region'])
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== '');

  const refs = [...new Set(rawRefs.map((value) => String(value).trim()))];
  if (!refs.length) return rows;

  const query = `
    query ResolveAllRegions {
      regions {
        id
        region_id
        region_name
        region_code
      }
    }
  `;

  const data = await executeHasura(query);
  const regionMap = new Map();

  // Strict canonical lookup: the only acceptable in-row values are the
  // master region UUID, the regional registry id (region_id), the
  // region_code, or the literal regional_name. This avoids special-cased
  // substring aliases like "DKI" -> "DKI Jakarta" which previously let
  // operators submit ambiguous provincial labels and made debugging scope
  // violations harder.
  for (const region of data.regions || []) {
    const canonicalId = region.id || region.region_id;
    if (!canonicalId) continue;
    const regId = canonicalId;
    regionMap.set(String(region.id).trim().toLowerCase(), regId);
    if (region.region_id) {
      regionMap.set(String(region.region_id).trim().toLowerCase(), regId);
    }
    if (region.region_name) {
      regionMap.set(String(region.region_name).trim().toLowerCase(), regId);
    }
    if (region.region_code) {
      regionMap.set(String(region.region_code).trim().toLowerCase(), regId);
    }
  }

  return rows.map((row) => {
    const value = row.region_id || row.region || row['Region ID'] || row['Region'] || row['region'];
    if (value == null || value === '') return row;

    const normalized = String(value).trim().toLowerCase();
    if (isUuid(normalized)) {
      return { ...row, region_id: value };
    }

    const resolved = regionMap.get(normalized);
    return { ...row, region_id: resolved || value };
  });
}

// Canonical region map for richer error messages and stricter validation.
let canonicalRegionNamesByLower = new Map();
let canonicalRegionNamesById = new Map();
let canonicalRegionNamesLoadedAt = 0;
const CANONICAL_REGION_NAMES_REFRESH_MS = 5 * 60 * 1000;

async function loadCanonicalRegionNames() {
  if (
    canonicalRegionNamesById.size > 0 &&
    Date.now() - canonicalRegionNamesLoadedAt < CANONICAL_REGION_NAMES_REFRESH_MS
  ) {
    return canonicalRegionNamesById;
  }
  try {
    const query = `
      query ResolveRegionNames {
        regions {
          id
          region_id
          region_code
          region_name
        }
      }
    `;
    const data = await executeHasura(query);
    const byId = new Map();
    const byLower = new Map();
    for (const r of data.regions || []) {
      if (!r || !r.id || !r.region_name) continue;
      byId.set(String(r.id), String(r.region_name));
      const nameKey = String(r.region_name).trim().toLowerCase();
      if (nameKey) byLower.set(nameKey, { id: String(r.id), name: String(r.region_name) });
      if (r.region_code) {
        const codeKey = String(r.region_code).trim().toLowerCase();
        if (codeKey) byLower.set(codeKey, { id: String(r.id), name: String(r.region_name) });
      }
      if (r.region_id) {
        const codexKey = String(r.region_id).trim().toLowerCase();
        if (codexKey) byLower.set(codexKey, { id: String(r.id), name: String(r.region_name) });
      }
    }
    canonicalRegionNamesByLower = byLower;
    canonicalRegionNamesById = byId;
    canonicalRegionNamesLoadedAt = Date.now();
    return byId;
  } catch (error) {
    return canonicalRegionNamesById && canonicalRegionNamesById.size > 0
      ? canonicalRegionNamesById
      : new Map();
  }
}

async function resolvePopReferences(rows) {
  const rawRefs = rows
    .map((row) => row.pop_id || row.pop || row['POP ID'] || row['POP'] || row['pop'] || row['pop_code'] || row['POP Code'])
    .filter((value) => value !== undefined && value !== null && String(value).trim() !== '');

  const refs = [...new Set(rawRefs.map((value) => String(value).trim()))];
  if (!refs.length) return rows;

  const query = `
    query ResolveAllPops {
      pops {
        id
        pop_id
        pop_name
        pop_code
      }
    }
  `;

  const data = await executeHasura(query);
  const popMap = new Map();
  const unresolved = new Set();

  for (const pop of data.pops || []) {
    const popIdUuid = pop.id || pop.pop_id;
    popMap.set(String(pop.id).toLowerCase(), popIdUuid);
    popMap.set(String(pop.pop_id).toLowerCase(), popIdUuid);
    popMap.set(String(pop.pop_name).trim().toLowerCase(), popIdUuid);
    popMap.set(String(pop.pop_code).trim().toLowerCase(), popIdUuid);
  }

  return rows.map((row) => {
    const value = row.pop_id || row.pop || row['POP ID'] || row['POP'] || row['pop'] || row['pop_code'] || row['POP Code'];
    if (value == null || value === '') return row;

    const normalized = String(value).trim().toLowerCase();
    if (isUuid(normalized)) {
      return { ...row, pop_id: value };
    }

    const resolved = popMap.get(normalized);
    if (resolved) {
      return { ...row, pop_id: resolved };
    }
    // DO NOT fall back to the raw text — that would cause a UUID column
    // type mismatch at insert time and produce an opaque "invalid input
    // syntax for type uuid" error on Hasura. Mark unresolved so the
    // upstream check can surface a clear actionable error message.
    unresolved.add(String(value));
    return { ...row, _pop_unresolved: String(value) };
  }).map((row) => row);
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
    if (entityType === 'devices') {
      parsedRows = await resolvePopReferences(parsedRows);
      // Server-side validation for ODP imports: confirm any explicit `odp_type`
      // column values are registered in the master `odp_types` table. Failing
      // fast here gives operators an actionable message instead of opaque
      // Hasura constraint errors.
      await validateOdpTypeReferences(parsedRows);
    }

    // ODP bulk-import regional authorization:
    // - adminregion (user_all_region): every resolved region_id must be inside
    //   the user's allowed region scope.
    // - superadmin (admin): the file must resolve to exactly one unique region_id.
    // - any other role: untouched (validator already blocked by requireRole).
    if (entityType === 'devices' && applyImport && parsedRows.length) {
      // Collect ALL parsed region tokens (UUID or text label) and resolve
      // them against the canonical regions table so we can build a useful
      // actionable error message that includes both the offending raw
      // values and the master region_name (if it resolves). Without this
      // the operator is left guessing which row triggered the rejection.
      const regionTokens = parsedRows.map((row) => {
        const raw = row.region_id
          || row.region
          || row['Region ID']
          || row['Region'];
        const trimmed = raw == null ? '' : String(raw).trim();
        if (!trimmed) return null;
        return { raw: trimmed, isUuid: isUuid(trimmed) };
      }).filter(Boolean);

      const targetResolvedRegionIds = Array.from(
        new Set(
          regionTokens
            .filter((t) => t.isUuid)
            .map((t) => t.raw.trim()),
        ),
      );

      const canonicalRegionNames = await loadCanonicalRegionNames().catch(
        () => new Map(),
      );

      if (req.auth.role === 'user_all_region') {
        const allowed = new Set((req.auth.regions || []).filter(Boolean));
        const outOfScope = targetResolvedRegionIds.filter((id) => !allowed.has(id));
        if (outOfScope.length) {
          const labels = outOfScope.map(
            (id) => canonicalRegionNames.get(id) || id,
          );
          throw createHttpError(
            403,
            `adminregion hanya boleh mengimpor baris untuk region scope-nya. Region di luar scope: ${labels.join(', ')}.`,
          );
        }
      } else if (req.auth.role === 'admin') {
        // Resolve the per-row raw values into canonical regions,
        // collecting the distinct master region names any row landed on.
        const resolvedNames = new Set();
        for (const t of regionTokens) {
          if (t.isUuid) {
            const name = canonicalRegionNames.get(t.raw.trim());
            if (name) resolvedNames.add(name);
          } else {
            const key = t.raw.toLowerCase();
            const hit = canonicalRegionNamesByLower.get(key);
            if (hit) resolvedNames.add(hit.name);
          }
        }
        if (targetResolvedRegionIds.length === 0 && resolvedNames.size === 0) {
          throw createHttpError(
            400,
            'Berkas tidak memiliki kolom region yang dapat di-resolve; tidak dapat melakukan import untuk role admin.',
          );
        }
        if (resolvedNames.size > 1) {
          throw createHttpError(
            400,
            `Berkas berisi lebih dari satu region (${resolvedNames.size} region: ${Array.from(resolvedNames).join(', ')}). Untuk role admin, satu file harus berisi tepat satu region. Pisahkan per-region ke file terpisah.`,
          );
        }
      }
    }
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
        // For ODP imports, run the dedicated ODP-field validator first so
        // operators get a row-scoped actionable error listing every problem
        // instead of a generic Hasura constraint failure.
        const mappedDeviceTypeKey = String(
          row.device_type_key || row.device_type || row['Device Type'] || row['device type'] || '',
        )
          .trim()
          .toUpperCase();
        if (entityType === 'devices' && mappedDeviceTypeKey === 'ODP') {
          validateOdpImportRow(row, index);
        }
        const mapped = mapRowToEntity(entityType, row, defaults);
        validateMappedEntity(entityType, mapped, index);
        return mapped;
      });

      // Defensive check: surface a clear 400 error if any row references a POP
      // or Region identifier that could not be resolved to a UUID. This stops
      // opaque Hasura "invalid input syntax for type uuid" errors that would
      // otherwise hide the root cause from operators.
      if (entityType === 'devices') {
        const unresolvedPops = [];
        const unresolvedRegions = [];
        const originalRows = Array.isArray(parsedRows)
          ? parsedRows
          : Object.values(parsedRows);
        mappedObjects.forEach((mapped, idx) => {
          const row = originalRows[idx] || {};
          const popUnresolved = row._pop_unresolved;
          if (popUnresolved) {
            unresolvedPops.push(`Baris ${idx + 1}: POP "${popUnresolved}" tidak ditemukan`);
          } else {
            const originalPop =
              row.pop_id || row.pop || row['POP ID'] || row['POP'] || row.pop_code || row['POP Code'] || '';
            if (originalPop && !mapped.pop_id) {
              unresolvedPops.push(`Baris ${idx + 1}: POP "${originalPop}" tidak ditemukan`);
            }
          }
          const originalRegion =
            row.region_id || row.region || row['Region ID'] || row['Region'] || '';
          if (originalRegion && !mapped.region_id) {
            unresolvedRegions.push(`Baris ${idx + 1}: Region "${originalRegion}" tidak ditemukan`);
          }
        });
        const allUnresolved = [...unresolvedPops, ...unresolvedRegions];
        if (allUnresolved.length) {
          throw createHttpError(
            400,
            `Beberapa identifier POP/Region tidak ditemukan di database: ${allUnresolved.join('; ')}. Pastikan POP dan Region terdaftar dengan benar sebelum melakukan import.`,
          );
        }
      }

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

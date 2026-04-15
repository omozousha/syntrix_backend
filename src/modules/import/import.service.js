const path = require('path');
const XLSX = require('xlsx');
const AdmZip = require('adm-zip');
const { XMLParser } = require('fast-xml-parser');
const { executeHasura } = require('../../config/hasura');
const { createHttpError } = require('../../utils/httpError');

const IMPORT_FILE_CATEGORY = {
  xlsx: 'excel',
  xls: 'excel',
  csv: 'document',
  kml: 'kml',
  kmz: 'kmz',
};

function normalizeRows(rows = []) {
  return rows
    .filter((row) => row && Object.values(row).some((value) => value !== null && value !== undefined && String(value).trim() !== ''))
    .map((row) =>
      Object.entries(row).reduce((accumulator, [key, value]) => {
        accumulator[String(key).trim()] = value;
        return accumulator;
      }, {}),
    );
}

function parseSpreadsheet(buffer, extension) {
  if (extension === 'csv') {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return normalizeRows(XLSX.utils.sheet_to_json(sheet, { defval: null }));
  }

  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return normalizeRows(XLSX.utils.sheet_to_json(sheet, { defval: null }));
}

function ensureArray(value) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function pickCoordinateString(coordinates) {
  if (!coordinates) {
    return null;
  }

  if (Array.isArray(coordinates)) {
    return pickCoordinateString(coordinates[0]);
  }

  return String(coordinates).trim();
}

function parseCoordinateString(coordinateString) {
  if (!coordinateString) {
    return { longitude: null, latitude: null };
  }

  const [longitude, latitude] = coordinateString.split(',').map((item) => Number(item));
  return {
    longitude: Number.isFinite(longitude) ? longitude : null,
    latitude: Number.isFinite(latitude) ? latitude : null,
  };
}

function parseKmlText(xml) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    trimValues: true,
  });

  const parsed = parser.parse(xml);
  const root = parsed.kml || parsed;
  const placemarks = [];

  function collectPlacemark(node) {
    if (!node || typeof node !== 'object') {
      return;
    }

    if (node.Placemark) {
      placemarks.push(...ensureArray(node.Placemark));
    }

    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') {
        if (Array.isArray(value)) {
          value.forEach(collectPlacemark);
        } else {
          collectPlacemark(value);
        }
      }
    }
  }

  collectPlacemark(root);

  return placemarks.map((placemark, index) => {
    const coordinateString =
      pickCoordinateString(placemark.Point?.coordinates) ||
      pickCoordinateString(placemark.LineString?.coordinates) ||
      pickCoordinateString(placemark.Polygon?.outerBoundaryIs?.LinearRing?.coordinates);

    const { longitude, latitude } = parseCoordinateString(coordinateString);

    return {
      name: placemark.name || `Placemark ${index + 1}`,
      description: placemark.description || null,
      longitude,
      latitude,
      coordinates_raw: coordinateString,
      geometry_type: placemark.Point ? 'Point' : placemark.LineString ? 'LineString' : placemark.Polygon ? 'Polygon' : 'Unknown',
    };
  });
}

function parseKmlOrKmz(buffer, extension) {
  if (extension === 'kml') {
    return parseKmlText(buffer.toString('utf8'));
  }

  const zip = new AdmZip(buffer);
  const entry = zip
    .getEntries()
    .find((item) => !item.isDirectory && item.entryName.toLowerCase().endsWith('.kml'));

  if (!entry) {
    throw createHttpError(400, 'KMZ file does not contain any KML document');
  }

  return parseKmlText(entry.getData().toString('utf8'));
}

function detectSourceFormat(filename, mimetype) {
  const extension = path.extname(filename || '').replace('.', '').toLowerCase();
  const detected = extension || '';

  if (['xlsx', 'xls', 'csv', 'kml', 'kmz'].includes(detected)) {
    return detected;
  }

  if (mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    return 'xlsx';
  }

  if (mimetype === 'application/vnd.ms-excel') {
    return 'xls';
  }

  if (mimetype === 'application/vnd.google-earth.kml+xml') {
    return 'kml';
  }

  if (mimetype === 'application/vnd.google-earth.kmz') {
    return 'kmz';
  }

  throw createHttpError(400, 'Unsupported import file format');
}

function mapRowToEntity(entityType, row, defaults = {}) {
  const pick = (...keys) => keys.map((key) => row[key]).find((value) => value !== undefined && value !== null && String(value).trim() !== '');

  if (entityType === 'devices') {
    return {
      device_name: pick('device_name', 'Device Name', 'name', 'Name'),
      asset_group: pick('asset_group', 'Asset Group') || 'active',
      device_type_key: pick('device_type_key', 'device_type', 'Device Type') || 'OLT',
      region_id: pick('region_id', 'Region ID') || defaults.region_id || null,
      pop_id: pick('pop_id', 'POP ID') || defaults.pop_id || null,
      project_id: pick('project_id', 'Project ID') || defaults.project_id || null,
      category_asset: pick('category_asset', 'Category Asset') || null,
      bast_id: pick('bast_id', 'Bast ID') || null,
      status: pick('status', 'Status') || 'draft',
      longitude: pick('longitude', 'Longitude'),
      latitude: pick('latitude', 'Latitude'),
      address: pick('address', 'Address') || null,
      serial_number: pick('serial_number', 'Serial Number') || null,
      management_ip: pick('management_ip', 'Management IP') || null,
      total_ports: pick('total_ports', 'Total Ports'),
      used_ports: pick('used_ports', 'Used Ports'),
      capacity_core: pick('capacity_core', 'Capacity Core'),
      used_core: pick('used_core', 'Used Core'),
      splitter_ratio: pick('splitter_ratio', 'Splitter Ratio') || null,
      custom_fields: row,
    };
  }

  if (entityType === 'pops') {
    return {
      pop_name: pick('pop_name', 'POP Name', 'name', 'Name'),
      pop_code: pick('pop_code', 'POP Code', 'code', 'Code'),
      region_id: pick('region_id', 'Region ID') || defaults.region_id || null,
      longitude: pick('longitude', 'Longitude'),
      latitude: pick('latitude', 'Latitude'),
      address: pick('address', 'Address') || null,
      province: pick('province', 'Provinsi') || null,
      city: pick('city', 'Kota/Kabupaten') || null,
      status_pop: pick('status_pop', 'status_id', 'Status POP') || 'planning',
      pop_type: pick('pop_type', 'POP Type') || null,
      custom_fields: row,
    };
  }

  if (entityType === 'projects') {
    return {
      project_name: pick('project_name', 'Project Name', 'name', 'Name'),
      region_id: pick('region_id', 'Region ID') || defaults.region_id || null,
      pop_id: pick('pop_id', 'POP ID') || defaults.pop_id || null,
      status: pick('status', 'Status') || 'planning',
      description: pick('description', 'Description') || null,
      vendor_name: pick('vendor_name', 'Vendor Name') || null,
      custom_fields: row,
    };
  }

  if (entityType === 'regions') {
    return {
      region_name: pick('region_name', 'Region Name', 'name', 'Name'),
      region_color: pick('region_color', 'Region Color') || '#1D4ED8',
      description: pick('description', 'Description') || null,
      custom_fields: row,
    };
  }

  throw createHttpError(400, `Import apply is not yet supported for entity_type ${entityType}`);
}

function validateMappedEntity(entityType, mappedRow, index) {
  if (entityType === 'devices' && (!mappedRow.device_name || !mappedRow.region_id)) {
    throw createHttpError(400, `Row ${index + 1} is missing device_name or region_id`);
  }

  if (entityType === 'pops' && (!mappedRow.pop_name || !mappedRow.region_id || !mappedRow.pop_code)) {
    throw createHttpError(400, `Row ${index + 1} is missing pop_name or region_id or pop_code`);
  }

  if (entityType === 'projects' && (!mappedRow.project_name || !mappedRow.region_id)) {
    throw createHttpError(400, `Row ${index + 1} is missing project_name or region_id`);
  }

  if (entityType === 'regions' && !mappedRow.region_name) {
    throw createHttpError(400, `Row ${index + 1} is missing region_name`);
  }
}

async function insertImportJob(object) {
  const mutation = `
    mutation InsertImportJob($object: import_jobs_insert_input!) {
      item: insert_import_jobs_one(object: $object) {
        id
        import_job_id
        entity_type
        source_format
        status
        total_rows
        success_rows
        failed_rows
        created_at
      }
    }
  `;

  const data = await executeHasura(mutation, { object });
  return data.item;
}

async function insertImportRows(objects) {
  if (!objects.length) {
    return [];
  }

  const mutation = `
    mutation InsertImportRows($objects: [import_rows_insert_input!]!) {
      item: insert_import_rows(objects: $objects) {
        affected_rows
      }
    }
  `;

  return executeHasura(mutation, { objects });
}

async function updateImportJob(id, changes) {
  const mutation = `
    mutation UpdateImportJob($id: uuid!, $changes: import_jobs_set_input!) {
      item: update_import_jobs_by_pk(pk_columns: { id: $id }, _set: $changes) {
        id
        import_job_id
        entity_type
        source_format
        status
        total_rows
        success_rows
        failed_rows
        started_at
        completed_at
        summary
      }
    }
  `;

  const data = await executeHasura(mutation, { id, changes });
  return data.item;
}

async function bulkInsertEntity(entityType, objects) {
  const table = entityType;
  const mutation = `
    mutation BulkInsert($objects: [${table}_insert_input!]!) {
      item: insert_${table}(objects: $objects) {
        affected_rows
      }
    }
  `;

  const data = await executeHasura(mutation, { objects });
  return data.item.affected_rows;
}

module.exports = {
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
};

const { query: dbQuery } = require('../config/db');
const { createHttpError } = require('../utils/httpError');
const { normalizeRoleName, isRegionalRole, isSuperAdminRole } = require('../utils/roles');

function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function buildWhereClause(config, query, auth) {
  const normalizedRole = normalizeRoleName(auth.role);
  const conditions = [];
  const filterKeys = config.filterKeys || [];

  for (const key of filterKeys) {
    if (query[key] != null && query[key] !== '') {
      const rawValue = String(query[key]);
      if (rawValue === '__null__') {
        conditions.push(`${key} IS NULL`);
      } else if (key === 'validation_status' && rawValue === '__unvalidated__') {
        conditions.push(`(${key} IS NULL OR ${key} = '' OR ${key} = 'unvalidated')`);
      } else {
        conditions.push(`${key} = $${conditions.length + 1}`);
      }
    }
  }

  if (query.q && (config.searchColumns?.length || config.pk)) {
    const keyword = query.q.trim();
    const searchConditions = (config.searchColumns || []).map((col, idx) => `${col} ILIKE $${conditions.length + idx + 1}`);
    if (config.pk && isUuidLike(keyword)) {
      searchConditions.push(`${config.pk} = $${conditions.length + config.searchColumns.length + 1}`);
    }
    conditions.push(`(${searchConditions.join(' OR ')})`);
  }

  const ids = String(query.ids || '').split(',').map((v) => v.trim()).filter((v) => v && isUuidLike(v));
  if (ids.length) {
    conditions.push(`id = ANY($${conditions.length + 1}::uuid[])`);
  }

  if (config.table === 'audit_logs') {
    const actionNameIn = String(query.action_name_in || '').split(',').map((v) => v.trim()).filter(Boolean);
    if (actionNameIn.length) {
      conditions.push(`action_name = ANY($${conditions.length + 1}::text[])`);
    }

    const actionNameContains = String(query.action_name_contains || '').trim();
    if (actionNameContains) {
      conditions.push(`action_name ILIKE $${conditions.length + 1}`);
    }

    const requestId = String(query.request_id || '').trim();
    if (requestId) {
      conditions.push(`(before_data::jsonb @> $${conditions.length + 1}::jsonb OR after_data::jsonb @> $${conditions.length + 1}::jsonb)`);
    }

    const createdFrom = String(query.created_from || '').trim();
    if (createdFrom) {
      conditions.push(`created_at >= $${conditions.length + 1}`);
    }
    const createdTo = String(query.created_to || '').trim();
    if (createdTo) {
      conditions.push(`created_at <= $${conditions.length + 1}`);
    }
  }

  if (config.regionScoped && isRegionalRole(normalizedRole)) {
    if (!auth.regions.length) {
      throw createHttpError(403, 'This regional user does not have any assigned region');
    }
    conditions.push(`region_id = ANY($${conditions.length + 1}::uuid[])`);
  }

  if (config.table === 'app_users' && !isSuperAdminRole(normalizedRole)) {
    conditions.push('1 = 0');
  }

  if (config.softDelete) {
    const includeDeleted = String(query.include_deleted || '').toLowerCase() === 'true';
    const archivedOnly = String(query.archived_only || '').toLowerCase() === 'true';
    if (archivedOnly && isSuperAdminRole(normalizedRole)) {
      conditions.push('deleted_at IS NOT NULL');
    } else if (!includeDeleted || !isSuperAdminRole(normalizedRole)) {
      conditions.push('deleted_at IS NULL');
    }
  }

  return { whereSql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', paramIndex: conditions.length };
}

function buildParams(config, query, auth) {
  const params = [];
  const filterKeys = config.filterKeys || [];

  for (const key of filterKeys) {
    if (query[key] != null && query[key] !== '') {
      const rawValue = String(query[key]);
      if (rawValue === '__null__' || rawValue === '__unvalidated__') continue;
      params.push(query[key]);
    }
  }

  if (query.q && config.searchColumns?.length) {
    const keyword = query.q.trim();
    config.searchColumns.forEach(() => params.push(`%${keyword}%`));
    if (config.pk && isUuidLike(keyword)) params.push(keyword);
  }

  const ids = String(query.ids || '').split(',').map((v) => v.trim()).filter((v) => v && isUuidLike(v));
  if (ids.length) params.push(ids);

  if (config.table === 'audit_logs') {
    const actionNameIn = String(query.action_name_in || '').split(',').map((v) => v.trim()).filter(Boolean);
    if (actionNameIn.length) params.push(actionNameIn);

    const actionNameContains = String(query.action_name_contains || '').trim();
    if (actionNameContains) params.push(`%${actionNameContains}%`);

    const requestId = String(query.request_id || '').trim();
    if (requestId) params.push(`{"request_id":"${requestId}"}`);

    const createdFrom = String(query.created_from || '').trim();
    if (createdFrom) params.push(createdFrom);
    const createdTo = String(query.created_to || '').trim();
    if (createdTo) params.push(createdTo);
  }

  if (config.regionScoped && isRegionalRole(normalizeRoleName(auth.role))) {
    params.push(auth.regions);
  }

  return params;
}

async function enrichDeviceRelations(data) {
  if (!data?.items?.length) return data;

  const ids = data.items.map((item) => item.id).filter(Boolean);
  if (!ids.length) return data;

  try {
    const joinQuery = `
      SELECT
        d.id,
        json_build_object('id', r.id, 'region_id', r.region_id, 'region_name', r.region_name, 'region_color', r.region_color) as region,
        json_build_object('id', p.id, 'pop_id', p.pop_id, 'pop_name', p.pop_name, 'pop_code', p.pop_code) as pop,
        json_build_object('id', pr.id, 'project_id', pr.project_id, 'project_name', pr.project_name) as project,
        json_build_object('id', c.id, 'customer_id', c.customer_id, 'customer_name', c.customer_name) as customer,
        json_build_object('id', t.id, 'tenant_code', t.tenant_code, 'tenant_name', t.tenant_name) as tenant,
        json_build_object('id', mf.id, 'manufacturer_code', mf.manufacturer_code, 'manufacturer_name', mf.manufacturer_name) as manufacturer,
        json_build_object('id', b.id, 'brand_code', b.brand_code, 'brand_name', b.brand_name) as brand,
        json_build_object('id', am.id, 'model_code', am.model_code, 'model_name', am.model_name) as model,
        json_build_object('id', dt.id, 'device_type_key', dt.device_type_key, 'device_type_name', dt.device_type_name, 'asset_group', dt.asset_group) as device_type
      FROM public.devices d
      LEFT JOIN public.regions r ON r.id = d.region_id
      LEFT JOIN public.pops p ON p.id = d.pop_id
      LEFT JOIN public.projects pr ON pr.id = d.project_id
      LEFT JOIN public.customers c ON c.id = d.customer_id
      LEFT JOIN public.tenants t ON t.id = d.tenant_id
      LEFT JOIN public.manufacturers mf ON mf.id = d.manufacturer_id
      LEFT JOIN public.brands b ON b.id = d.brand_id
      LEFT JOIN public.asset_models am ON am.id = d.model_id
      LEFT JOIN public.device_type_catalog dt ON dt.device_type_key = d.device_type_key
      WHERE d.id = ANY($1::uuid[])
    `;

    const result = await dbQuery(joinQuery, [ids]);
    const rowsById = new Map(result.rows.map((row) => [row.id, row]));

    const mergeItem = (item) => {
      const row = rowsById.get(item.id);
      if (!row) return item;
      return {
        ...item,
        region: row.region && row.region.id ? row.region : item.region,
        pop: row.pop && row.pop.id ? row.pop : item.pop,
        project: row.project && row.project.id ? row.project : item.project,
        customer: row.customer && row.customer.id ? row.customer : item.customer,
        tenant: row.tenant && row.tenant.id ? row.tenant : item.tenant,
        manufacturer: row.manufacturer && row.manufacturer.id ? row.manufacturer : item.manufacturer,
        brand: row.brand && row.brand.id ? row.brand : item.brand,
        model: row.model && row.model.id ? row.model : item.model,
        device_type: row.device_type && row.device_type.id ? row.device_type : item.device_type,
      };
    };

    return { ...data, items: data.items.map(mergeItem) };
  } catch (err) {
    return data;
  }
}

async function enrichOptionalFields(config, data) {
  return data;
}

async function enrichResourceData(config, data) {
  let enriched = data;
  if (config.table === 'devices') {
    enriched = await enrichDeviceRelations(enriched);
  }
  return enriched;
}

async function listResources(config, options) {
  const limit = Math.min(Number(options.limit) || 20, 500);
  const offset = Math.max(Number(options.offset) || 0, 0);

  const fields = (config.listFields || []).join(', ');
  const querySource = {
    ...options,
    ...(options.where?._and ? flattenWhere(options.where._and) : {}),
  };

  const { whereSql, paramIndex } = buildWhereClause(config, querySource, options.auth || {});
  const params = buildParams(config, querySource, options.auth || {});

  const sql = `
    SELECT ${fields}
    FROM public.${config.table}
    ${whereSql}
    ORDER BY created_at DESC NULLS LAST
    LIMIT ${limit} OFFSET ${offset};
  `;

  const countSql = `
    SELECT COUNT(*)::int as count
    FROM public.${config.table}
    ${whereSql};
  `;

  const [data, countData] = await Promise.all([
    dbQuery(sql, params),
    dbQuery(countSql, params),
  ]);

  const result = {
    items: data.rows,
    aggregate: { aggregate: { count: countData.rows[0]?.count || 0 } },
  };

  return enrichResourceData(config, result);
}

function flattenWhere(conditions) {
  const result = {};
  for (const cond of conditions) {
    for (const [key, value] of Object.entries(cond)) {
      if (key === '_or') continue;
      if (key === '_and') continue;
      if (value && typeof value === 'object' && '_eq' in value) {
        result[key] = { _eq: value._eq };
      }
    }
  }
  return result;
}

async function getResourceById(config, id) {
  const fields = (config.listFields || []).join(', ');
  const result = await dbQuery(
    `SELECT ${fields} FROM public.${config.table} WHERE id = $1 LIMIT 1`,
    [id]
  );
  return result.rows[0] || null;
}

async function createResource(config, object) {
  const keys = Object.keys(object);
  const vals = Object.values(object);
  const placeholders = keys.map((_, i) => `$${i + 1}`);
  const fields = (config.listFields || []).join(', ');

  const result = await dbQuery(
    `INSERT INTO public.${config.table} (${keys.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING ${fields}`,
    vals
  );
  return result.rows[0];
}

async function updateResource(config, id, changes) {
  const keys = Object.keys(changes);
  const vals = Object.values(changes);
  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  const fields = (config.listFields || []).join(', ');

  const result = await dbQuery(
    `UPDATE public.${config.table} SET ${setClause}, updated_at = NOW() WHERE id = $${keys.length + 1} RETURNING ${fields}`,
    [...vals, id]
  );
  return result.rows[0];
}

async function deleteResource(config, id) {
  const result = await dbQuery(
    `DELETE FROM public.${config.table} WHERE id = $1 RETURNING id`,
    [id]
  );
  return result.rows[0] || null;
}

module.exports = {
  buildWhereClause,
  listResources,
  getResourceById,
  createResource,
  updateResource,
  deleteResource,
};

const { ensureHasuraTableTracked, executeHasura, executeHasuraSql } = require('../config/hasura');
const { createHttpError } = require('../utils/httpError');
const { normalizeRoleName, isRegionalRole, isSuperAdminRole } = require('../utils/roles');

function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function buildWhereClause(config, query, auth) {
  const normalizedRole = normalizeRoleName(auth.role);
  const andConditions = [];
  const filterKeys = config.filterKeys || [];

  for (const key of filterKeys) {
    if (query[key] != null && query[key] !== '') {
      andConditions.push({ [key]: { _eq: query[key] } });
    }
  }

  if (query.q && (config.searchColumns?.length || config.pk)) {
    const keyword = query.q.trim();
    const searchConditions = (config.searchColumns || []).map((column) => ({
      [column]: { _ilike: `%${keyword}%` },
    }));
    if (config.pk && isUuidLike(keyword)) {
      searchConditions.push({ [config.pk]: { _eq: keyword } });
    }

    andConditions.push({
      _or: searchConditions,
    });
  }

  if (config.table === 'audit_logs') {
    const requestId = String(query.request_id || '').trim();
    if (requestId) {
      andConditions.push({
        _or: [
          { before_data: { _contains: { request_id: requestId } } },
          { after_data: { _contains: { request_id: requestId } } },
        ],
      });
    }
  }

  if (config.regionScoped && isRegionalRole(normalizedRole)) {
    if (!auth.regions.length) {
      throw createHttpError(403, 'This regional user does not have any assigned region');
    }

    andConditions.push({ region_id: { _in: auth.regions } });
  }

  if (config.table === 'app_users' && !isSuperAdminRole(normalizedRole)) {
    andConditions.push({ id: { _eq: '__forbidden__' } });
  }

  if (config.softDelete) {
    const includeDeleted = String(query.include_deleted || '').toLowerCase() === 'true';
    const archivedOnly = String(query.archived_only || '').toLowerCase() === 'true';
    if (archivedOnly && isSuperAdminRole(normalizedRole)) {
      andConditions.push({ deleted_at: { _is_null: false } });
    } else if (!includeDeleted || !isSuperAdminRole(normalizedRole)) {
      andConditions.push({ deleted_at: { _is_null: true } });
    }
  }

  return andConditions.length ? { _and: andConditions } : {};
}

function sanitizePayload(config, payload) {
  return config.insertFields.concat(config.updateFields).reduce((accumulator, field) => {
    if (payload[field] !== undefined) {
      accumulator[field] = payload[field];
    }

    return accumulator;
  }, {});
}

function isUntrackedTableError(error, tableName) {
  const haystack = [
    error?.message,
    ...(error?.details || []).map((detail) => detail?.message),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(`field '${tableName}' not found`) || haystack.includes(`field "${tableName}" not found`);
}

function buildSelectionFields(config, includeOptional = true) {
  const fields = includeOptional
    ? config.listFields.concat(config.optionalListFields || [])
    : config.listFields;

  return Array.from(new Set(fields)).join('\n        ');
}

function isOptionalFieldError(error, config) {
  const optionalFields = config.optionalListFields || [];
  if (!optionalFields.length) return false;

  const haystack = [
    error?.message,
    ...(error?.details || []).map((detail) => detail?.message),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return optionalFields.some((field) => {
    const normalizedField = String(field).toLowerCase();
    return (
      haystack.includes(`field '${normalizedField}' not found`)
      || haystack.includes(`field "${normalizedField}" not found`)
      || haystack.includes(`cannot query field "${normalizedField}"`)
      || haystack.includes(`cannot query field '${normalizedField}'`)
    );
  });
}

function sqlLiteral(value) {
  if (value == null || value === '') return 'null';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlBoolean(value) {
  if (value == null || value === '') return 'null';
  return String(value).toLowerCase() === 'true' ? 'true' : 'false';
}

function sqlInteger(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? String(parsed) : String(fallback);
}

function mapSqlRows(result) {
  const rows = result?.result || [];
  const headers = rows[0] || [];
  return rows.slice(1).map((row) => headers.reduce((accumulator, header, index) => {
    accumulator[header] = row[index] === '' ? null : row[index];
    return accumulator;
  }, {}));
}

async function enrichOptionalFieldsWithSql(config, data) {
  const optionalFields = config.optionalListFields || [];
  if (!optionalFields.length || !data) return data;

  const sourceItems = data.items || (data.item ? [data.item] : []);
  const ids = Array.from(new Set(sourceItems.map((item) => item?.id).filter(Boolean)));
  if (!ids.length) return data;

  if (config.table === 'regions' && optionalFields.includes('inventory_region_code')) {
    try {
      const rows = mapSqlRows(await executeHasuraSql(`
        select
          r.id::text,
          coalesce(
            irc.region_code,
            case
              when regexp_replace(lower(coalesce(r.region_name, '')), '[^a-z0-9]+', '', 'g') = 'banten' then '01'
              when regexp_replace(lower(coalesce(r.region_name, '')), '[^a-z0-9]+', '', 'g') in ('jabo', 'jabodebek', 'jabodetabek') then '02'
              when regexp_replace(lower(coalesce(r.region_name, '')), '[^a-z0-9]+', '', 'g') in ('jabar', 'jawabarat') then '03'
              when regexp_replace(lower(coalesce(r.region_name, '')), '[^a-z0-9]+', '', 'g') in ('jateng', 'jawatengah') then '04'
              when regexp_replace(lower(coalesce(r.region_name, '')), '[^a-z0-9]+', '', 'g') in ('jatim', 'jawatimur', 'jatimkal', 'jawatimurkalimantan', 'jatimkalimantan') then '05'
              when regexp_replace(lower(coalesce(r.region_name, '')), '[^a-z0-9]+', '', 'g') = 'sulawesi' then '06'
              when regexp_replace(lower(coalesce(r.region_name, '')), '[^a-z0-9]+', '', 'g') = 'bali' then '07'
            end
          ) as inventory_region_code
        from public.regions r
        left join public.inventory_region_codes irc on irc.region_id = r.id
        where r.id in (${ids.map((id) => `${sqlLiteral(id)}::uuid`).join(', ')});
      `));
      const rowsById = new Map(rows.map((row) => [row.id, row]));
      const mergeItem = (item) => (item?.id && rowsById.has(item.id) ? { ...item, ...rowsById.get(item.id) } : item);

      if (data.items) return { ...data, items: data.items.map(mergeItem) };
      if (data.item) return { ...data, item: mergeItem(data.item) };
    } catch (error) {
      return data;
    }
  }

  try {
    const rows = mapSqlRows(await executeHasuraSql(`
      select id::text, ${optionalFields.join(', ')}
      from public.${config.table}
      where id in (${ids.map((id) => `${sqlLiteral(id)}::uuid`).join(', ')});
    `));
    const rowsById = new Map(rows.map((row) => [row.id, row]));
    const mergeItem = (item) => (item?.id && rowsById.has(item.id) ? { ...item, ...rowsById.get(item.id) } : item);

    if (data.items) {
      return { ...data, items: data.items.map(mergeItem) };
    }

    if (data.item) {
      return { ...data, item: mergeItem(data.item) };
    }
  } catch (error) {
    return data;
  }

  return data;
}

function normalizeRouteTypeRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    route_type_id: row.route_type_id,
    route_type_code: row.route_type_code,
    route_type_name: row.route_type_name,
    description: row.description,
    sort_order: Number(row.sort_order || 0),
    is_active: row.is_active === true || row.is_active === 't',
    deleted_at: row.deleted_at,
    deleted_by_user_id: row.deleted_by_user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const ROUTE_TYPE_SELECT_FIELDS = `
  id::text,
  route_type_id,
  route_type_code,
  route_type_name,
  description,
  sort_order::text,
  is_active::text,
  deleted_at::text,
  deleted_by_user_id::text,
  created_at::text,
  updated_at::text
`;

function buildRouteTypesWhere(options = {}) {
  const filters = [];
  const where = options.where?._and || [];
  const includeDeleted = where.some((condition) => condition.deleted_at?._is_null === false);
  if (!includeDeleted) filters.push('deleted_at is null');

  for (const condition of where) {
    if (condition.is_active?._eq != null) {
      filters.push(`is_active = ${sqlBoolean(condition.is_active._eq)}`);
    }
    if (condition._or) {
      const search = condition._or
        .map((item) => Object.values(item)[0]?._ilike)
        .find(Boolean);
      if (search) {
        const q = String(search).replace(/^%|%$/g, '');
        filters.push(`(route_type_code ilike ${sqlLiteral(`%${q}%`)} or route_type_name ilike ${sqlLiteral(`%${q}%`)} or description ilike ${sqlLiteral(`%${q}%`)})`);
      }
    }
  }

  return filters.length ? `where ${filters.join(' and ')}` : '';
}

async function listRouteTypesWithSql(options = {}) {
  const limit = Math.min(Number(options.limit) || 20, 500);
  const offset = Math.max(Number(options.offset) || 0, 0);
  const whereSql = buildRouteTypesWhere(options);
  const data = await executeHasuraSql(`
    select ${ROUTE_TYPE_SELECT_FIELDS}
    from public.route_types
    ${whereSql}
    order by sort_order asc, route_type_name asc
    limit ${limit}
    offset ${offset};
  `);
  const countData = await executeHasuraSql(`
    select count(*)::text as count
    from public.route_types
    ${whereSql};
  `);

  return {
    items: mapSqlRows(data).map(normalizeRouteTypeRow),
    aggregate: {
      aggregate: {
        count: Number(mapSqlRows(countData)[0]?.count || 0),
      },
    },
  };
}

async function getRouteTypeByIdWithSql(id) {
  const data = await executeHasuraSql(`
    select ${ROUTE_TYPE_SELECT_FIELDS}
    from public.route_types
    where id = ${sqlLiteral(id)}::uuid
    limit 1;
  `);
  return normalizeRouteTypeRow(mapSqlRows(data)[0]);
}

async function createRouteTypeWithSql(object) {
  const data = await executeHasuraSql(`
    insert into public.route_types (
      route_type_code,
      route_type_name,
      description,
      sort_order,
      is_active
    )
    values (
      ${sqlLiteral(object.route_type_code)},
      ${sqlLiteral(object.route_type_name)},
      ${sqlLiteral(object.description)},
      ${sqlInteger(object.sort_order)},
      ${sqlBoolean(object.is_active ?? true)}
    )
    returning ${ROUTE_TYPE_SELECT_FIELDS};
  `);
  return normalizeRouteTypeRow(mapSqlRows(data)[0]);
}

async function updateRouteTypeWithSql(id, changes) {
  const sets = [];
  if (Object.prototype.hasOwnProperty.call(changes, 'route_type_code')) sets.push(`route_type_code = ${sqlLiteral(changes.route_type_code)}`);
  if (Object.prototype.hasOwnProperty.call(changes, 'route_type_name')) sets.push(`route_type_name = ${sqlLiteral(changes.route_type_name)}`);
  if (Object.prototype.hasOwnProperty.call(changes, 'description')) sets.push(`description = ${sqlLiteral(changes.description)}`);
  if (Object.prototype.hasOwnProperty.call(changes, 'sort_order')) sets.push(`sort_order = ${sqlInteger(changes.sort_order)}`);
  if (Object.prototype.hasOwnProperty.call(changes, 'is_active')) sets.push(`is_active = ${sqlBoolean(changes.is_active)}`);
  if (Object.prototype.hasOwnProperty.call(changes, 'deleted_at')) sets.push(`deleted_at = ${changes.deleted_at ? sqlLiteral(changes.deleted_at) : 'null'}`);
  if (Object.prototype.hasOwnProperty.call(changes, 'deleted_by_user_id')) sets.push(`deleted_by_user_id = ${changes.deleted_by_user_id ? `${sqlLiteral(changes.deleted_by_user_id)}::uuid` : 'null'}`);
  sets.push('updated_at = now()');

  const data = await executeHasuraSql(`
    update public.route_types
    set ${sets.join(', ')}
    where id = ${sqlLiteral(id)}::uuid
    returning ${ROUTE_TYPE_SELECT_FIELDS};
  `);
  return normalizeRouteTypeRow(mapSqlRows(data)[0]);
}

async function deleteRouteTypeWithSql(id) {
  const data = await executeHasuraSql(`
    delete from public.route_types
    where id = ${sqlLiteral(id)}::uuid
    returning id::text;
  `);
  return mapSqlRows(data)[0] || null;
}

function getMasterOptionSqlMeta(config) {
  if (config.table === 'odp_types') {
    return {
      table: 'odp_types',
      codeColumn: 'odp_type_code',
      nameColumn: 'odp_type_name',
    };
  }
  if (config.table === 'installation_types') {
    return {
      table: 'installation_types',
      codeColumn: 'installation_type_code',
      nameColumn: 'installation_type_name',
    };
  }
  return null;
}

function normalizeMasterOptionRow(row, meta) {
  if (!row) return null;
  return {
    id: row.id,
    [meta.codeColumn]: row[meta.codeColumn],
    [meta.nameColumn]: row[meta.nameColumn],
    description: row.description,
    sort_order: Number(row.sort_order || 0),
    is_active: row.is_active === true || row.is_active === 't',
    deleted_at: row.deleted_at,
    deleted_by_user_id: row.deleted_by_user_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function buildMasterOptionSelectFields(meta) {
  return `
    id::text,
    ${meta.codeColumn},
    ${meta.nameColumn},
    description,
    sort_order::text,
    is_active::text,
    deleted_at::text,
    deleted_by_user_id::text,
    created_at::text,
    updated_at::text
  `;
}

function buildMasterOptionWhere(options = {}, meta) {
  const filters = [];
  const where = options.where?._and || [];
  const includeDeleted = where.some((condition) => condition.deleted_at?._is_null === false);
  if (!includeDeleted) filters.push('deleted_at is null');

  for (const condition of where) {
    if (condition.is_active?._eq != null) {
      filters.push(`is_active = ${sqlBoolean(condition.is_active._eq)}`);
    }
    if (condition._or) {
      const search = condition._or
        .map((item) => Object.values(item)[0]?._ilike)
        .find(Boolean);
      if (search) {
        const q = String(search).replace(/^%|%$/g, '');
        filters.push(`(${meta.codeColumn} ilike ${sqlLiteral(`%${q}%`)} or ${meta.nameColumn} ilike ${sqlLiteral(`%${q}%`)} or description ilike ${sqlLiteral(`%${q}%`)})`);
      }
    }
  }

  return filters.length ? `where ${filters.join(' and ')}` : '';
}

async function listMasterOptionsWithSql(config, options = {}) {
  const meta = getMasterOptionSqlMeta(config);
  if (!meta) return undefined;

  const limit = Math.min(Number(options.limit) || 20, 500);
  const offset = Math.max(Number(options.offset) || 0, 0);
  const whereSql = buildMasterOptionWhere(options, meta);
  const selectFields = buildMasterOptionSelectFields(meta);
  const data = await executeHasuraSql(`
    select ${selectFields}
    from public.${meta.table}
    ${whereSql}
    order by sort_order asc, ${meta.nameColumn} asc
    limit ${limit}
    offset ${offset};
  `);
  const countData = await executeHasuraSql(`
    select count(*)::text as count
    from public.${meta.table}
    ${whereSql};
  `);

  return {
    items: mapSqlRows(data).map((row) => normalizeMasterOptionRow(row, meta)),
    aggregate: {
      aggregate: {
        count: Number(mapSqlRows(countData)[0]?.count || 0),
      },
    },
  };
}

async function getMasterOptionByIdWithSql(config, id) {
  const meta = getMasterOptionSqlMeta(config);
  if (!meta) return undefined;

  const data = await executeHasuraSql(`
    select ${buildMasterOptionSelectFields(meta)}
    from public.${meta.table}
    where id = ${sqlLiteral(id)}::uuid
    limit 1;
  `);
  return normalizeMasterOptionRow(mapSqlRows(data)[0], meta);
}

async function createMasterOptionWithSql(config, object) {
  const meta = getMasterOptionSqlMeta(config);
  if (!meta) return undefined;

  const data = await executeHasuraSql(`
    insert into public.${meta.table} (
      ${meta.codeColumn},
      ${meta.nameColumn},
      description,
      sort_order,
      is_active
    )
    values (
      ${sqlLiteral(object[meta.codeColumn])},
      ${sqlLiteral(object[meta.nameColumn])},
      ${sqlLiteral(object.description)},
      ${sqlInteger(object.sort_order)},
      ${sqlBoolean(object.is_active ?? true)}
    )
    returning ${buildMasterOptionSelectFields(meta)};
  `);
  return normalizeMasterOptionRow(mapSqlRows(data)[0], meta);
}

async function updateMasterOptionWithSql(config, id, changes) {
  const meta = getMasterOptionSqlMeta(config);
  if (!meta) return undefined;

  const sets = [];
  if (Object.prototype.hasOwnProperty.call(changes, meta.codeColumn)) sets.push(`${meta.codeColumn} = ${sqlLiteral(changes[meta.codeColumn])}`);
  if (Object.prototype.hasOwnProperty.call(changes, meta.nameColumn)) sets.push(`${meta.nameColumn} = ${sqlLiteral(changes[meta.nameColumn])}`);
  if (Object.prototype.hasOwnProperty.call(changes, 'description')) sets.push(`description = ${sqlLiteral(changes.description)}`);
  if (Object.prototype.hasOwnProperty.call(changes, 'sort_order')) sets.push(`sort_order = ${sqlInteger(changes.sort_order)}`);
  if (Object.prototype.hasOwnProperty.call(changes, 'is_active')) sets.push(`is_active = ${sqlBoolean(changes.is_active)}`);
  if (Object.prototype.hasOwnProperty.call(changes, 'deleted_at')) sets.push(`deleted_at = ${changes.deleted_at ? sqlLiteral(changes.deleted_at) : 'null'}`);
  if (Object.prototype.hasOwnProperty.call(changes, 'deleted_by_user_id')) sets.push(`deleted_by_user_id = ${changes.deleted_by_user_id ? `${sqlLiteral(changes.deleted_by_user_id)}::uuid` : 'null'}`);
  sets.push('updated_at = now()');

  const data = await executeHasuraSql(`
    update public.${meta.table}
    set ${sets.join(', ')}
    where id = ${sqlLiteral(id)}::uuid
    returning ${buildMasterOptionSelectFields(meta)};
  `);
  return normalizeMasterOptionRow(mapSqlRows(data)[0], meta);
}

async function deleteMasterOptionWithSql(config, id) {
  const meta = getMasterOptionSqlMeta(config);
  if (!meta) return undefined;

  const data = await executeHasuraSql(`
    delete from public.${meta.table}
    where id = ${sqlLiteral(id)}::uuid
    returning id::text;
  `);
  return mapSqlRows(data)[0] || null;
}

async function executeResourceHasura(config, query, variables = {}) {
  try {
    return await executeHasura(query, variables);
  } catch (error) {
    if (!config.autoTrack || !isUntrackedTableError(error, config.table)) {
      throw error;
    }

    await ensureHasuraTableTracked(config.table);
    return executeHasura(query, variables);
  }
}

async function executeRouteTypeFallback(config, operation, payload) {
  if (config.table !== 'route_types') return undefined;
  if (operation === 'list') return listRouteTypesWithSql(payload);
  if (operation === 'get') return getRouteTypeByIdWithSql(payload.id);
  if (operation === 'create') return createRouteTypeWithSql(payload.object);
  if (operation === 'update') return updateRouteTypeWithSql(payload.id, payload.changes);
  if (operation === 'delete') return deleteRouteTypeWithSql(payload.id);
  return undefined;
}

async function executeSqlFallback(config, operation, payload) {
  const routeTypeFallback = await executeRouteTypeFallback(config, operation, payload);
  if (routeTypeFallback !== undefined) return routeTypeFallback;

  if (operation === 'list') return listMasterOptionsWithSql(config, payload);
  if (operation === 'get') return getMasterOptionByIdWithSql(config, payload.id);
  if (operation === 'create') return createMasterOptionWithSql(config, payload.object);
  if (operation === 'update') return updateMasterOptionWithSql(config, payload.id, payload.changes);
  if (operation === 'delete') return deleteMasterOptionWithSql(config, payload.id);
  return undefined;
}

async function listResources(config, options) {
  const buildQuery = (includeOptional = true) => `
    query ListResource($where: ${config.table}_bool_exp!, $limit: Int!, $offset: Int!, $orderBy: [${config.table}_order_by!]) {
      items: ${config.table}(where: $where, limit: $limit, offset: $offset, order_by: $orderBy) {
        ${buildSelectionFields(config, includeOptional)}
      }
      aggregate: ${config.table}_aggregate(where: $where) {
        aggregate {
          count
        }
      }
    }
  `;

  try {
    const data = await executeResourceHasura(config, buildQuery(true), options);
    return data;
  } catch (error) {
    if (isOptionalFieldError(error, config)) {
      const data = await executeResourceHasura(config, buildQuery(false), options);
      return enrichOptionalFieldsWithSql(config, data);
    }

    const fallback = await executeSqlFallback(config, 'list', options);
    if (fallback !== undefined) return fallback;
    throw error;
  }
}

async function getResourceById(config, id) {
  if (config.table === 'attachments') {
    const identifier = String(id || '').trim();
    if (!identifier) return null;

    if (isUuidLike(identifier)) {
      const queryByPk = `
        query GetAttachmentByPk($id: uuid!) {
          item: attachments_by_pk(id: $id) {
            ${config.listFields.join('\n        ')}
          }
        }
      `;
      const dataByPk = await executeResourceHasura(config, queryByPk, { id: identifier });
      if (dataByPk.item) return dataByPk.item;

      const queryByStorageId = `
        query GetAttachmentByStorageId($storageId: uuid!) {
          items: attachments(
            where: { storage_file_id: { _eq: $storageId } }
            limit: 1
          ) {
            ${config.listFields.join('\n        ')}
          }
        }
      `;
      const dataByStorage = await executeResourceHasura(config, queryByStorageId, { storageId: identifier });
      if (dataByStorage.items?.[0]) return dataByStorage.items[0];
    }

    const queryByCode = `
      query GetAttachmentByCode($attachmentCode: String!) {
        items: attachments(
          where: { attachment_id: { _eq: $attachmentCode } }
          limit: 1
        ) {
          ${config.listFields.join('\n        ')}
        }
      }
    `;
    const dataByCode = await executeResourceHasura(config, queryByCode, { attachmentCode: identifier });
    return dataByCode.items?.[0] || null;
  }

  const buildQuery = (includeOptional = true) => `
    query GetResource($id: uuid!) {
      item: ${config.table}_by_pk(id: $id) {
        ${buildSelectionFields(config, includeOptional)}
      }
    }
  `;

  try {
    const data = await executeResourceHasura(config, buildQuery(true), { id });
    return data.item;
  } catch (error) {
    if (isOptionalFieldError(error, config)) {
      const data = await executeResourceHasura(config, buildQuery(false), { id });
      const enriched = await enrichOptionalFieldsWithSql(config, data);
      return enriched.item;
    }

    const fallback = await executeSqlFallback(config, 'get', { id });
    if (fallback !== undefined) return fallback;
    throw error;
  }
}

async function createResource(config, object) {
  const buildQuery = (includeOptional = true) => `
    mutation CreateResource($object: ${config.table}_insert_input!) {
      item: insert_${config.table}_one(object: $object) {
        ${buildSelectionFields(config, includeOptional)}
      }
    }
  `;

  try {
    const data = await executeResourceHasura(config, buildQuery(true), { object });
    return data.item;
  } catch (error) {
    if (isOptionalFieldError(error, config)) {
      const data = await executeResourceHasura(config, buildQuery(false), { object });
      const enriched = await enrichOptionalFieldsWithSql(config, data);
      return enriched.item;
    }

    const fallback = await executeSqlFallback(config, 'create', { object });
    if (fallback !== undefined) return fallback;
    throw error;
  }
}

async function updateResource(config, id, changes) {
  const buildQuery = (includeOptional = true) => `
    mutation UpdateResource($id: uuid!, $changes: ${config.table}_set_input!) {
      item: update_${config.table}_by_pk(pk_columns: { id: $id }, _set: $changes) {
        ${buildSelectionFields(config, includeOptional)}
      }
    }
  `;

  try {
    const data = await executeResourceHasura(config, buildQuery(true), { id, changes });
    return data.item;
  } catch (error) {
    if (isOptionalFieldError(error, config)) {
      const data = await executeResourceHasura(config, buildQuery(false), { id, changes });
      const enriched = await enrichOptionalFieldsWithSql(config, data);
      return enriched.item;
    }

    const fallback = await executeSqlFallback(config, 'update', { id, changes });
    if (fallback !== undefined) return fallback;
    throw error;
  }
}

async function deleteResource(config, id) {
  const query = `
    mutation DeleteResource($id: uuid!) {
      item: delete_${config.table}_by_pk(id: $id) {
        id
      }
    }
  `;

  try {
    const data = await executeResourceHasura(config, query, { id });
    return data.item;
  } catch (error) {
    const fallback = await executeSqlFallback(config, 'delete', { id });
    if (fallback !== undefined) return fallback;
    throw error;
  }
}

module.exports = {
  buildWhereClause,
  sanitizePayload,
  listResources,
  getResourceById,
  createResource,
  updateResource,
  deleteResource,
};

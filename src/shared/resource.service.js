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

async function getExistingPublicTables(tableNames) {
  const normalized = Array.from(new Set(tableNames.map((name) => String(name || '').trim()).filter(Boolean)));
  if (!normalized.length) return new Set();

  const rows = mapSqlRows(await executeHasuraSql(`
    select table_name
    from information_schema.tables
    where table_schema = 'public'
      and table_name in (${normalized.map(sqlLiteral).join(', ')});
  `));

  return new Set(rows.map((row) => row.table_name));
}

function compactRelation(object) {
  if (!object || !object.id) return null;
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== '')
  );
}

async function enrichDeviceRelationsWithSql(data) {
  if (!data) return data;

  const sourceItems = data.items || (data.item ? [data.item] : []);
  const ids = Array.from(new Set(sourceItems.map((item) => item?.id).filter(Boolean)));
  if (!ids.length) return data;

  try {
    const existingTables = await getExistingPublicTables([
      'regions',
      'pops',
      'projects',
      'customers',
      'tenants',
      'manufacturers',
      'brands',
      'asset_models',
      'device_type_catalog',
    ]);

    const selectFields = ['d.id::text'];
    const joins = [];

    if (existingTables.has('regions')) {
      joins.push('left join public.regions r on r.id = d.region_id');
      selectFields.push(
        'r.id::text as region_ref_id',
        'r.region_id as region_code',
        'r.region_name as region_name',
        'r.region_color as region_color'
      );
    }

    if (existingTables.has('pops')) {
      joins.push('left join public.pops p on p.id = d.pop_id');
      selectFields.push(
        'p.id::text as pop_ref_id',
        'p.pop_id as pop_inventory_id',
        'p.pop_name as pop_name',
        'p.pop_code as pop_code',
        'p.region_id::text as pop_region_id'
      );
    }

    if (existingTables.has('projects')) {
      joins.push('left join public.projects pr on pr.id = d.project_id');
      selectFields.push(
        'pr.id::text as project_ref_id',
        'pr.project_id as project_inventory_id',
        'pr.project_code as project_code',
        'pr.project_name as project_name'
      );
    }

    if (existingTables.has('customers')) {
      joins.push('left join public.customers c on c.id = d.customer_id');
      selectFields.push(
        'c.id::text as customer_ref_id',
        'c.customer_id as customer_inventory_id',
        'c.customer_code as customer_code',
        'c.customer_name as customer_name',
        'c.customer_number as customer_number'
      );
    }

    if (existingTables.has('tenants')) {
      joins.push('left join public.tenants t on t.id = d.tenant_id');
      selectFields.push(
        't.id::text as tenant_ref_id',
        't.tenant_code as tenant_code',
        't.tenant_name as tenant_name'
      );
    }

    if (existingTables.has('manufacturers')) {
      joins.push('left join public.manufacturers mf on mf.id = d.manufacturer_id');
      selectFields.push(
        'mf.id::text as manufacturer_ref_id',
        'mf.manufacturer_code as manufacturer_code',
        'mf.manufacturer_name as manufacturer_name'
      );
    }

    if (existingTables.has('brands')) {
      joins.push('left join public.brands b on b.id = d.brand_id');
      selectFields.push(
        'b.id::text as brand_ref_id',
        'b.brand_code as brand_code',
        'b.brand_name as brand_name',
        'b.manufacturer_id::text as brand_manufacturer_id'
      );
    }

    if (existingTables.has('asset_models')) {
      joins.push('left join public.asset_models am on am.id = d.model_id');
      selectFields.push(
        'am.id::text as model_ref_id',
        'am.model_code as model_code',
        'am.model_name as model_name',
        'am.brand_id::text as model_brand_id',
        'am.manufacturer_id::text as model_manufacturer_id'
      );
    }

    if (existingTables.has('device_type_catalog')) {
      joins.push('left join public.device_type_catalog dt on dt.device_type_key = d.device_type_key');
      selectFields.push(
        'dt.id::text as device_type_ref_id',
        'dt.device_type_key as device_type_catalog_key',
        'dt.device_type_name as device_type_name',
        'dt.asset_group as device_type_asset_group',
        'dt.icon_name as device_type_icon_name'
      );
    }

    if (!joins.length) return data;

    const rows = mapSqlRows(await executeHasuraSql(`
      select
        ${selectFields.join(',\n        ')}
      from public.devices d
      ${joins.join('\n      ')}
      where d.id in (${ids.map((id) => `${sqlLiteral(id)}::uuid`).join(', ')});
    `));

    const rowsById = new Map(rows.map((row) => [row.id, row]));
    const mergeItem = (item) => {
      const row = item?.id ? rowsById.get(item.id) : null;
      if (!row) return item;

      return {
        ...item,
        region: compactRelation({
          id: row.region_ref_id,
          region_id: row.region_code,
          region_name: row.region_name,
          region_color: row.region_color,
        }),
        pop: compactRelation({
          id: row.pop_ref_id,
          pop_id: row.pop_inventory_id,
          pop_name: row.pop_name,
          pop_code: row.pop_code,
          region_id: row.pop_region_id,
        }),
        project: compactRelation({
          id: row.project_ref_id,
          project_id: row.project_inventory_id,
          project_code: row.project_code,
          project_name: row.project_name,
        }),
        customer: compactRelation({
          id: row.customer_ref_id,
          customer_id: row.customer_inventory_id,
          customer_code: row.customer_code,
          customer_name: row.customer_name,
          customer_number: row.customer_number,
        }),
        tenant: compactRelation({
          id: row.tenant_ref_id,
          tenant_code: row.tenant_code,
          tenant_name: row.tenant_name,
        }),
        manufacturer: compactRelation({
          id: row.manufacturer_ref_id,
          manufacturer_code: row.manufacturer_code,
          manufacturer_name: row.manufacturer_name,
        }),
        brand: compactRelation({
          id: row.brand_ref_id,
          brand_code: row.brand_code,
          brand_name: row.brand_name,
          manufacturer_id: row.brand_manufacturer_id,
        }),
        model: compactRelation({
          id: row.model_ref_id,
          model_code: row.model_code,
          model_name: row.model_name,
          brand_id: row.model_brand_id,
          manufacturer_id: row.model_manufacturer_id,
        }),
        device_type: compactRelation({
          id: row.device_type_ref_id,
          device_type_key: row.device_type_catalog_key,
          device_type_name: row.device_type_name,
          asset_group: row.device_type_asset_group,
          icon_name: row.device_type_icon_name,
        }),
      };
    };

    if (data.items) return { ...data, items: data.items.map(mergeItem) };
    if (data.item) return { ...data, item: mergeItem(data.item) };
  } catch (error) {
    return data;
  }

  return data;
}

async function enrichResourceData(config, data) {
  let enriched = data;
  if (config.table === 'devices') {
    enriched = await enrichDeviceRelationsWithSql(enriched);
  }
  return enrichOptionalFieldsWithSql(config, enriched);
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

  if (config.table === 'validation_records' && optionalFields.includes('validator_name')) {
    try {
      const rows = mapSqlRows(await executeHasuraSql(`
        select
          vr.id::text,
          au.full_name as validator_name,
          au.email as validator_email
        from public.validation_records vr
        left join public.app_users au on au.id = vr.validator_user_id
        where vr.id in (${ids.map((id) => `${sqlLiteral(id)}::uuid`).join(', ')});
      `));
      const rowsById = new Map(rows.map((row) => [row.id, row]));
      const mergeItem = (item) => (item?.id && rowsById.has(item.id) ? { ...item, ...rowsById.get(item.id) } : item);

      if (data.items) return { ...data, items: data.items.map(mergeItem) };
      if (data.item) return { ...data, item: mergeItem(data.item) };
    } catch (error) {
      return data;
    }
  }

  if (config.table === 'devices' && optionalFields.includes('latest_validation_request_status')) {
    try {
      const rows = mapSqlRows(await executeHasuraSql(`
        with latest_requests as (
          select distinct on (vr.entity_id)
            vr.entity_id::text as id,
            vr.id::text as latest_validation_request_id,
            vr.request_id as latest_validation_request_code,
            vr.current_status as latest_validation_request_status,
            vr.submitted_by_user_id::text as latest_validation_submitted_by_user_id,
            au.full_name as latest_validation_submitted_by_name,
            vr.created_at as latest_validation_submitted_at,
            vr.updated_at as latest_validation_request_updated_at
          from public.validation_requests vr
          left join public.app_users au on au.id = vr.submitted_by_user_id
          where vr.entity_type = 'device'
            and vr.entity_id in (${ids.map((id) => `${sqlLiteral(id)}::uuid`).join(', ')})
          order by vr.entity_id, vr.updated_at desc
        )
        select *
        from latest_requests;
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
  if (config.table === 'tenants') {
    return {
      table: 'tenants',
      codeColumn: 'tenant_code',
      nameColumn: 'tenant_name',
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
  let data;
  let countData;
  try {
    data = await executeHasuraSql(`
      select ${selectFields}
      from public.${meta.table}
      ${whereSql}
      order by sort_order asc, ${meta.nameColumn} asc
      limit ${limit}
      offset ${offset};
    `);
    countData = await executeHasuraSql(`
      select count(*)::text as count
      from public.${meta.table}
      ${whereSql};
    `);
  } catch (error) {
    const message = String(error?.message || error?.response?.data?.message || '').toLowerCase();
    if (message.includes('relation') && message.includes(meta.table) && message.includes('does not exist')) {
      return {
        items: [],
        aggregate: {
          aggregate: {
            count: 0,
          },
        },
      };
    }
    throw error;
  }

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
    return enrichResourceData(config, data);
  } catch (error) {
    if (isOptionalFieldError(error, config)) {
      const data = await executeResourceHasura(config, buildQuery(false), options);
      return enrichResourceData(config, data);
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
    const enriched = await enrichResourceData(config, data);
    return enriched.item;
  } catch (error) {
    if (isOptionalFieldError(error, config)) {
      const data = await executeResourceHasura(config, buildQuery(false), { id });
      const enriched = await enrichResourceData(config, data);
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
    const enriched = await enrichResourceData(config, data);
    return enriched.item;
  } catch (error) {
    if (isOptionalFieldError(error, config)) {
      const data = await executeResourceHasura(config, buildQuery(false), { object });
      const enriched = await enrichResourceData(config, data);
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
    const enriched = await enrichResourceData(config, data);
    return enriched.item;
  } catch (error) {
    if (isOptionalFieldError(error, config)) {
      const data = await executeResourceHasura(config, buildQuery(false), { id, changes });
      const enriched = await enrichResourceData(config, data);
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

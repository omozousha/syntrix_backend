const { executeHasura } = require('../config/hasura');
const { createHttpError } = require('../utils/httpError');

function buildWhereClause(config, query, auth) {
  const andConditions = [];
  const filterKeys = config.filterKeys || [];

  for (const key of filterKeys) {
    if (query[key] != null && query[key] !== '') {
      andConditions.push({ [key]: { _eq: query[key] } });
    }
  }

  if (query.q && config.searchColumns?.length) {
    andConditions.push({
      _or: config.searchColumns.map((column) => ({
        [column]: { _ilike: `%${query.q.trim()}%` },
      })),
    });
  }

  if (config.regionScoped && auth.role === 'user_region') {
    if (!auth.regions.length) {
      throw createHttpError(403, 'This regional user does not have any assigned region');
    }

    andConditions.push({ region_id: { _in: auth.regions } });
  }

  if (config.table === 'app_users' && auth.role !== 'admin') {
    andConditions.push({ id: { _eq: '__forbidden__' } });
  }

  if (config.softDelete) {
    const includeDeleted = String(query.include_deleted || '').toLowerCase() === 'true';
    const archivedOnly = String(query.archived_only || '').toLowerCase() === 'true';
    if (archivedOnly && auth.role === 'admin') {
      andConditions.push({ deleted_at: { _is_null: false } });
    } else if (!includeDeleted || auth.role !== 'admin') {
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

async function listResources(config, options) {
  const query = `
    query ListResource($where: ${config.table}_bool_exp!, $limit: Int!, $offset: Int!, $orderBy: [${config.table}_order_by!]) {
      items: ${config.table}(where: $where, limit: $limit, offset: $offset, order_by: $orderBy) {
        ${config.listFields.join('\n        ')}
      }
      aggregate: ${config.table}_aggregate(where: $where) {
        aggregate {
          count
        }
      }
    }
  `;

  const data = await executeHasura(query, options);
  return data;
}

async function getResourceById(config, id) {
  const query = `
    query GetResource($id: uuid!) {
      item: ${config.table}_by_pk(id: $id) {
        ${config.listFields.join('\n        ')}
      }
    }
  `;

  const data = await executeHasura(query, { id });
  return data.item;
}

async function createResource(config, object) {
  const query = `
    mutation CreateResource($object: ${config.table}_insert_input!) {
      item: insert_${config.table}_one(object: $object) {
        ${config.listFields.join('\n        ')}
      }
    }
  `;

  const data = await executeHasura(query, { object });
  return data.item;
}

async function updateResource(config, id, changes) {
  const query = `
    mutation UpdateResource($id: uuid!, $changes: ${config.table}_set_input!) {
      item: update_${config.table}_by_pk(pk_columns: { id: $id }, _set: $changes) {
        ${config.listFields.join('\n        ')}
      }
    }
  `;

  const data = await executeHasura(query, { id, changes });
  return data.item;
}

async function deleteResource(config, id) {
  const query = `
    mutation DeleteResource($id: uuid!) {
      item: delete_${config.table}_by_pk(id: $id) {
        id
      }
    }
  `;

  const data = await executeHasura(query, { id });
  return data.item;
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

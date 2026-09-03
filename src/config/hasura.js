const { query } = require('./db');

function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function sqlQuote(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (typeof val === 'object') return `'${String(JSON.stringify(val)).replace(/'/g, "''")}'::jsonb`;
  return `'${String(val).replace(/'/g, "''")}'`;
}

function parseWhereCondition(table, whereObj, params = []) {
  if (!whereObj || typeof whereObj !== 'object') return { sql: 'TRUE', params };
  const clauses = [];

  for (const [key, expr] of Object.entries(whereObj)) {
    if (key === '_and' && Array.isArray(expr)) {
      const andParts = expr.map((item) => {
        const sub = parseWhereCondition(table, item, params);
        return `(${sub.sql})`;
      });
      if (andParts.length) clauses.push(`(${andParts.join(' AND ')})`);
    } else if (key === '_or' && Array.isArray(expr)) {
      const orParts = expr.map((item) => {
        const sub = parseWhereCondition(table, item, params);
        return `(${sub.sql})`;
      });
      if (orParts.length) clauses.push(`(${orParts.join(' OR ')})`);
    } else if (expr && typeof expr === 'object' && !Array.isArray(expr)) {
      for (const [op, val] of Object.entries(expr)) {
        if (op === '_eq') {
          if (val === null) {
            clauses.push(`"${key}" IS NULL`);
          } else {
            params.push(val);
            clauses.push(`"${key}" = $${params.length}`);
          }
        } else if (op === '_neq') {
          if (val === null) {
            clauses.push(`"${key}" IS NOT NULL`);
          } else {
            params.push(val);
            clauses.push(`("${key}" IS NULL OR "${key}" != $${params.length})`);
          }
        } else if (op === '_in') {
          const list = Array.isArray(val) ? val : [];
          if (!list.length) {
            clauses.push('1 = 0');
          } else {
            params.push(list);
            clauses.push(`"${key}" = ANY($${params.length})`);
          }
        } else if (op === '_nin') {
          const list = Array.isArray(val) ? val : [];
          if (list.length) {
            params.push(list);
            clauses.push(`NOT ("${key}" = ANY($${params.length}))`);
          }
        } else if (op === '_is_null') {
          clauses.push(val ? `"${key}" IS NULL` : `"${key}" IS NOT NULL`);
        } else if (op === '_gte') {
          params.push(val);
          clauses.push(`"${key}" >= $${params.length}`);
        } else if (op === '_lte') {
          params.push(val);
          clauses.push(`"${key}" <= $${params.length}`);
        } else if (op === '_gt') {
          params.push(val);
          clauses.push(`"${key}" > $${params.length}`);
        } else if (op === '_lt') {
          params.push(val);
          clauses.push(`"${key}" < $${params.length}`);
        } else if (op === '_ilike') {
          params.push(val);
          clauses.push(`"${key}" ILIKE $${params.length}`);
        } else if (op === '_like') {
          params.push(val);
          clauses.push(`"${key}" LIKE $${params.length}`);
        }
      }
    } else {
      if (expr === null) {
        clauses.push(`"${key}" IS NULL`);
      } else {
        params.push(expr);
        clauses.push(`"${key}" = $${params.length}`);
      }
    }
  }

  return {
    sql: clauses.length ? clauses.join(' AND ') : 'TRUE',
    params,
  };
}

function parseGraphQLArguments(argStr, variables = {}) {
  const args = {};
  if (!argStr || !argStr.trim()) return args;

  const raw = argStr.trim();
  const keyValRegex = /([a-zA-Z0-9_]+)\s*:\s*(\$([a-zA-Z0-9_]+)|"([^"]*)"|([0-9\.\-]+)|true|false|null|\{[^}]*\}|\[[^\]]*\])/g;
  let match;
  while ((match = keyValRegex.exec(raw)) !== null) {
    const [, key, fullVal, varName, strVal, numVal] = match;
    if (varName !== undefined) {
      args[key] = variables[varName];
    } else if (strVal !== undefined) {
      args[key] = strVal;
    } else if (numVal !== undefined) {
      args[key] = Number(numVal);
    } else if (fullVal === 'true') {
      args[key] = true;
    } else if (fullVal === 'false') {
      args[key] = false;
    } else if (fullVal === 'null') {
      args[key] = null;
    } else if (fullVal.startsWith('{') || fullVal.startsWith('[')) {
      try {
        const jsonStr = fullVal
          .replace(/([a-zA-Z0-9_]+)\s*:/g, '"$1":')
          .replace(/'/g, '"');
        args[key] = JSON.parse(jsonStr);
      } catch (e) {
        args[key] = fullVal;
      }
    }
  }

  return args;
}

async function executeHasura(queryStr, variables = {}) {
  const cleanStr = queryStr.replace(/#.*$/gm, '').trim();
  const rootFieldRegex = /(?:([a-zA-Z0-9_]+)\s*:\s*)?([a-zA-Z0-9_]+)\s*(?:\(([^()]*|\((?:[^()]*|\([^()]*\))*\))*\))?/g;

  const isMutation = /^\s*mutation/i.test(cleanStr);
  const isQuery = /^\s*query/i.test(cleanStr) || !isMutation;

  const bodyStart = cleanStr.indexOf('{');
  const bodyEnd = cleanStr.lastIndexOf('}');
  if (bodyStart === -1 || bodyEnd === -1) {
    return {};
  }
  const body = cleanStr.substring(bodyStart + 1, bodyEnd).trim();

  const fieldMatches = [];
  let depth = 0;
  let currentField = '';
  let inArgs = false;

  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char === '(') inArgs = true;
    if (char === ')') inArgs = false;
    if (char === '{' && !inArgs) depth++;
    if (char === '}' && !inArgs) depth--;

    if (depth === 0 && !inArgs && (char === '\n' || char === '\r' || (char === ' ' && currentField.endsWith('}')))) {
      if (currentField.trim()) {
        fieldMatches.push(currentField.trim());
        currentField = '';
      }
    } else {
      currentField += char;
    }
  }
  if (currentField.trim()) {
    fieldMatches.push(currentField.trim());
  }

  const responseData = {};

  for (const rawFieldBlock of fieldMatches) {
    const match = /^(?:([a-zA-Z0-9_]+)\s*:\s*)?([a-zA-Z0-9_]+)(?:\s*\(([\s\S]*?)\))?/.exec(rawFieldBlock);
    if (!match) continue;

    const [, alias, rootField, argString] = match;
    const keyName = alias || rootField;

    let args = {};
    if (argString) {
      args = parseGraphQLArguments(argString, variables);
    }

    Object.keys(variables).forEach((vKey) => {
      if (args[vKey] === undefined) {
        args[vKey] = variables[vKey];
      }
    });

    if (rootField.endsWith('_by_pk')) {
      const table = rootField.replace('_by_pk', '').replace(/^(insert_|update_|delete_)/, '');
      const isInsert = rootField.startsWith('insert_');
      const isUpdate = rootField.startsWith('update_');
      const isDelete = rootField.startsWith('delete_');

      let id = args.id || args.pk_columns?.id || variables.id || variables.pk_columns?.id;

      if (isDelete && id) {
        const res = await query(`DELETE FROM public."${table}" WHERE id = $1 RETURNING *`, [id]);
        responseData[keyName] = res.rows[0] || null;
      } else if (isUpdate && id) {
        const setObj = args._set || args.set || variables.set || variables._set || {};
        const entries = Object.entries(setObj).filter(([k]) => k !== 'id');
        if (!entries.length) {
          const res = await query(`SELECT * FROM public."${table}" WHERE id = $1`, [id]);
          responseData[keyName] = res.rows[0] || null;
        } else {
          const setClauses = entries.map(([k], idx) => `"${k}" = $${idx + 2}`).join(', ');
          const params = [id, ...entries.map(([, v]) => v)];
          const res = await query(`UPDATE public."${table}" SET ${setClauses}, updated_at = NOW() WHERE id = $1 RETURNING *`, params);
          responseData[keyName] = res.rows[0] || null;
        }
      } else {
        const res = await query(`SELECT * FROM public."${table}" WHERE id = $1 AND (deleted_at IS NULL OR 1=1) LIMIT 1`, [id]);
        responseData[keyName] = res.rows[0] || null;
      }
    } else if (rootField.endsWith('_aggregate')) {
      const table = rootField.replace('_aggregate', '');
      const whereObj = args.where || variables.where || {};
      const { sql: whereSql, params } = parseWhereCondition(table, whereObj, []);

      const countRes = await query(`SELECT count(*)::int as count FROM public."${table}" WHERE ${whereSql}`, params);
      responseData[keyName] = {
        aggregate: {
          count: Number(countRes.rows[0]?.count || 0),
        },
      };
    } else if (rootField.startsWith('insert_')) {
      const table = rootField.replace('insert_', '').replace(/_one$/, '');
      const isOne = rootField.endsWith('_one');
      const rawObjects = args.objects || (args.object ? [args.object] : variables.objects || (variables.object ? [variables.object] : []));
      const objects = Array.isArray(rawObjects) ? rawObjects : [rawObjects];

      if (!objects.length) {
        responseData[keyName] = isOne ? null : { affected_rows: 0, returning: [] };
        continue;
      }

      const insertedRows = [];
      for (const obj of objects) {
        if (!obj || typeof obj !== 'object') continue;
        const keys = Object.keys(obj);
        const cols = keys.map((k) => `"${k}"`).join(', ');
        const placeholders = keys.map((_, idx) => `$${idx + 1}`).join(', ');
        const values = keys.map((k) => obj[k]);

        const onConflict = args.on_conflict || variables.on_conflict;
        let conflictSql = '';
        if (onConflict && onConflict.update_columns?.length) {
          const updateCols = onConflict.update_columns.map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ');
          const constraint = onConflict.constraint ? `ON CONSTRAINT "${onConflict.constraint}"` : '';
          conflictSql = `ON CONFLICT DO UPDATE SET ${updateCols}`;
        } else if (onConflict) {
          conflictSql = 'ON CONFLICT DO NOTHING';
        }

        const res = await query(`INSERT INTO public."${table}" (${cols}) VALUES (${placeholders}) ${conflictSql} RETURNING *`, values);
        if (res.rows[0]) insertedRows.push(res.rows[0]);
      }

      if (isOne) {
        responseData[keyName] = insertedRows[0] || null;
      } else {
        responseData[keyName] = {
          affected_rows: insertedRows.length,
          returning: insertedRows,
        };
      }
    } else if (rootField.startsWith('update_')) {
      const table = rootField.replace('update_', '');
      const whereObj = args.where || variables.where || {};
      const setObj = args._set || args.set || variables._set || variables.set || {};
      const { sql: whereSql, params } = parseWhereCondition(table, whereObj, []);

      const setEntries = Object.entries(setObj);
      if (!setEntries.length) {
        const res = await query(`SELECT * FROM public."${table}" WHERE ${whereSql}`, params);
        responseData[keyName] = { affected_rows: res.rows.length, returning: res.rows };
      } else {
        const setClauses = setEntries.map(([k], idx) => `"${k}" = $${params.length + idx + 1}`).join(', ');
        const allParams = [...params, ...setEntries.map(([, v]) => v)];

        const res = await query(`UPDATE public."${table}" SET ${setClauses}, updated_at = NOW() WHERE ${whereSql} RETURNING *`, allParams);
        responseData[keyName] = {
          affected_rows: res.rows.length,
          returning: res.rows,
        };
      }
    } else if (rootField.startsWith('delete_')) {
      const table = rootField.replace('delete_', '');
      const whereObj = args.where || variables.where || {};
      const { sql: whereSql, params } = parseWhereCondition(table, whereObj, []);

      const res = await query(`DELETE FROM public."${table}" WHERE ${whereSql} RETURNING *`, params);
      responseData[keyName] = {
        affected_rows: res.rows.length,
        returning: res.rows,
      };
    } else {
      const table = rootField;
      const whereObj = args.where || variables.where || {};
      const { sql: whereSql, params } = parseWhereCondition(table, whereObj, []);

      let limitSql = '';
      if (args.limit || variables.limit) {
        limitSql = ` LIMIT ${Number(args.limit || variables.limit)}`;
      }

      let orderSql = '';
      if (args.order_by || variables.order_by) {
        const orders = Array.isArray(args.order_by || variables.order_by)
          ? args.order_by || variables.order_by
          : [args.order_by || variables.order_by];
        const orderParts = [];
        orders.forEach((o) => {
          Object.entries(o).forEach(([col, dir]) => {
            orderParts.push(`"${col}" ${String(dir).toUpperCase()}`);
          });
        });
        if (orderParts.length) orderSql = ` ORDER BY ${orderParts.join(', ')}`;
      }

      const res = await query(`SELECT * FROM public."${table}" WHERE ${whereSql}${orderSql}${limitSql}`, params);
      responseData[keyName] = res.rows;
    }
  }

  return responseData;
}

async function executeHasuraMetadata() {
  return { status: 'ok' };
}

async function executeHasuraSql(sql) {
  const res = await query(sql);
  if (!res.fields || res.fields.length === 0) {
    return { result_type: 'CommandOk', result: null };
  }
  const headers = res.fields.map((f) => f.name);
  const rows = res.rows.map((row) =>
    headers.map((h) => {
      const val = row[h];
      if (val === null || val === undefined) return null;
      if (typeof val === 'object') return JSON.stringify(val);
      return String(val);
    })
  );
  return {
    result_type: 'TuplesOk',
    result: [headers, ...rows],
  };
}

async function ensureHasuraTableTracked() {
  return true;
}

module.exports = {
  hasuraClient: null,
  executeHasura,
  executeHasuraMetadata,
  executeHasuraSql,
  ensureHasuraTableTracked,
};

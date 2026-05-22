const { executeHasura, executeHasuraSql } = require('../../config/hasura');
const { createHttpError } = require('../../utils/httpError');

async function getDashboardSummary(regionIds = [], role = 'admin') {
  if (role === 'user_region' && !regionIds.length) {
    throw createHttpError(403, 'Regional user does not have any assigned region');
  }

  const useRegionFilter = role === 'user_region' && regionIds.length;
  const regionFilter = useRegionFilter ? '(where: { region_id: { _in: $regionIds } })' : '';
  const variableDefinition = useRegionFilter ? '($regionIds: [uuid!])' : '';

  const query = `
    query DashboardSummary${variableDefinition} {
      devices_aggregate ${regionFilter} { aggregate { count } }
      pops_aggregate ${regionFilter} { aggregate { count } }
      projects_aggregate ${regionFilter} { aggregate { count } }
      customers_aggregate ${regionFilter} { aggregate { count } }
      poles_aggregate ${regionFilter} { aggregate { count } }
      network_routes_aggregate ${regionFilter} { aggregate { count } }
      validation_records_aggregate { aggregate { count } }
      import_jobs_aggregate { aggregate { count } }
      monitoring_snapshots_aggregate { aggregate { count } }
    }
  `;

  return executeHasura(query, useRegionFilter ? { regionIds } : {});
}

function clampYear(value) {
  const year = Number(value || new Date().getFullYear());
  if (!Number.isInteger(year) || year < 2020 || year > 2100) {
    throw createHttpError(400, 'Invalid year parameter');
  }
  return year;
}

function parseOptionalMonth(value) {
  if (value === undefined || value === null || value === '') return null;
  const month = Number(value);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw createHttpError(400, 'Invalid month parameter');
  }
  return month;
}

function toSqlDate(value) {
  return value.toISOString().slice(0, 10);
}

function parseRunSqlRows(response) {
  const result = response?.result || [];
  const [headers = [], ...rows] = result;
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index]])));
}

function escapeSqlLiteral(value) {
  return String(value).replace(/'/g, "''");
}

async function getValidationProgress({ month, year } = {}) {
  const selectedYear = clampYear(year);
  const selectedMonth = parseOptionalMonth(month);
  const startDate = selectedMonth
    ? new Date(Date.UTC(selectedYear, selectedMonth - 1, 1))
    : new Date(Date.UTC(selectedYear, 0, 1));
  const endDate = selectedMonth
    ? new Date(Date.UTC(selectedYear, selectedMonth, 0))
    : new Date(Date.UTC(selectedYear, 11, 31));
  const intervalStep = selectedMonth ? '1 day' : '1 month';
  const dateFormatter = selectedMonth ? 'YYYY-MM-DD' : 'YYYY-MM-01';
  const endExpression = selectedMonth ? 'p.point_date + interval \'1 day\'' : 'p.point_date + interval \'1 month\'';

  const sql = `
    with points as (
      select generate_series(
        '${escapeSqlLiteral(toSqlDate(startDate))}'::date,
        '${escapeSqlLiteral(toSqlDate(endDate))}'::date,
        interval '${intervalStep}'
      )::date as point_date
    ),
    region_totals as (
      select
        r.id as region_id,
        r.region_name,
        count(d.id)::int as total_devices
      from public.regions r
      left join public.devices d on d.region_id = r.id
      group by r.id, r.region_name
    ),
    progress as (
      select
        rt.region_id,
        rt.region_name,
        to_char(p.point_date, '${dateFormatter}') as point_date,
        rt.total_devices,
        count(distinct d.id)::int as validated_devices
      from region_totals rt
      cross join points p
      left join public.devices d on d.region_id = rt.region_id
      left join public.validation_records vr on vr.entity_type = 'device'
        and vr.entity_id = d.id
        and vr.status = 'valid'
        and vr.validated_at < ${endExpression}
      group by rt.region_id, rt.region_name, p.point_date, rt.total_devices
    )
    select
      region_id::text,
      region_name,
      point_date,
      total_devices,
      validated_devices,
      case
        when total_devices > 0 then round((validated_devices::numeric / total_devices::numeric) * 100, 2)
        else 0
      end as rate
    from progress
    order by region_name asc, point_date asc;
  `;

  const response = await executeHasuraSql(sql);
  const rows = parseRunSqlRows(response);
  const byRegion = new Map();

  rows.forEach((row) => {
    const regionId = row.region_id;
    if (!byRegion.has(regionId)) {
      byRegion.set(regionId, {
        region_id: regionId,
        region_name: row.region_name || 'Region',
        total: Number(row.total_devices || 0),
        points: [],
      });
    }

    byRegion.get(regionId).points.push({
      date: row.point_date,
      validated: Number(row.validated_devices || 0),
      total: Number(row.total_devices || 0),
      rate: Number(row.rate || 0),
    });
  });

  return {
    range: {
      month: selectedMonth,
      year: selectedYear,
      granularity: selectedMonth ? 'day' : 'month',
      start_date: toSqlDate(startDate),
      end_date: toSqlDate(endDate),
    },
    regions: Array.from(byRegion.values()),
  };
}

module.exports = { getDashboardSummary, getValidationProgress };

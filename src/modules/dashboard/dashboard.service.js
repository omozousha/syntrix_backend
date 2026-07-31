const { executeHasuraSql } = require('../../config/hasura');
const { createHttpError } = require('../../utils/httpError');

function escapeSqlLiteral(value) {
  return String(value).replace(/'/g, "''");
}

function regionInClause(regionIds, column = 'region_id') {
  if (!regionIds?.length) return '';
  const ids = regionIds.map((id) => `'${escapeSqlLiteral(id)}'::uuid`).join(', ');
  return `and ${column} in (${ids})`;
}

function parseRows(response) {
  const result = response?.result || [];
  const [headers = [], ...rows] = result;
  return rows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index]])));
}

async function getDashboardSummary(regionIds = []) {
  const deviceRegion = regionInClause(regionIds, 'd.region_id');
  const popRegion = regionInClause(regionIds, 'p.region_id');
  const projectRegion = regionInClause(regionIds, 'pj.region_id');
  const customerRegion = regionInClause(regionIds, 'cu.region_id');
  const routeRegion = regionInClause(regionIds, 'nr.region_id');
  const regionFilter = regionIds?.length
    ? `where r.id in (${regionIds.map((id) => `'${escapeSqlLiteral(id)}'::uuid`).join(', ')})`
    : '';
  const regionAnd = regionIds?.length
    ? `and r.id in (${regionIds.map((id) => `'${escapeSqlLiteral(id)}'::uuid`).join(', ')})`
    : '';

  const mainSql = `
    select
      (select count(*)::int from public.devices d where d.deleted_at is null ${deviceRegion}) as devices_total,
      (select count(*)::int from public.pops p where true ${popRegion}) as pops_total,
      (select count(*)::int from public.projects pj where true ${projectRegion}) as projects_total,
      (select count(*)::int from public.customers cu where true ${customerRegion}) as customers_total,
      (select count(*)::int from public.network_routes nr where true ${routeRegion}) as routes_total,
      (select count(*)::int from public.regions r ${regionFilter}) as regions_total,
      (select count(*)::int from public.device_ports dp join public.devices d on d.id = dp.device_id where d.deleted_at is null and dp.deleted_at is null ${deviceRegion}) as ports_total,
      (select count(*)::int from public.device_ports dp join public.devices d on d.id = dp.device_id where d.deleted_at is null and dp.deleted_at is null and dp.status = 'used' ${deviceRegion}) as ports_used,
      (select count(*)::int from public.device_ports dp join public.devices d on d.id = dp.device_id where d.deleted_at is null and dp.deleted_at is null and dp.status in ('down', 'maintenance') ${deviceRegion}) as ports_down_maintenance,
      (select count(*)::int from public.device_ports dp join public.devices d on d.id = dp.device_id where d.deleted_at is null and dp.deleted_at is null and dp.status = 'reserved' ${deviceRegion}) as ports_reserved,
      (select count(*)::int from public.devices d where d.deleted_at is null and upper(d.device_type_key) = 'ODP' ${deviceRegion}) as odp_total,
      (select count(*)::int from public.devices d where d.deleted_at is null and upper(d.device_type_key) = 'ODP' and (d.validation_status = 'valid' or d.validation_date is not null or d.last_validation_at is not null) ${deviceRegion}) as odp_validated
  `;

  const typeSql = `
    select coalesce(nullif(trim(d.device_type_key), ''), 'Unknown') as label, count(*)::int as value
    from public.devices d
    where d.deleted_at is null ${deviceRegion}
    group by 1
    order by value desc
  `;

  const deviceStatusSql = `
    select coalesce(nullif(trim(d.status), ''), 'unknown') as label, count(*)::int as value
    from public.devices d
    where d.deleted_at is null ${deviceRegion}
    group by 1
    order by value desc
  `;

  const deviceByRegionSql = `
    select coalesce(r.region_name, 'Unknown') as label, count(d.id)::int as value
    from public.regions r
    left join public.devices d on d.region_id = r.id and d.deleted_at is null
    where true ${regionAnd}
    group by r.region_name
    order by value desc
  `;

  const odpByRegionSql = `
    select coalesce(r.region_name, 'Unknown') as label, count(d.id)::int as value
    from public.regions r
    left join public.devices d on d.region_id = r.id and d.deleted_at is null and upper(d.device_type_key) = 'ODP'
    where true ${regionAnd}
    group by r.region_name
    order by value desc
  `;

  const popStatusSql = `
    select coalesce(nullif(trim(p.status_pop), ''), 'unknown') as label, count(*)::int as value
    from public.pops p
    where true ${popRegion}
    group by 1
    order by value desc
  `;

  const popByRegionSql = `
    select coalesce(r.region_name, 'Unknown') as label, count(p.id)::int as value
    from public.regions r
    left join public.pops p on p.region_id = r.id
    where true ${regionAnd}
    group by r.region_name
    order by value desc
  `;

  const portsByStatusSql = `
    select coalesce(nullif(trim(dp.status), ''), 'unknown') as label, count(*)::int as value
    from public.device_ports dp
    join public.devices d on d.id = dp.device_id
    where d.deleted_at is null and dp.deleted_at is null ${deviceRegion}
    group by 1
    order by value desc
  `;

  const topPopsSql = `
    select coalesce(p.pop_name, p.pop_code, 'POP') as label, p.id::text as pop_id, count(d.id)::int as value
    from public.pops p
    left join public.devices d on d.pop_id = p.id and d.deleted_at is null
    where true ${popRegion}
    group by p.id, p.pop_name, p.pop_code
    order by value desc
    limit 10
  `;

  const topOdpPopsSql = `
    select coalesce(p.pop_name, p.pop_code, 'POP') as label, p.id::text as pop_id, count(d.id)::int as value
    from public.pops p
    left join public.devices d on d.pop_id = p.id and d.deleted_at is null and upper(d.device_type_key) = 'ODP'
    where true ${popRegion}
    group by p.id, p.pop_name, p.pop_code
    order by value desc
    limit 10
  `;

  const popsWithoutDeviceSql = `
    select p.id::text as pop_id, p.pop_name, p.pop_code
    from public.pops p
    where true ${popRegion}
      and not exists (
        select 1 from public.devices d
        where d.pop_id = p.id and d.deleted_at is null
      )
    order by p.pop_name nulls last
    limit 6
  `;

  const [
    mainResult,
    typeResult,
    deviceStatusResult,
    deviceByRegionResult,
    odpByRegionResult,
    popStatusResult,
    popByRegionResult,
    portsByStatusResult,
    topPopsResult,
    topOdpPopsResult,
    popsWithoutDeviceResult,
  ] = await Promise.all([
    executeHasuraSql(mainSql),
    executeHasuraSql(typeSql),
    executeHasuraSql(deviceStatusSql),
    executeHasuraSql(deviceByRegionSql),
    executeHasuraSql(odpByRegionSql),
    executeHasuraSql(popStatusSql),
    executeHasuraSql(popByRegionSql),
    executeHasuraSql(portsByStatusSql),
    executeHasuraSql(topPopsSql),
    executeHasuraSql(topOdpPopsSql),
    executeHasuraSql(popsWithoutDeviceSql),
  ]);

  const [mainRow] = parseRows(mainResult);
  const deviceByType = parseRows(typeResult);
  const deviceByStatus = parseRows(deviceStatusResult);
  const deviceByRegion = parseRows(deviceByRegionResult);
  const odpByRegion = parseRows(odpByRegionResult);
  const popByStatus = parseRows(popStatusResult);
  const popByRegion = parseRows(popByRegionResult);
  const portByStatus = parseRows(portsByStatusResult);
  const topPops = parseRows(topPopsResult);
  const topOdpPops = parseRows(topOdpPopsResult);
  const popsWithoutDevice = parseRows(popsWithoutDeviceResult);

  return {
    devices: {
      total: Number(mainRow?.devices_total || 0),
      byType: deviceByType,
      byStatus: deviceByStatus,
      byRegion: deviceByRegion,
    },
    odp: {
      total: Number(mainRow?.odp_total || 0),
      validated: Number(mainRow?.odp_validated || 0),
      unvalidated: Math.max(Number(mainRow?.odp_total || 0) - Number(mainRow?.odp_validated || 0), 0),
      byRegion: odpByRegion,
    },
    pops: {
      total: Number(mainRow?.pops_total || 0),
      byStatus: popByStatus,
      byRegion: popByRegion,
      topByDevice: topPops,
      topByOdp: topOdpPops,
      withoutDevice: popsWithoutDevice,
    },
    ports: {
      total: Number(mainRow?.ports_total || 0),
      used: Number(mainRow?.ports_used || 0),
      downMaintenance: Number(mainRow?.ports_down_maintenance || 0),
      reserved: Number(mainRow?.ports_reserved || 0),
      byStatus: portByStatus,
    },
    regions: { total: Number(mainRow?.regions_total || 0) },
    projects: { total: Number(mainRow?.projects_total || 0) },
    customers: { total: Number(mainRow?.customers_total || 0) },
    routes: { total: Number(mainRow?.routes_total || 0) },
  };
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
  const endExpression = selectedMonth ? "p.point_date + interval '1 day'" : "p.point_date + interval '1 month'";

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
      left join public.devices d on d.region_id = r.id and d.deleted_at is null
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
      left join public.devices d on d.region_id = rt.region_id and d.deleted_at is null
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
  const rows = parseRows(response);
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

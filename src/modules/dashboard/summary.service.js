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

function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

async function getOdpSummary(regionIds = [], popId = null, projectId = null) {
  const deviceRegion = regionInClause(regionIds, 'd.region_id');

  const popFilter = popId && isUuidLike(popId) ? ` and d.pop_id = '${escapeSqlLiteral(popId)}'::uuid` : '';
  const projectFilter = projectId && isUuidLike(projectId) ? ` and d.project_id = '${escapeSqlLiteral(projectId)}'::uuid` : '';

  const mainSql = `
    select
      (select count(*)::int from public.devices d where d.deleted_at is null and upper(d.device_type_key) = 'ODP' ${deviceRegion}${popFilter}${projectFilter}) as total,
      (select count(*)::int from public.devices d where d.deleted_at is null and upper(d.device_type_key) = 'ODP' and (d.validation_status = 'valid' or d.validation_date is not null or d.last_validation_at is not null) ${deviceRegion}${popFilter}${projectFilter}) as validated
  `;

  const portMetricsSql = `
    select
      coalesce(sum(d.total_ports), 0)::int as total_ports,
      coalesce(sum(d.used_ports), 0)::int as used_ports
    from public.devices d
    where d.deleted_at is null
      and upper(d.device_type_key) = 'ODP'
      ${deviceRegion}${popFilter}${projectFilter}
  `;

  const popsBreakdownSql = `
    with odp_with_pops as (
      select
        d.id,
        d.pop_id,
        d.validation_status,
        d.validation_date,
        d.last_validation_at
      from public.devices d
      where d.deleted_at is null
        and upper(d.device_type_key) = 'ODP'
        ${deviceRegion}${popFilter}${projectFilter}
    )
    select
      coalesce(owp.pop_id::text, 'null') as pop_id,
      coalesce(p.pop_name, p.pop_code, 'Unassigned') as label,
      count(owp.id)::int as total,
      count(*) filter (where owp.validation_status = 'valid' or owp.validation_date is not null or owp.last_validation_at is not null)::int as validated
    from odp_with_pops owp
    left join public.pops p on p.id = owp.pop_id
    group by owp.pop_id, p.pop_name, p.pop_code
    order by count(owp.id) desc
  `;

  const popsPortsSql = `
    select
      coalesce(d.pop_id::text, 'null') as pop_id,
      coalesce(sum(d.total_ports), 0)::int as total_ports,
      coalesce(sum(d.used_ports), 0)::int as used_ports
    from public.devices d
    where d.deleted_at is null
      and upper(d.device_type_key) = 'ODP'
      ${deviceRegion}${popFilter}${projectFilter}
    group by d.pop_id
  `;

  try {
    const [
      mainResult,
      portMetricsResult,
      popsBreakdownResult,
      popsPortsResult,
    ] = await Promise.all([
      executeHasuraSql(mainSql),
      executeHasuraSql(portMetricsSql),
      executeHasuraSql(popsBreakdownSql),
      executeHasuraSql(popsPortsSql),
    ]);

    const mainRows = parseRows(mainResult);
    const portMetricsRows = parseRows(portMetricsResult);
    const popsBreakdownData = parseRows(popsBreakdownResult);
    const popsPortsData = parseRows(popsPortsResult);

    const mainData = mainRows[0] || {};
    const portMetricsData = portMetricsRows[0] || {};

    const total = Number(mainData.total ?? 0);
    const validated = Number(mainData.validated ?? 0);
    const unvalidated = Math.max(total - validated, 0);
    const validationRate = total > 0 ? Math.round((validated / total) * 100) : null;

    const totalPorts = Number(portMetricsData.total_ports ?? 0);
    const usedPorts = Number(portMetricsData.used_ports ?? 0);
    const availablePorts = Math.max(totalPorts - usedPorts, 0);

    const pops = popsBreakdownData.map((pop) => {
      const portStat = popsPortsData.find((ps) => ps.pop_id === pop.pop_id);
      const popTotalPorts = Number(portStat?.total_ports ?? 0);
      const popUsedPorts = Number(portStat?.used_ports ?? 0);
      const popAvailablePorts = Math.max(popTotalPorts - popUsedPorts, 0);
      const popValidated = Number(pop.validated ?? 0);
      const popTotal = Number(pop.total ?? 0);
      const popValidationRate = popTotal > 0 ? Math.round((popValidated / popTotal) * 100) : null;

      return {
        popId: pop.pop_id === 'null' ? null : pop.pop_id,
        label: pop.label,
        regionId: null,
        total: popTotal,
        validated: popValidated,
        unvalidated: popTotal - popValidated,
        validationRate: popValidationRate,
        totalPorts: popTotalPorts,
        usedPorts: popUsedPorts,
        availablePorts: popAvailablePorts,
      };
    });

    return {
      odp: {
        total,
        validated,
        unvalidated,
        validationRate,
        ports: {
          total: totalPorts,
          used: usedPorts,
          available: availablePorts,
        },
      },
      pops,
    };
  } catch (error) {
    throw createHttpError(500, error.message || 'Failed to fetch ODP summary');
  }
}

module.exports = {
  getOdpSummary,
};

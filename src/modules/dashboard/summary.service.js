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

async function getOdpSummary(regionIds = [], popId = null, projectId = null) {
  const deviceRegion = regionInClause(regionIds, 'd.region_id');
  const popRegion = regionInClause(regionIds, 'p.region_id');
  const projectRegion = regionInClause(regionIds, 'pj.region_id');
  const regionFilter = regionIds?.length
    ? `where r.id in (${regionIds.map((id) => `'${escapeSqlLiteral(id)}'::uuid`).join(', ')})`
    : '';

  // Main ODP metrics query
  const mainSql = `
    select
      (select count(*)::int from public.devices d where d.deleted_at is null and upper(d.device_type_key) = 'ODP' ${deviceRegion}${popId ? ` and d.pop_id = '${escapeSqlLiteral(popId)}'::uuid` : ''}${projectId ? ` and d.project_id = '${escapeSqlLiteral(projectId)}'::uuid` : ''}) as total,
      (select count(*)::int from public.devices d where d.deleted_at is null and upper(d.device_type_key) = 'ODP' and (d.validation_status = 'valid' or d.validation_date is not null or d.last_validation_at is not null) ${deviceRegion}${popId ? ` and d.pop_id = '${escapeSqlLiteral(popId)}'::uuid` : ''}${projectId ? ` and d.project_id = '${escapeSqlLiteral(projectId)}'::uuid` : ''}) as validated
  `;

  // Port metrics aggregated across all ODPs in scope
  const portMetricsSql = `
    select
      coalesce(sum(d.total_ports), 0)::int as total_ports,
      coalesce(sum(d.used_ports), 0)::int as used_ports
    from public.devices d
    where d.deleted_at is null
      and upper(d.device_type_key) = 'ODP'
      ${deviceRegion}${popId ? ` and d.pop_id = '${escapeSqlLiteral(popId)}'::uuid` : ''}${projectId ? ` and d.project_id = '${escapeSqlLiteral(projectId)}'::uuid` : ''}
  `;

  // Per-POP breakdown with validation split and port stats
  const popsBreakdownSql = `
    with odp_with_pops as (
      select
        d.id,
        d.pop_id,
        d.validation_status,
        d.validation_date,
        d.last_validation_at,
        d.total_ports,
        d.used_ports,
        coalesce(p.region_id, d.region_id) as region_id
      from public.devices d
      left join public.pops p on p.id = d.pop_id
      where d.deleted_at is null
        and upper(d.device_type_key) = 'ODP'
        ${deviceRegion}${popId ? ` and d.pop_id = '${escapeSqlLiteral(popId)}'::uuid` : ''}${projectId ? ` and d.project_id = '${escapeSqlLiteral(projectId)}'::uuid` : ''}
    )
    select
      coalesce(owp.pop_id::text, 'null') as pop_id,
      coalesce(p.pop_name, p.pop_code, 'Unassigned') as label,
      owp.region_id,
      count(owp.id)::int as total,
      count(*) filter (where owp.validation_status = 'valid' or owp.validation_date is not null or owp.last_validation_at is not null)::int as validated
    from odp_with_pops owp
    left join public.pops p on p.id = owp.pop_id
    group by owp.pop_id, p.pop_name, p.pop_code, owp.region_id
    order by count(owp.id) desc
  `;

  // Per-POP port aggregation - only for POPs that have ODPs
  const popsPortsSql = `
    select
      coalesce(d.pop_id::text, 'null') as pop_id,
      coalesce(sum(d.total_ports), 0)::int as total_ports,
      coalesce(sum(d.used_ports), 0)::int as used_ports
    from public.devices d
    where d.deleted_at is null
      and upper(d.device_type_key) = 'ODP'
      ${deviceRegion}${popId ? ` and d.pop_id = '${escapeSqlLiteral(popId)}'::uuid` : ''}${projectId ? ` and d.project_id = '${escapeSqlLiteral(projectId)}'::uuid` : ''}
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

    console.log('SQL Results received:', {
      mainRows: mainResult.result?.length || 0,
      portRows: portMetricsResult.result?.length || 0,
      popBreakdownRows: popsBreakdownResult.result?.length || 0,
      popPortRows: popsPortsResult.result?.length || 0,
    });
    
    const mainRow = Array.isArray(mainResult.result) && mainResult.result.length > 1
      ? mainResult.result[1]
      : mainResult.result?.[0];
    
    const portMetricsRow = Array.isArray(portMetricsResult.result) && portMetricsResult.result.length > 1
      ? portMetricsResult.result[1]
      : portMetricsResult.result?.[0];
    
    const parseRow = (result) => {
      const rows = result?.result || [];
      if (!rows.length) return [];
      const headers = rows[0] || [];
      const dataRows = rows.slice(1);
      return dataRows.map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index]])));
    };

    const mainData = typeof mainRow === 'object' 
      ? mainRow 
      : parseRow(mainResult)[0] || {};
    
    const portMetricsData = typeof portMetricsRow === 'object'
      ? portMetricsRow
      : parseRow(portMetricsResult)[0] || {};
    
    const popsBreakdownData = parseRow(popsBreakdownResult);
    const popsPortsData = parseRow(popsPortsResult);

    const total = Number(mainData?.total ?? 0);
    const validated = Number(mainData?.validated ?? 0);
    const unvalidated = Math.max(total - validated, 0);
    const validationRate = total > 0 ? Math.round((validated / total) * 100) : null;

    const totalPorts = Number(portMetricsData?.total_ports ?? 0);
    const usedPorts = Number(portMetricsData?.used_ports ?? 0);
    const availablePorts = Math.max(totalPorts - usedPorts, 0);

    // Merge breakdown with port stats per POP
    const pops = popsBreakdownData.map((pop) => {
      const portStat = popsPortsData.find((ps) => ps.pop_id === (pop.pop_id ?? 'null'));
      const popTotalPorts = Number(portStat?.total_ports ?? 0);
      const popUsedPorts = Number(portStat?.used_ports ?? 0);
      const popAvailablePorts = Math.max(popTotalPorts - popUsedPorts, 0);
      const popValidated = Number(pop.validated ?? 0);
      const popTotal = Number(pop.total ?? 0);
      const popValidationRate = popTotal > 0 ? Math.round((popValidated / popTotal) * 100) : null;

      return {
        popId: pop.pop_id === 'null' ? null : pop.pop_id,
        label: pop.label,
        regionId: pop.region_id ? String(pop.region_id) : null,
        total: popTotal,
        validated: popValidated,
        unvalidated: popTotal - popValidated,
        validationRate: popValidationRate,
        totalPorts: popTotalPorts,
        usedPorts: popUsedPorts,
        availablePorts: popAvailablePorts,
      };
    });

    console.log('ODP Summary constructed:', { odp: { total, validated }, popsCount: pops.length });

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
    console.error('getOdpSummary Error:', error.message);
    console.error(error.stack);
    throw createHttpError(500, error.message || 'Failed to fetch ODP summary');
  }
}

module.exports = {
  getOdpSummary,
};

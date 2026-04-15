const { executeHasura } = require('../../config/hasura');
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

module.exports = { getDashboardSummary };

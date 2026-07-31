const { sendSuccess } = require('../../utils/response');
const { getDashboardSummary, getValidationProgress } = require('./dashboard.service');

function resolveRegionFilter(req) {
  const scopedRegions = Array.isArray(req.auth?.regions) ? req.auth.regions : [];
  const requested = String(req.query.region_id || '').trim();

  // Superadmin (admin): no scoped regions. Filter only when explicitly requested.
  if (!scopedRegions.length) {
    return requested ? [requested] : [];
  }

  // Regional roles: respect scope; allow narrowing to one requested region if in scope.
  if (requested) {
    return scopedRegions.includes(requested) ? [requested] : scopedRegions;
  }
  return scopedRegions;
}

async function summary(req, res, next) {
  try {
    const regionIds = resolveRegionFilter(req);
    const data = await getDashboardSummary(regionIds);
    return sendSuccess(res, data, 'Dashboard summary fetched successfully');
  } catch (error) {
    return next(error);
  }
}

async function validationProgress(req, res, next) {
  try {
    const data = await getValidationProgress({
      month: req.query.month,
      year: req.query.year,
    });
    return sendSuccess(res, data, 'Validation progress fetched successfully');
  } catch (error) {
    return next(error);
  }
}

module.exports = { summary, validationProgress };

const { sendSuccess } = require('../../utils/response');
const { getDashboardSummary, getValidationProgress } = require('./dashboard.service');

async function summary(req, res, next) {
  try {
    const data = await getDashboardSummary(req.auth.regions, req.auth.role);
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

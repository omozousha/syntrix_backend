const { sendSuccess } = require('../../utils/response');
const { getDashboardSummary } = require('./dashboard.service');

async function summary(req, res, next) {
  try {
    const data = await getDashboardSummary(req.auth.regions, req.auth.role);
    return sendSuccess(res, data, 'Dashboard summary fetched successfully');
  } catch (error) {
    return next(error);
  }
}

module.exports = { summary };

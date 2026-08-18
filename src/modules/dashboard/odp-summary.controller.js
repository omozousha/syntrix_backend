const { getOdpSummary } = require('./summary.service');

async function getSummary(req, res, next) {
  try {
    const regionIds = req.auth?.regions || [];
    const popId = req.query.pop_id;
    const projectId = req.query.project_id;

    // Validate scope filters
    if (popId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(popId)) {
      throw new Error('Invalid pop_id parameter');
    }

    const summary = await getOdpSummary(regionIds, popId || null, projectId || null);

    return res.json({ success: true, data: summary });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getSummary,
};

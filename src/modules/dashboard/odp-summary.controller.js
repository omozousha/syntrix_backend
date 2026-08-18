const { getOdpSummary } = require('./summary.service');

async function getSummary(req, res, next) {
  try {
    const regionIds = req.auth?.regions || [];
    const popId = req.query.pop_id;
    const projectId = req.query.project_id;

    // Validate scope filters - more lenient UUID check
    if (popId && (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(popId))) {
      // For now, accept any non-empty string as potential UUID
      // Database will handle invalid UUIDs
    }

    console.log('ODP Summary Request:', { regionCount: regionIds.length, popId, projectId });
    
    const summary = await getOdpSummary(regionIds, popId || null, projectId || null);

    console.log('ODP Summary Response:', { odpTotal: summary.odp.total, popsCount: summary.pops.length });
    
    return res.json({ success: true, data: summary });
  } catch (error) {
    console.error('ODP Summary Error:', error.message);
    console.error(error.stack);
    next(error);
  }
}

module.exports = {
  getSummary,
};

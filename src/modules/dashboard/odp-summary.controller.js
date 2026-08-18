const { getOdpSummary } = require('./summary.service');

function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ''));
}

async function getSummary(req, res, next) {
  try {
    const authRegions = (req.auth?.regions || []).filter(isUuidLike);
    const queryRegionId = String(req.query.region_id || '').trim();

    const regionIds = authRegions.length
      ? (queryRegionId && authRegions.includes(queryRegionId) ? [queryRegionId] : authRegions)
      : (isUuidLike(queryRegionId) ? [queryRegionId] : []);

    const popId = String(req.query.pop_id || '').trim() || null;
    const projectId = String(req.query.project_id || '').trim() || null;

    const summary = await getOdpSummary(regionIds, popId, projectId);

    return res.json({ success: true, data: summary });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getSummary,
};

const createHttpError = require('http-errors');
const { getRoadRoute } = require('./osrm.service');

/**
 * Parse a "lng,lat" coordinate string and validate its values.
 * @param {string} raw - e.g. "106.8456,-6.2088"
 * @param {string} label - for error messages, e.g. "origin"
 * @returns {{ lng: number, lat: number }}
 */
function parseCoordinate(raw, label) {
  if (!raw || typeof raw !== 'string') {
    throw createHttpError(400, `Parameter '${label}' wajib diisi (format: "bujur,lintang", contoh: 106.8456,-6.2088)`);
  }
  const parts = raw.trim().split(',');
  if (parts.length !== 2) {
    throw createHttpError(400, `Format '${label}' tidak valid. Gunakan format "bujur,lintang", contoh: 106.8456,-6.2088`);
  }
  const lng = parseFloat(parts[0]);
  const lat = parseFloat(parts[1]);
  if (Number.isNaN(lng) || Number.isNaN(lat)) {
    throw createHttpError(400, `Koordinat '${label}' bukan angka valid`);
  }
  if (lng < -180 || lng > 180) {
    throw createHttpError(400, `Bujur (longitude) '${label}' harus antara -180 dan 180`);
  }
  if (lat < -90 || lat > 90) {
    throw createHttpError(400, `Lintang (latitude) '${label}' harus antara -90 dan 90`);
  }
  return { lng, lat };
}

/**
 * GET /api/v1/routing/route?origin=lng,lat&destination=lng,lat
 */
async function getRoute(req, res, next) {
  try {
    const originCoord = parseCoordinate(req.query.origin, 'origin');
    const destCoord = parseCoordinate(req.query.destination, 'destination');

    const originStr = `${originCoord.lng},${originCoord.lat}`;
    const destStr = `${destCoord.lng},${destCoord.lat}`;

    const result = await getRoadRoute(originStr, destStr);

    return res.json({
      success: true,
      data: result,
      meta: {
        origin: originCoord,
        destination: destCoord,
        engine: 'OSRM',
        cached: result.cached,
      },
    });
  } catch (error) {
    if (error.code === 'ECONNABORTED' || (error.message && error.message.includes('timeout'))) {
      return next(createHttpError(504, 'OSRM routing server tidak merespons (timeout). Coba lagi sesaat.'));
    }
    if (error.response && error.response.status === 400) {
      return next(createHttpError(400, 'Koordinat tidak dapat diproses oleh routing engine. Pastikan koordinat berada di wilayah yang memiliki data jalan.'));
    }
    return next(error);
  }
}

module.exports = { getRoute };

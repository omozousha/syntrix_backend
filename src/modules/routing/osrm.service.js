const axios = require('axios');

const OSRM_BASE_URL = process.env.OSRM_BASE_URL || 'https://router.project-osrm.org';
const OSRM_TIMEOUT_MS = parseInt(process.env.OSRM_TIMEOUT_MS || '8000', 10);

// In-memory cache for OSRM routes (max 100 entries, 10 min TTL)
const routeCache = new Map();
const MAX_CACHE_SIZE = 100;
const CACHE_TTL_MS = 10 * 60 * 1000;

function getCacheKey(type, origin, destination) {
  return `${type}:${origin}->${destination}`;
}

function getFromCache(key) {
  const item = routeCache.get(key);
  if (!item) return null;
  if (Date.now() - item.timestamp > CACHE_TTL_MS) {
    routeCache.delete(key);
    return null;
  }
  return item.data;
}

function setToCache(key, data) {
  if (routeCache.size >= MAX_CACHE_SIZE) {
    // Delete oldest entry
    const firstKey = routeCache.keys().next().value;
    if (firstKey) routeCache.delete(firstKey);
  }
  routeCache.set(key, { data, timestamp: Date.now() });
}

/**
 * Fetch driving route between origin and destination from OSRM
 * @param {string} origin - "lng,lat"
 * @param {string} destination - "lng,lat"
 * @returns {Promise<Object>} Formatted route result
 */
async function getRoadRoute(origin, destination) {
  const cacheKey = getCacheKey('route', origin, destination);
  const cached = getFromCache(cacheKey);
  if (cached) {
    return { ...cached, cached: true };
  }

  const url = `${OSRM_BASE_URL}/route/v1/driving/${origin};${destination}?overview=full&geometries=geojson&steps=true`;

  const response = await axios.get(url, {
    timeout: OSRM_TIMEOUT_MS,
    headers: {
      'User-Agent': 'SyntrixNetworkInventory/1.0',
    },
  });

  if (response.data.code !== 'Ok' || !response.data.routes || !response.data.routes.length) {
    throw new Error(response.data.message || 'No route found between the specified coordinates');
  }

  const rawRoute = response.data.routes[0];

  // Convert distance (meters) to km & duration (seconds) to minutes
  const distanceKm = Math.round((rawRoute.distance / 1000) * 10) / 10;
  const durationMinutes = Math.round(rawRoute.duration / 60);

  // Extract turn-by-turn steps
  const steps = [];
  if (rawRoute.legs && rawRoute.legs[0] && rawRoute.legs[0].steps) {
    rawRoute.legs[0].steps.forEach((step, idx) => {
      if (step.distance > 5) {
        steps.push({
          index: idx + 1,
          instruction: step.maneuver ? translateManeuver(step.maneuver, step.name) : step.name || 'Jalan lurus',
          distance_m: Math.round(step.distance),
          duration_s: Math.round(step.duration),
          type: step.maneuver ? step.maneuver.type : 'turn',
          modifier: step.maneuver ? step.maneuver.modifier : '',
          location: step.maneuver ? step.maneuver.location : null,
        });
      }
    });
  }

  const result = {
    distance_km: distanceKm,
    distance_meters: Math.round(rawRoute.distance),
    duration_minutes: durationMinutes,
    duration_seconds: Math.round(rawRoute.duration),
    geometry: rawRoute.geometry, // GeoJSON LineString object
    steps,
    waypoints: response.data.waypoints || [],
  };

  setToCache(cacheKey, result);
  return { ...result, cached: false };
}

/**
 * Translate OSRM maneuver type to Indonesian instruction
 */
function translateManeuver(maneuver, roadName) {
  const roadLabel = roadName ? ` ke ${roadName}` : '';
  const type = maneuver.type;
  const modifier = maneuver.modifier;

  switch (type) {
    case 'depart':
      return `Mulai perjalanan${roadLabel}`;
    case 'arrive':
      return `Tiba di tujuan${roadLabel}`;
    case 'turn':
      if (modifier === 'left') return `Belok kiri${roadLabel}`;
      if (modifier === 'right') return `Belok kanan${roadLabel}`;
      if (modifier === 'sharp left') return `Belok tajam ke kiri${roadLabel}`;
      if (modifier === 'sharp right') return `Belok tajam ke kanan${roadLabel}`;
      if (modifier === 'slight left') return `Ambil agak ke kiri${roadLabel}`;
      if (modifier === 'slight right') return `Ambil agak ke kanan${roadLabel}`;
      return `Belok${roadLabel}`;
    case 'new name':
      return `Lanjutkan ke ${roadName || 'jalan selanjutnya'}`;
    case 'roundabout':
    case 'rotary':
      return `Di bundaran, ambil jalan keluar${roadLabel}`;
    case 'merge':
      return `Bergabung${roadLabel}`;
    case 'fork':
      return `Di persimpangan, ${modifier === 'left' ? 'ambil jalur kiri' : 'ambil jalur kanan'}${roadLabel}`;
    case 'off ramp':
    case 'on ramp':
      return `Ambil jalan keluar/masuk${roadLabel}`;
    default:
      return `Lanjutkan${roadLabel}`;
  }
}

module.exports = {
  getRoadRoute,
};

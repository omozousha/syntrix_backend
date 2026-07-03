const express = require('express');
const multer = require('multer');
const { env } = require('../../config/env');
const { authenticate, requireRole } = require('../../middleware/auth.middleware');
const { createHttpError } = require('../../utils/httpError');
const { sendSuccess } = require('../../utils/response');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.maxUploadSizeMb * 1024 * 1024,
  },
  fileFilter(_req, file, callback) {
    const ext = (file.originalname || '').split('.').pop().toLowerCase();
    if (!['kml', 'kmz'].includes(ext)) {
      return callback(createHttpError(400, 'Format file harus KML atau KMZ.'));
    }
    return callback(null, true);
  },
});

const cableRouter = express.Router();

// ─── Haversine Distance ───
function haversineDistance(coord1, coord2) {
  const [lng1, lat1] = coord1;
  const [lng2, lat2] = coord2;
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calculatePolylineLength(coordinates) {
  let total = 0;
  for (let i = 1; i < coordinates.length; i++) {
    total += haversineDistance(coordinates[i - 1], coordinates[i]);
  }
  return Math.round(total * 100) / 100;
}

// ─── KML Parser ───
function parseKmlCoordinates(xmlContent) {
  const { XMLParser } = require('fast-xml-parser');
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  });
  const doc = parser.parse(xmlContent);

  // Navigate to find LineString coordinates
  const root = doc?.kml || doc;
  const document = root?.Document || root;
  const placemarks = document?.Placemark || [];
  const placemarkArray = Array.isArray(placemarks) ? placemarks : [placemarks];

  for (const placemark of placemarkArray) {
    // Try direct LineString
    const lineString = placemark?.LineString;
    if (lineString) {
      const coordsText = typeof lineString === 'object'
        ? (lineString.coordinates || lineString['coordinates'])
        : null;
      if (typeof coordsText === 'string') {
        const points = parseCoordsString(coordsText);
        if (points && points.length >= 2) return points;
      }
    }

    // Try MultiGeometry
    const multiGeo = placemark?.MultiGeometry;
    if (multiGeo) {
      const lsArray = multiGeo.LineString || [];
      const lines = Array.isArray(lsArray) ? lsArray : [lsArray];
      for (const ls of lines) {
        const coordsText = typeof ls === 'object'
          ? (ls.coordinates || ls['coordinates'])
          : null;
        if (typeof coordsText === 'string') {
          const points = parseCoordsString(coordsText);
          if (points && points.length >= 2) return points;
        }
      }
    }

    // Try Folder > Placemark nesting
    const folder = placemark?.Folder;
    if (folder) {
      const nestedPlacemarks = folder.Placemark || [];
      const nestedArray = Array.isArray(nestedPlacemarks) ? nestedPlacemarks : [nestedPlacemarks];
      for (const np of nestedArray) {
        const ls = np?.LineString;
        if (ls) {
          const coordsText = typeof ls === 'object'
            ? (ls.coordinates || ls['coordinates'])
            : null;
          if (typeof coordsText === 'string') {
            const points = parseCoordsString(coordsText);
            if (points && points.length >= 2) return points;
          }
        }
      }
    }
  }

  return null;
}

function parseCoordsString(text) {
  return text
    .trim()
    .split(/\s+/)
    .map((point) => {
      const parts = point.split(',').map(Number);
      if (parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])) {
        return [parts[0], parts[1]];
      }
      return null;
    })
    .filter(Boolean);
}

function parseKmlBuffer(buffer) {
  return parseKmlCoordinates(buffer.toString('utf-8'));
}

function parseKmzBuffer(buffer) {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  const kmlEntry = entries.find((entry) => {
    const name = entry.entryName.toLowerCase();
    return name.endsWith('.kml') && !name.startsWith('__macosx');
  });
  if (!kmlEntry) return null;
  return parseKmlCoordinates(kmlEntry.getData().toString('utf-8'));
}

// ─── Endpoint: Upload Route File (KML/KMZ) ───
cableRouter.post(
  '/upload-route',
  authenticate,
  requireRole('admin', 'user_region', 'user_all_region'),
  upload.single('file'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        throw createHttpError(400, 'File KML/KMZ wajib diupload.');
      }

      const ext = (req.file.originalname || '').split('.').pop().toLowerCase();
      let coordinates;

      if (ext === 'kmz') {
        coordinates = parseKmzBuffer(req.file.buffer);
      } else {
        coordinates = parseKmlBuffer(req.file.buffer);
      }

      if (!coordinates || coordinates.length < 2) {
        throw createHttpError(
          400,
          'Tidak dapat mengekstrak koordinat dari file. Pastikan file berisi LineString dengan minimal 2 titik koordinat.',
        );
      }

      // Validasi bounds koordinat
      for (const [lng, lat] of coordinates) {
        if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
          throw createHttpError(
            400,
            `Koordinat tidak valid: (${lng}, ${lat}). Lat: -90..90, Lng: -180..180.`,
          );
        }
      }

      const lengthM = calculatePolylineLength(coordinates);

      return sendSuccess(
        res,
        {
          coordinates,
          length_m: lengthM,
          point_count: coordinates.length,
          route_file_url: null,
        },
        'Route file parsed successfully',
      );
    } catch (error) {
      return next(
        createHttpError(
          error.statusCode || 400,
          error.message || 'Route file upload failed',
          error.details,
        ),
      );
    }
  },
);

module.exports = { cableRouter };

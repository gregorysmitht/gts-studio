/* Tropical systems — National Hurricane Center.

   CurrentStorms.json is the NHC's machine-readable list of active
   systems in the Atlantic and eastern/central Pacific basins. It has
   no CORS headers, so it goes through the bundled proxy.

   Cone-of-uncertainty polygons ship as zipped KML, which is more than
   a wall display needs; the hub plots each storm's current position,
   category and movement, and links out to the official cone graphic. */

import { get } from '../core/net.js';
import { haversineMiles } from '../core/format.js';
import { STORM_CATEGORY } from '../core/palette.js';

const API = 'https://www.nhc.noaa.gov/CurrentStorms.json';

const KT_TO_MPH = 1.15078;

const CLASSIFICATION = {
  TD: 'Tropical Depression',
  TS: 'Tropical Storm',
  HU: 'Hurricane',
  MH: 'Major Hurricane',
  PTC: 'Post-Tropical Cyclone',
  STD: 'Subtropical Depression',
  STS: 'Subtropical Storm',
  SS: 'Subtropical Storm',
  TY: 'Typhoon',
  ST: 'Super Typhoon',
  LO: 'Low',
  DB: 'Disturbance',
};

/** Saffir–Simpson category from sustained winds in knots. */
export function category(knots) {
  if (knots == null) return null;
  if (knots >= 137) return 5;
  if (knots >= 113) return 4;
  if (knots >= 96) return 3;
  if (knots >= 83) return 2;
  if (knots >= 64) return 1;
  return 0;
}

export { STORM_CATEGORY as CATEGORY_COLOR } from '../core/palette.js';

/** Short label: "Cat 3 Hurricane", "Tropical Storm". */
export function stormLabel(storm) {
  const base = CLASSIFICATION[storm.classification] ?? 'Tropical System';
  return storm.category > 0 ? `Cat ${storm.category} Hurricane` : base;
}

export async function loadStorms(place) {
  try {
    const json = await get(API, { proxy: true, ttl: 15 * 60e3 });
    const list = json?.activeStorms ?? [];

    return list.map((s) => {
      const knots = Number(s.intensity) || null;
      const lat = Number(s.latitudeNumeric ?? parseCoord(s.latitude));
      const lon = Number(s.longitudeNumeric ?? parseCoord(s.longitude));
      const cat = category(knots);

      const storm = {
        id: s.id,
        name: s.name || 'Unnamed',
        classification: s.classification,
        category: cat,
        windKt: knots,
        windMph: knots ? Math.round(knots * KT_TO_MPH) : null,
        pressure: Number(s.pressure) || null,
        lat, lon,
        movementDir: Number(s.movementDir) || null,
        movementSpeed: Number(s.movementSpeed) || null,
        basin: s.binNumber || '',
        lastUpdate: s.lastUpdate ? new Date(s.lastUpdate) : null,
        advisoryUrl: s.publicAdvisory?.url ?? null,
        coneGraphic: s.forecastGraphics?.url ?? null,
      };
      storm.label = stormLabel(storm);
      storm.color = STORM_CATEGORY[cat ?? 0];
      if (place && Number.isFinite(lat) && Number.isFinite(lon)) {
        storm.distanceMiles = Math.round(haversineMiles(place, { lat, lon }));
      }
      return storm;
    })
    .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon))
    .sort((a, b) => (a.distanceMiles ?? 1e9) - (b.distanceMiles ?? 1e9));
  } catch (err) {
    console.warn('[storms] unavailable', err.message);
    return [];
  }
}

/** "25.7N" / "77.4W" → signed decimal degrees. */
function parseCoord(text) {
  const m = /^([\d.]+)\s*([NSEW])$/i.exec(String(text ?? '').trim());
  if (!m) return NaN;
  const value = parseFloat(m[1]);
  return /[SW]/i.test(m[2]) ? -value : value;
}

/**
 * Storms worth interrupting the home screen for: anything within
 * ~600 miles, or any major hurricane anywhere in the basin.
 */
export const notableStorms = (storms) =>
  storms.filter((s) => (s.distanceMiles != null && s.distanceMiles < 600) || s.category >= 3);

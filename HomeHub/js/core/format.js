/* Display formatting.

   Weather is stored canonically in °F / mph / inches; every conversion
   for display happens here so there is exactly one place that knows
   about the user's unit preference. */

import { state } from './store.js';
import { CALM, MILD, NOTABLE, HIGH, EXTREME, CRITICAL } from './palette.js';

export const fToC = (f) => (f - 32) * 5 / 9;
export const mphToKph = (v) => v * 1.609344;
export const inToMm = (v) => v * 25.4;

const round = (v, digits = 0) => {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
};

/** "72°" — the big glanceable number. */
export function temp(f, { unit = true } = {}) {
  if (f == null || Number.isNaN(f)) return '—';
  const v = state.units === 'C' ? fToC(f) : f;
  return `${Math.round(v)}${unit ? '°' : ''}`;
}

/** "72°F" for places that need the scale spelled out. */
export function tempWithScale(f) {
  if (f == null) return '—';
  return `${temp(f)}${state.units === 'C' ? 'C' : 'F'}`;
}

export function speed(mph, { unit = true } = {}) {
  if (mph == null) return '—';
  const kph = state.windUnit === 'kph';
  const v = kph ? mphToKph(mph) : mph;
  return `${Math.round(v)}${unit ? (kph ? ' km/h' : ' mph') : ''}`;
}

export function precip(inches) {
  if (inches == null) return '—';
  if (state.units === 'C') {
    const mm = inToMm(inches);
    return mm < 0.1 ? '0 mm' : `${round(mm, mm < 10 ? 1 : 0)} mm`;
  }
  return inches < 0.01 ? '0"' : `${round(inches, 2)}"`;
}

export const percent = (v) => (v == null ? '—' : `${Math.round(v)}%`);

const CARDINALS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                   'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** Accepts degrees or an already-cardinal string from NWS. */
export function windDir(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return CARDINALS[Math.round(value / 22.5) % 16];
}

/** Compass degrees for rotating a wind arrow. */
export function windDegrees(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  const idx = CARDINALS.indexOf(value.toUpperCase());
  return idx === -1 ? null : idx * 22.5;
}

export const distance = (miles) =>
  miles == null ? '—' : state.units === 'C'
    ? `${Math.round(miles * 1.609344)} km`
    : `${Math.round(miles)} mi`;

export const pressure = (hPa) =>
  hPa == null ? '—' : state.units === 'C'
    ? `${Math.round(hPa)} hPa`
    : `${round(hPa * 0.02953, 2)} in`;

/* ── Air quality scales ───────────────────────────────────── */

const AQI_BANDS = [
  { max: 50,  label: 'Good',            color: CALM, note: 'Air quality is good.' },
  { max: 100, label: 'Moderate',        color: MILD, note: 'Fine for most people.' },
  { max: 150, label: 'Sensitive Groups', color: NOTABLE, note: 'Sensitive groups should take it easy outdoors.' },
  { max: 200, label: 'Unhealthy',       color: HIGH, note: 'Limit prolonged time outdoors.' },
  { max: 300, label: 'Very Unhealthy',  color: EXTREME, note: 'Avoid outdoor activity.' },
  { max: Infinity, label: 'Hazardous',  color: CRITICAL, note: 'Stay indoors.' },
];

export const aqiBand = (aqi) =>
  aqi == null ? null : AQI_BANDS.find((b) => aqi <= b.max);

const UV_BANDS = [
  { max: 2,  label: 'Low',       color: CALM, note: 'No protection needed.' },
  { max: 5,  label: 'Moderate',  color: MILD, note: 'Sunscreen if you\'re out a while.' },
  { max: 7,  label: 'High',      color: NOTABLE, note: 'Hat, shade, sunscreen.' },
  { max: 10, label: 'Very High', color: HIGH, note: 'Limit midday sun.' },
  { max: Infinity, label: 'Extreme', color: EXTREME, note: 'Avoid midday sun entirely.' },
];

export const uvBand = (uv) =>
  uv == null ? null : UV_BANDS.find((b) => uv <= b.max);

const POLLEN_BANDS = [
  { max: 10,  label: 'Low',       color: CALM },
  { max: 50,  label: 'Moderate',  color: MILD },
  { max: 200, label: 'High',      color: NOTABLE },
  { max: Infinity, label: 'Very High', color: HIGH },
];

export const pollenBand = (grains) =>
  grains == null ? null : POLLEN_BANDS.find((b) => grains <= b.max);

/* ── Misc ─────────────────────────────────────────────────── */

/** Great-circle distance in miles — used for storm proximity. */
export function haversineMiles(a, b) {
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Trim a long NWS description into something readable on a wall. */
export function tidy(text, max = 400) {
  if (!text) return '';
  const clean = text.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max - 1).trimEnd() + '…' : clean;
}

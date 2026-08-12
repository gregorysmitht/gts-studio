/* Weather.

   Primary source is the National Weather Service: it's free, needs no
   key, and is the only one that carries real US watches and warnings.
   Open-Meteo is the fallback (and the primary outside NWS coverage).

   Everything is normalised into one shape and stored canonically in
   °F / mph / inches; conversion happens at render time in format.js.

     { source, updated, current, hourly[], daily[], alerts[] }
*/

import { get } from '../core/net.js';
import { sunTimes } from '../core/solar.js';
import { nativeHas, nativeWeather } from '../core/native.js';
import {
  fromNwsIcon, nwsIconIsNight, fromText, fromWmo, fromCloudCover,
  fromNwsWeatherValue, dominant, CONDITION_LABEL,
} from './conditions.js';

const NWS = 'https://api.weather.gov';
const OM = 'https://api.open-meteo.com/v1/forecast';

const cToF = (c) => (c == null ? null : c * 9 / 5 + 32);
const kmhToMph = (v) => (v == null ? null : v * 0.621371);
const msToMph = (v) => (v == null ? null : v * 2.236936);
const mmToIn = (v) => (v == null ? null : v / 25.4);
const mToMi = (v) => (v == null ? null : v / 1609.344);

/** Convert an NWS gridpoint value using its declared unit of measure. */
function fromUom(value, uom) {
  if (value == null) return null;
  const u = String(uom || '');
  if (u.includes('degC')) return cToF(value);
  if (u.includes('km_h-1')) return kmhToMph(value);
  if (u.includes('m_s-1')) return msToMph(value);
  if (u.includes('mm')) return mmToIn(value);
  if (u.endsWith(':m')) return mToMi(value);
  return value;
}

function parseDuration(iso) {
  const m = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso || '');
  if (!m) return 3600e3;
  const [, , , d, h, mi, s] = m;
  return ((Number(d || 0) * 24 + Number(h || 0)) * 3600 + Number(mi || 0) * 60 + Number(s || 0)) * 1000;
}

/**
 * Flatten an NWS gridpoint layer into an hour → value map.
 * Layers are sparse ISO intervals ("2026-08-11T13:00:00+00:00/PT6H"),
 * so each one is expanded across the hours it covers.
 */
function expandLayer(layer, transform = (v) => v) {
  const out = new Map();
  if (!layer?.values) return out;
  for (const { validTime, value } of layer.values) {
    const [startIso, durIso] = String(validTime).split('/');
    const start = Date.parse(startIso);
    if (Number.isNaN(start)) continue;
    const hours = Math.max(1, Math.round(parseDuration(durIso) / 3600e3));
    const converted = transform(value, layer.uom);
    for (let i = 0; i < hours; i++) out.set(hourKey(start + i * 3600e3), converted);
  }
  return out;
}

const hourKey = (ms) => Math.floor(ms / 3600e3) * 3600e3;

/* NWS coverage words → a rough probability, for thunder timing. */
const COVERAGE = {
  isolated: 20, slight_chance: 15, chance: 40, likely: 70, occasional: 60,
  definite: 90, scattered: 40, numerous: 70, areas: 50, patchy: 30,
  periods: 65, frequent: 75, brief: 30, intermittent: 40,
};

function thunderFromWeather(values) {
  if (!Array.isArray(values)) return 0;
  let best = 0;
  for (const v of values) {
    if (!/thunder/i.test(v?.weather || '')) continue;
    best = Math.max(best, COVERAGE[v.coverage] ?? 40);
  }
  return best;
}

/* ── National Weather Service ─────────────────────────────── */

/** Grid metadata for a coordinate. Rarely changes, so cached for a day. */
async function nwsPoint(lat, lon) {
  const url = `${NWS}/points/${lat.toFixed(4)},${lon.toFixed(4)}`;
  const json = await get(url, { proxy: true, ttl: 24 * 3600e3 });
  const p = json?.properties;
  if (!p?.gridId) throw new Error('No NWS grid for this location');
  return {
    office: p.gridId,
    x: p.gridX,
    y: p.gridY,
    city: p.relativeLocation?.properties?.city,
    state: p.relativeLocation?.properties?.state,
    timeZone: p.timeZone,
  };
}

async function loadNws(place) {
  const grid = await nwsPoint(place.lat, place.lon);
  const base = `${NWS}/gridpoints/${grid.office}/${grid.x},${grid.y}`;

  const [hourlyRes, dailyRes, rawRes] = await Promise.all([
    get(`${base}/forecast/hourly?units=us`, { proxy: true, ttl: 8 * 60e3 }),
    get(`${base}/forecast?units=us`, { proxy: true, ttl: 15 * 60e3 }),
    get(base, { proxy: true, ttl: 15 * 60e3 }).catch(() => null),
  ]);

  const raw = rawRes?.properties ?? {};
  const sky = expandLayer(raw.skyCover);
  const qpf = expandLayer(raw.quantitativePrecipitation, fromUom);
  const lal = expandLayer(raw.lightningActivityLevel);
  const gust = expandLayer(raw.windGust, fromUom);
  const wx = expandLayer(raw.weather, (v) => v);

  const periods = hourlyRes?.properties?.periods ?? [];
  const hourly = periods.slice(0, 72).map((p) => {
    const key = hourKey(Date.parse(p.startTime));
    const cover = sky.get(key);
    const wxValue = wx.get(key);
    const condition =
      fromNwsWeatherValue(wxValue) ||
      fromNwsIcon(p.icon) ||
      fromText(p.shortForecast) ||
      fromCloudCover(cover) ||
      'clear';

    return {
      time: new Date(p.startTime),
      temp: p.temperature,
      feelsLike: p.temperature,
      condition,
      summary: p.shortForecast,
      precipChance: p.probabilityOfPrecipitation?.value ?? 0,
      precipAmount: qpf.get(key) ?? 0,
      thunderChance: thunderFromWeather(wxValue),
      lightning: lal.get(key) ?? 0,
      cloudCover: cover ?? null,
      humidity: p.relativeHumidity?.value ?? null,
      dewPoint: cToF(p.dewpoint?.value),
      windSpeed: parseFloat(p.windSpeed) || 0,
      windGust: gust.get(key) ?? null,
      windDir: p.windDirection ?? null,
      night: !p.isDaytime,
    };
  });

  const daily = groupNwsDaily(dailyRes?.properties?.periods ?? [], hourly, place);

  const first = periods[0];
  const nowKey = hourKey(Date.now());
  const current = {
    temp: first?.temperature ?? null,
    feelsLike: first?.temperature ?? null,
    condition: hourly[0]?.condition ?? 'clear',
    summary: first?.shortForecast ?? CONDITION_LABEL[hourly[0]?.condition] ?? '',
    humidity: first?.relativeHumidity?.value ?? null,
    dewPoint: cToF(first?.dewpoint?.value),
    windSpeed: parseFloat(first?.windSpeed) || 0,
    windGust: gust.get(nowKey) ?? null,
    windDir: first?.windDirection ?? null,
    cloudCover: sky.get(nowKey) ?? null,
    pressure: null,
    visibility: null,
    night: first ? !first.isDaytime : nwsIconIsNight(first?.icon),
  };

  return {
    source: 'nws',
    grid,
    updated: new Date(),
    current,
    hourly,
    daily,
  };
}

/** NWS day/night periods → one entry per calendar day. */
function groupNwsDaily(periods, hourly, place) {
  const byDate = new Map();

  for (const p of periods) {
    const start = new Date(p.startTime);
    // A "Tonight"/"…Night" period belongs to the day it starts on.
    const key = start.toDateString();
    let day = byDate.get(key);
    if (!day) {
      day = {
        date: new Date(start.getFullYear(), start.getMonth(), start.getDate()),
        hi: null, lo: null,
        condition: null, summary: '', detail: '',
        precipChance: 0, precipAmount: 0,
        windSpeed: 0, windDir: null,
      };
      byDate.set(key, day);
    }
    const condition = fromNwsIcon(p.icon) || fromText(p.shortForecast) || 'clear';
    if (p.isDaytime) {
      day.hi = p.temperature;
      day.condition = condition;
      day.summary = p.shortForecast;
      day.detail = p.detailedForecast;
      day.windSpeed = parseFloat(p.windSpeed) || 0;
      day.windDir = p.windDirection;
    } else {
      day.lo = p.temperature;
      day.nightCondition = condition;
      day.nightSummary = p.shortForecast;
      day.nightDetail = p.detailedForecast;
      if (!day.condition) { day.condition = condition; day.summary = p.shortForecast; }
    }
    day.precipChance = Math.max(day.precipChance, p.probabilityOfPrecipitation?.value ?? 0);
  }

  // Fold hourly precipitation totals and sun times into each day.
  const days = [...byDate.values()].sort((a, b) => a.date - b.date);
  for (const day of days) {
    const hours = hourly.filter((h) => h.time.toDateString() === day.date.toDateString());
    day.precipAmount = hours.reduce((sum, h) => sum + (h.precipAmount || 0), 0);
    day.thunderChance = hours.reduce((max, h) => Math.max(max, h.thunderChance || 0), 0);
    if (hours.length && !day.condition) day.condition = dominant(hours.map((h) => h.condition));
    if (day.hi == null && hours.length) day.hi = Math.max(...hours.map((h) => h.temp));
    if (day.lo == null && hours.length) day.lo = Math.min(...hours.map((h) => h.temp));
    const { rise, set } = sunTimes(day.date, place.lat, place.lon);
    day.sunrise = rise;
    day.sunset = set;
  }
  return days;
}

/* ── Open-Meteo ───────────────────────────────────────────── */

async function loadOpenMeteo(place) {
  const params = new URLSearchParams({
    latitude: place.lat.toFixed(4),
    longitude: place.lon.toFixed(4),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,wind_gusts_10m,dew_point_2m',
    hourly: 'temperature_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m,relative_humidity_2m,dew_point_2m,is_day,visibility',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,uv_index_max',
    timezone: 'auto',
    forecast_days: '10',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch',
  });

  const json = await get(`${OM}?${params}`, { ttl: 10 * 60e3 });
  const c = json.current ?? {};
  const H = json.hourly ?? {};
  const D = json.daily ?? {};

  const hourly = (H.time ?? []).map((t, i) => {
    const code = H.weather_code?.[i];
    const condition = fromWmo(code);
    return {
      time: new Date(t),
      temp: H.temperature_2m?.[i] ?? null,
      feelsLike: H.apparent_temperature?.[i] ?? null,
      condition,
      summary: CONDITION_LABEL[condition],
      precipChance: H.precipitation_probability?.[i] ?? 0,
      precipAmount: H.precipitation?.[i] ?? 0,
      // Open-Meteo has no thunder probability; codes 95+ are the signal.
      thunderChance: code >= 95 ? 70 : code === 82 ? 25 : 0,
      lightning: code >= 95 ? 3 : 0,
      cloudCover: H.cloud_cover?.[i] ?? null,
      humidity: H.relative_humidity_2m?.[i] ?? null,
      dewPoint: H.dew_point_2m?.[i] ?? null,
      windSpeed: H.wind_speed_10m?.[i] ?? 0,
      windGust: H.wind_gusts_10m?.[i] ?? null,
      windDir: null,
      night: H.is_day?.[i] === 0,
    };
  }).filter((h) => h.time.getTime() > Date.now() - 3600e3).slice(0, 72);

  const daily = (D.time ?? []).map((t, i) => {
    const date = new Date(`${t}T12:00:00`);
    const condition = fromWmo(D.weather_code?.[i]);
    return {
      date: new Date(date.getFullYear(), date.getMonth(), date.getDate()),
      hi: D.temperature_2m_max?.[i] ?? null,
      lo: D.temperature_2m_min?.[i] ?? null,
      condition,
      summary: CONDITION_LABEL[condition],
      detail: '',
      precipChance: D.precipitation_probability_max?.[i] ?? 0,
      precipAmount: D.precipitation_sum?.[i] ?? 0,
      thunderChance: (D.weather_code?.[i] ?? 0) >= 95 ? 60 : 0,
      windSpeed: D.wind_speed_10m_max?.[i] ?? 0,
      uvMax: D.uv_index_max?.[i] ?? null,
      sunrise: D.sunrise?.[i] ? new Date(D.sunrise[i]) : null,
      sunset: D.sunset?.[i] ? new Date(D.sunset[i]) : null,
    };
  });

  const condition = fromWmo(c.weather_code);
  return {
    source: 'open-meteo',
    updated: new Date(),
    current: {
      temp: c.temperature_2m ?? null,
      feelsLike: c.apparent_temperature ?? null,
      condition,
      summary: CONDITION_LABEL[condition],
      humidity: c.relative_humidity_2m ?? null,
      dewPoint: c.dew_point_2m ?? null,
      windSpeed: c.wind_speed_10m ?? 0,
      windGust: c.wind_gusts_10m ?? null,
      windDir: c.wind_direction_10m ?? null,
      cloudCover: c.cloud_cover ?? null,
      pressure: c.pressure_msl ?? null,
      visibility: H.visibility?.[0] != null ? H.visibility[0] / 1609.344 : null,
      night: c.is_day === 0,
    },
    hourly,
    daily,
  };
}

/* ── Next-hour precipitation ──────────────────────────────────
   The "rain starts in 12 minutes" trick. Apple's WeatherKit and the
   late Dark Sky both charge for this; Open-Meteo's 15-minute grid gets
   most of the way there for free, and RainViewer's nowcast frames on
   the radar cover the rest visually.

   Resolution is 15 minutes, so this promises "in about 15 min", never
   "in 12 min" — it should not claim precision it doesn't have. */

const OM_MINUTELY = 'https://api.open-meteo.com/v1/forecast';

export async function loadNowcast(place) {
  try {
    const params = new URLSearchParams({
      latitude: place.lat.toFixed(4),
      longitude: place.lon.toFixed(4),
      minutely_15: 'precipitation,precipitation_probability',
      forecast_minutely_15: '8',      // two hours ahead
      past_minutely_15: '2',
      timezone: 'auto',
      precipitation_unit: 'inch',
    });
    const json = await get(`${OM_MINUTELY}?${params}`, { ttl: 5 * 60e3 });
    const M = json.minutely_15 ?? {};

    const steps = (M.time ?? []).map((t, i) => ({
      time: new Date(t),
      amount: M.precipitation?.[i] ?? 0,
      chance: M.precipitation_probability?.[i] ?? 0,
    }));

    const now = Date.now();
    const ahead = steps.filter((s) => +s.time > now - 60e3);
    if (!ahead.length) return null;

    const wet = (s) => s.amount > 0.002 || s.chance >= 50;
    const raining = wet(ahead[0]);
    const change = ahead.findIndex((s) => wet(s) !== raining);

    return {
      raining,
      steps: ahead,
      /** When it flips — starting, or stopping. Null if it holds for 2h. */
      changesAt: change === -1 ? null : ahead[change].time,
      peak: Math.max(...ahead.map((s) => s.chance)),
    };
  } catch (err) {
    console.info('[weather] nowcast unavailable —', err.message);
    return null;
  }
}

/** One short sentence, or null when there's nothing worth saying. */
export function nowcastSentence(nowcast) {
  if (!nowcast) return null;
  const { raining, changesAt } = nowcast;

  if (!changesAt) {
    return raining ? 'Rain continuing for the next hour' : null;
  }
  const minutes = Math.round((+changesAt - Date.now()) / 60000 / 5) * 5;
  if (minutes <= 0) return raining ? 'Rain stopping now' : 'Rain starting now';
  if (minutes > 90) return null;

  const about = minutes <= 15 ? `${minutes} min` : `${Math.round(minutes / 15) * 15} min`;
  return raining ? `Rain easing in about ${about}` : `Rain starting in about ${about}`;
}

/* ── Alerts ───────────────────────────────────────────────── */

const SEVERITY_ORDER = { Extreme: 4, Severe: 3, Moderate: 2, Minor: 1, Unknown: 0 };

/**
 * Active NWS watches, warnings and advisories for a point.
 * Returns [] rather than throwing — a failed alert fetch must never
 * take the rest of the weather panel down with it.
 */
export async function loadAlerts(place) {
  try {
    const url = `${NWS}/alerts/active?point=${place.lat.toFixed(4)},${place.lon.toFixed(4)}`;
    const json = await get(url, { proxy: true, ttl: 90e3 });

    return (json.features ?? [])
      .map((f) => {
        const p = f.properties ?? {};
        return {
          id: p.id ?? f.id,
          event: p.event ?? 'Weather Alert',
          severity: p.severity ?? 'Unknown',
          certainty: p.certainty,
          urgency: p.urgency,
          headline: p.headline ?? p.parameters?.NWSheadline?.[0] ?? '',
          description: p.description ?? '',
          instruction: p.instruction ?? '',
          areaDesc: p.areaDesc ?? '',
          sender: p.senderName ?? '',
          onset: p.onset ? new Date(p.onset) : (p.effective ? new Date(p.effective) : null),
          ends: p.ends ? new Date(p.ends) : (p.expires ? new Date(p.expires) : null),
          geometry: f.geometry ?? null,
          /* Tag the two families the hub calls out specially. */
          isThunder: /thunderstorm|tornado|lightning/i.test(p.event ?? ''),
          isTropical: /hurricane|tropical|storm surge|typhoon/i.test(p.event ?? ''),
        };
      })
      .sort((a, b) => (SEVERITY_ORDER[b.severity] ?? 0) - (SEVERITY_ORDER[a.severity] ?? 0));
  } catch (err) {
    console.warn('[weather] alerts unavailable', err.message);
    return [];
  }
}

/* ── Entry point ──────────────────────────────────────────── */

/**
 * Load a full weather model, preferring NWS and falling back cleanly.
 * Alerts are fetched alongside and are always NWS (US-only by nature).
 */
export async function loadWeather(place) {
  let model;

  /* WeatherKit first inside the native app: it is global, minute-level,
     and already paid for by the developer membership the app needs
     anyway. Its alerts republish NWS, so US alerts are equivalent. */
  if (nativeHas('weather')) {
    try {
      model = await nativeWeather(place);
    } catch (err) {
      console.info('[weather] WeatherKit unavailable —', err.message);
    }
  }

  if (!model) {
    try {
      model = await loadNws(place);
    } catch (err) {
      console.info('[weather] NWS unavailable, using Open-Meteo —', err.message);
      model = await loadOpenMeteo(place);
    }
  }

  // Sun times are computed locally so they exist even when a source omits them.
  if (!model.daily[0]?.sunrise) {
    for (const day of model.daily) {
      const { rise, set } = sunTimes(day.date, place.lat, place.lon);
      day.sunrise = rise;
      day.sunset = set;
    }
  }

  /* NWS is the authority for US alerts and carries the fuller text, so
     it wins whenever it answers. But it must not *erase* what the source
     already provided: WeatherKit returns its own warnings, and an empty
     or failed NWS request was quietly wiping them. A hub showing nothing
     during a thunderstorm watch because a second request timed out is
     worse than one showing a slightly terser warning. */
  const authoritative = await loadAlerts(place);
  if (authoritative.length || !model.alerts?.length) model.alerts = authoritative;

  model.place = place;
  return model;
}

/* ── Small derived helpers used by the UI ─────────────────── */

/** Next `count` hours from now. */
export const nextHours = (model, count = 5) => {
  const now = Date.now() - 30 * 60e3;
  return (model?.hourly ?? []).filter((h) => h.time.getTime() >= now).slice(0, count);
};

/** The first stretch of hours where rain is likely, e.g. "2 PM – 6 PM". */
export function nextPrecipWindow(model, threshold = 40) {
  const hours = nextHours(model, 24);
  const start = hours.findIndex((h) => h.precipChance >= threshold);
  if (start === -1) return null;
  let end = start;
  while (end + 1 < hours.length && hours[end + 1].precipChance >= threshold) end++;
  return { from: hours[start].time, to: hours[end].time, peak: Math.max(...hours.slice(start, end + 1).map((h) => h.precipChance)) };
}

/** Same idea for thunderstorms — what the hub surfaces as "storm risk". */
export function nextThunderWindow(model, threshold = 25) {
  const hours = nextHours(model, 24);
  const start = hours.findIndex((h) => h.thunderChance >= threshold);
  if (start === -1) return null;
  let end = start;
  while (end + 1 < hours.length && hours[end + 1].thunderChance >= threshold) end++;
  return { from: hours[start].time, to: hours[end].time, peak: Math.max(...hours.slice(start, end + 1).map((h) => h.thunderChance)) };
}

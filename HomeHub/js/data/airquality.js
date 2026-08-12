/* Air quality, UV and pollen — Open-Meteo's air-quality API.

   Free, no key, CORS-friendly. One caveat worth knowing: the pollen
   fields come from the CAMS *European* model, so outside Europe they
   come back null. The UI hides the pollen block when that happens
   rather than showing empty rows. */

import { get } from '../core/net.js';

const API = 'https://air-quality-api.open-meteo.com/v1/air-quality';

const POLLENS = [
  ['alder_pollen', 'Alder'],
  ['birch_pollen', 'Birch'],
  ['grass_pollen', 'Grass'],
  ['mugwort_pollen', 'Mugwort'],
  ['olive_pollen', 'Olive'],
  ['ragweed_pollen', 'Ragweed'],
];

export async function loadAirQuality(place) {
  const params = new URLSearchParams({
    latitude: place.lat.toFixed(4),
    longitude: place.lon.toFixed(4),
    current: [
      'us_aqi', 'pm2_5', 'pm10', 'ozone', 'nitrogen_dioxide',
      'sulphur_dioxide', 'carbon_monoxide', 'uv_index',
      ...POLLENS.map(([key]) => key),
    ].join(','),
    hourly: 'us_aqi,uv_index',
    timezone: 'auto',
    forecast_days: '2',
  });

  const json = await get(`${API}?${params}`, { ttl: 20 * 60e3 });
  const c = json.current ?? {};
  const H = json.hourly ?? {};

  const pollen = POLLENS
    .map(([key, label]) => ({ key, label, value: c[key] }))
    .filter((p) => p.value != null);

  // Peak UV still to come today, so the tile can say "peaks at 2 PM".
  const now = Date.now();
  let uvPeak = null;
  (H.time ?? []).forEach((t, i) => {
    const time = new Date(t);
    if (time.getTime() < now || time.toDateString() !== new Date().toDateString()) return;
    const uv = H.uv_index?.[i];
    if (uv != null && (!uvPeak || uv > uvPeak.value)) uvPeak = { time, value: uv };
  });

  return {
    updated: new Date(),
    aqi: c.us_aqi ?? null,
    uv: c.uv_index ?? null,
    uvPeak,
    pm25: c.pm2_5 ?? null,
    pm10: c.pm10 ?? null,
    ozone: c.ozone ?? null,
    no2: c.nitrogen_dioxide ?? null,
    so2: c.sulphur_dioxide ?? null,
    co: c.carbon_monoxide ?? null,
    pollen,
    /** True when the source has no pollen coverage for this location. */
    pollenUnavailable: pollen.length === 0,
    hourlyAqi: (H.time ?? []).map((t, i) => ({
      time: new Date(t),
      aqi: H.us_aqi?.[i] ?? null,
      uv: H.uv_index?.[i] ?? null,
    })),
  };
}

/** The dominant pollen right now, for the compact tile. */
export function topPollen(air) {
  if (!air?.pollen?.length) return null;
  return air.pollen.reduce((best, p) => (p.value > (best?.value ?? -1) ? p : best), null);
}

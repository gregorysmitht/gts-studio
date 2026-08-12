/* Place search — Open-Meteo's geocoding API. Free, keyless, CORS-friendly. */

import { get } from '../core/net.js';

const API = 'https://geocoding-api.open-meteo.com/v1/search';

/** @returns {Array<{name, lat, lon, detail}>} */
export async function searchPlaces(query) {
  const text = String(query || '').trim();
  if (text.length < 2) return [];

  const params = new URLSearchParams({ name: text, count: '8', language: 'en', format: 'json' });
  const json = await get(`${API}?${params}`, { ttl: 60 * 60e3 });

  return (json.results ?? []).map((r) => ({
    name: [r.name, r.admin1 && r.country_code === 'US' ? r.admin1 : r.country]
      .filter(Boolean)
      .join(', '),
    lat: r.latitude,
    lon: r.longitude,
    detail: [r.admin2, r.admin1, r.country].filter(Boolean).join(' · '),
  }));
}

/** Ask the browser where it is, then label the result. */
export function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This device has no location services'));
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        const place = { lat: +coords.latitude.toFixed(4), lon: +coords.longitude.toFixed(4) };
        resolve({ ...place, name: await reverseName(place) });
      },
      (err) => reject(new Error(
        err.code === err.PERMISSION_DENIED
          ? 'Location permission was denied — search for your town instead'
          : 'Could not get this device’s location'
      )),
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 10 * 60e3 }
    );
  });
}

/** Best-effort label for a coordinate, falling back to the numbers. */
export async function reverseName({ lat, lon }) {
  /* The National Weather Service names the nearest place for any US
     coordinate, and the forecast already asks this endpoint for its grid
     — same URL, same day-long cache, so this is usually a cache hit
     rather than a second request.

     Open-Meteo, which handles search, has no reverse endpoint at all.
     The previous attempt passed "28.66,-81.29" to its place-*name*
     search, which matched nothing, so every device that located itself
     ended up labelled with its own coordinates. */
  try {
    const json = await get(
      `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
      { proxy: true, ttl: 24 * 3600e3 }
    );
    const p = json?.properties?.relativeLocation?.properties;
    if (p?.city) return p.state ? `${p.city}, ${p.state}` : p.city;
  } catch { /* outside the US, or NWS unreachable */ }

  // Honest last resort: a coordinate beats a confidently wrong town.
  return `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
}

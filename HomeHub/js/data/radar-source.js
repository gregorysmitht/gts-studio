/* Radar frames — RainViewer.

   One index request returns every available frame: roughly two hours of
   past scans plus a half-hour nowcast, each a tile path the map can
   fetch directly. Free, keyless, and CORS-enabled, so no proxy needed.

   Tile URL shape:
     {host}{path}/{size}/{z}/{x}/{y}/{scheme}/{smooth}_{snow}.png
*/

import { get } from '../core/net.js';

const INDEX = 'https://api.rainviewer.com/public/weather-maps.json';

/** RainViewer's built-in colour schemes. */
export const SCHEMES = [
  { id: 4, name: 'Classic' },
  { id: 2, name: 'Universal Blue' },
  { id: 6, name: 'NEXRAD' },
  { id: 7, name: 'Rainbow' },
  { id: 8, name: 'Dark Sky' },
];

/**
 * @returns {{host:string, frames:Array, nowIndex:number, generated:Date}}
 *   frames are ordered oldest → newest; `nowIndex` is the last observed
 *   scan, so anything after it is forecast.
 */
export async function loadRadarIndex() {
  const json = await get(INDEX, { ttl: 4 * 60e3 });
  const host = json.host || 'https://tilecache.rainviewer.com';

  const past = (json.radar?.past ?? []).map((f) => ({ ...f, forecast: false }));
  const nowcast = (json.radar?.nowcast ?? []).map((f) => ({ ...f, forecast: true }));
  const frames = [...past, ...nowcast].map((f) => ({
    time: new Date(f.time * 1000),
    path: f.path,
    forecast: f.forecast,
  }));

  return {
    host,
    frames,
    nowIndex: Math.max(0, past.length - 1),
    generated: new Date((json.generated ?? Date.now() / 1000) * 1000),
    satellite: (json.satellite?.infrared ?? []).map((f) => ({
      time: new Date(f.time * 1000),
      path: f.path,
    })),
  };
}

/* Must match TILE in js/ui/map.js, which addresses tiles on a 256px
   grid. A 512px tile at zoom z covers the same ground as a 256px tile at
   z+1, so handing 256-grid coordinates to the /512/ endpoint asks for
   tiles outside the served range. RainViewer answers that with a picture
   of the words "Zoom Level Not Supported", and the map dutifully tiles
   the country with it. */
const TILE_SIZE = 256;

/**
 * Build a tile URL template for a frame, with {z}/{x}/{y} placeholders
 * the map engine substitutes per tile.
 */
export function frameTemplate(index, frame, { size = TILE_SIZE, scheme = 4, smooth = 1, snow = 1 } = {}) {
  return `${index.host}${frame.path}/${size}/{z}/{x}/{y}/${scheme}/${smooth}_${snow}.png`;
}

/** Same, for the infrared satellite layer. */
export function satelliteTemplate(index, frame, { size = TILE_SIZE } = {}) {
  return `${index.host}${frame.path}/${size}/{z}/{x}/{y}/0/0_0.png`;
}

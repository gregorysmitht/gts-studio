/* The full radar.

   Animated RainViewer reflectivity over a dark basemap, with NWS alert
   polygons, active tropical systems, and a scrubbable timeline that
   runs from roughly two hours back into the half-hour nowcast. */

import { h, fill, toast } from '../core/dom.js';
import { clockTime } from '../core/time.js';
import { icon } from './icons.js';
import { MapView } from './map.js';
import { loadRadarIndex, frameTemplate, satelliteTemplate } from '../data/radar-source.js';
import { live } from '../data/hub.js';
import { state } from '../core/store.js';
import { CATEGORY_COLOR } from '../data/storms.js';
import { RADAR_RAMP } from '../core/palette.js';

const BASE = 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png';
const LABELS = 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}@2x.png';

const FRAME_MS = 420;      // per animation step
const HOLD_LAST_MS = 1300; // pause on the newest frame before looping

/* NWS severity → polygon colours. */
const ALERT_STYLE = {
  Extreme:  { stroke: 'rgba(224,64,251,0.95)', fill: 'rgba(224,64,251,0.16)' },
  Severe:   { stroke: 'rgba(255,82,82,0.95)',  fill: 'rgba(255,82,82,0.15)' },
  Moderate: { stroke: 'rgba(255,179,0,0.9)',   fill: 'rgba(255,179,0,0.13)' },
  Minor:    { stroke: 'rgba(79,195,247,0.9)',  fill: 'rgba(79,195,247,0.12)' },
  Unknown:  { stroke: 'rgba(255,255,255,0.6)', fill: 'rgba(255,255,255,0.08)' },
};

/**
 * Mount the radar into a container.
 * @returns {{destroy:Function}} teardown handle for the panel
 */
export function mountRadar(container, { onAlertTap } = {}) {
  const place = state.place;

  const mapEl = h('div.radar-map');
  const timeline = h('div.radar-timeline');
  const stamp = h('div.radar-stamp');
  const legend = buildLegend();

  const view = {
    playing: true,
    frames: [],
    index: 0,
    nowIndex: 0,
    index_: null,
    showAlerts: true,
    showStorms: true,
    satellite: false,
    scheme: 4,
  };

  const layerToggles = h('div.radar-layers');

  fill(container,
    mapEl,
    h('div.radar-overlay-ui',
      h('div.radar-top',
        stamp,
        h('div.spacer'),
        layerToggles,
      ),
      h('div.radar-side',
        h('button.icon-btn', { onclick: () => map.zoomBy(1), 'aria-label': 'Zoom in' }, icon('plus', { size: 24 })),
        h('button.icon-btn', { onclick: () => map.zoomBy(-1), 'aria-label': 'Zoom out' }, icon('minus', { size: 24 })),
        h('button.icon-btn', {
          onclick: () => map.setView({ lat: place.lat, lon: place.lon }, 8),
          'aria-label': 'Centre on home',
        }, icon('crosshair', { size: 22 })),
      ),
      legend,
      h('div.radar-bottom',
        h('button.icon-btn.radar-play', {
          onclick: () => { view.playing = !view.playing; renderPlay(); },
          'aria-label': 'Play or pause the radar loop',
        }),
        timeline,
      ),
      h('div.map-attribution', '© OpenStreetMap · © CARTO · Radar © RainViewer'),
    ),
  );

  const map = new MapView(mapEl, {
    center: { lat: place.lat, lon: place.lon },
    zoom: 8,
    minZoom: 3,
    maxZoom: 12,
    base: BASE,
  });
  map.setLabels(LABELS);

  const playButton = container.querySelector('.radar-play');
  const renderPlay = () => {
    fill(playButton, icon(view.playing ? 'pause' : 'play', { size: 24 }));
  };
  renderPlay();

  /* ── Home + storm markers ───────────────────────────────── */

  function refreshMarkers() {
    const markers = [{
      lat: place.lat,
      lon: place.lon,
      render: () => h('div.map-home', h('div.map-home-dot'), h('div.map-home-ring')),
    }];

    if (view.showStorms) {
      for (const storm of live.storms ?? []) {
        markers.push({
          lat: storm.lat,
          lon: storm.lon,
          onclick: () => toast(
            `${storm.name} — ${storm.label}, ${storm.windMph} mph${storm.distanceMiles != null ? `, ${storm.distanceMiles} mi away` : ''}`
          ),
          render: () => h('div.map-storm', {
            style: { '--storm': CATEGORY_COLOR[storm.category ?? 0] },
          },
            h('div.map-storm-spin', icon('hurricane', { size: 30, stroke: 2.2 })),
            h('div.map-storm-name', storm.name),
          ),
        });
      }
    }
    map.setMarkers(markers);
  }

  function refreshAlerts() {
    if (!view.showAlerts) return map.setPolygons([]);
    const polygons = (live.weather?.alerts ?? [])
      .filter((a) => a.geometry)
      .map((a) => {
        const style = ALERT_STYLE[a.severity] ?? ALERT_STYLE.Unknown;
        return { geometry: a.geometry, stroke: style.stroke, fill: style.fill, lineWidth: 2.5 };
      });
    map.setPolygons(polygons);
  }

  /* ── Frames ─────────────────────────────────────────────── */

  let index = null;

  async function loadFrames() {
    try {
      index = await loadRadarIndex();
      view.frames = index.frames;
      view.nowIndex = index.nowIndex;
      view.index = index.nowIndex;
      renderTimeline();
      showFrame(view.index);
      // Warm the neighbouring frames so the loop starts smoothly.
      for (const frame of view.frames.slice(Math.max(0, view.nowIndex - 3), view.nowIndex + 3)) {
        map.preload(frameTemplate(index, frame, { scheme: view.scheme }));
      }
    } catch (err) {
      console.warn('[radar] frames unavailable', err.message);
      fill(stamp, h('span.radar-stamp-warn', 'Radar unavailable'));
      fill(timeline, h('div.radar-timeline-empty',
        'Live radar could not be reached. Check the network connection.'));
    }
  }

  function showFrame(i) {
    if (!index || !view.frames.length) return;
    view.index = ((i % view.frames.length) + view.frames.length) % view.frames.length;
    const frame = view.frames[view.index];

    map.setOverlay(
      view.satellite
        ? satelliteTemplate(index, nearestSatellite(frame))
        : frameTemplate(index, frame, { scheme: view.scheme }),
      view.satellite ? 0.62 : 0.8
    );

    fill(stamp,
      h('span.radar-stamp-time', clockTime(frame.time)),
      frame.forecast
        ? h('span.radar-stamp-tag.forecast', 'Forecast')
        : view.index === view.nowIndex
          ? h('span.radar-stamp-tag.live', 'Latest')
          : h('span.radar-stamp-tag', 'Past'),
    );

    for (const tick of timeline.querySelectorAll('.radar-tick')) {
      tick.classList.toggle('on', Number(tick.dataset.i) === view.index);
    }

    // Keep the next frame warm.
    const next = view.frames[(view.index + 1) % view.frames.length];
    if (next && !view.satellite) map.preload(frameTemplate(index, next, { scheme: view.scheme }));
  }

  function nearestSatellite(frame) {
    const sats = index.satellite ?? [];
    if (!sats.length) return frame;
    return sats.reduce((best, s) =>
      Math.abs(s.time - frame.time) < Math.abs(best.time - frame.time) ? s : best, sats[0]);
  }

  function renderTimeline() {
    fill(timeline,
      h('div.radar-track', ...view.frames.map((frame, i) =>
        h(`button.radar-tick${frame.forecast ? '.forecast' : ''}${i === view.nowIndex ? '.now' : ''}`, {
          dataset: { i },
          onclick: () => { view.playing = false; renderPlay(); showFrame(i); },
          'aria-label': `Radar at ${clockTime(frame.time)}`,
        })
      )),
      h('div.radar-track-labels',
        h('span', view.frames.length ? clockTime(view.frames[0].time) : ''),
        h('span.radar-track-now', 'Now'),
        h('span', view.frames.length ? clockTime(view.frames[view.frames.length - 1].time) : ''),
      ),
    );
  }

  /* ── Layer toggles ──────────────────────────────────────── */

  function renderToggles() {
    fill(layerToggles,
      toggle('Radar', !view.satellite, () => { view.satellite = false; showFrame(view.index); renderToggles(); }),
      toggle('Satellite', view.satellite, () => { view.satellite = true; showFrame(view.index); renderToggles(); }),
      toggle('Alerts', view.showAlerts, () => { view.showAlerts = !view.showAlerts; refreshAlerts(); renderToggles(); }),
      (live.storms?.length
        ? toggle('Storms', view.showStorms, () => { view.showStorms = !view.showStorms; refreshMarkers(); renderToggles(); })
        : null),
    );
  }

  const toggle = (label, on, onclick) =>
    h(`button.radar-toggle${on ? '.on' : ''}`, { onclick }, label);

  /* ── Animation loop ─────────────────────────────────────── */

  let timer = null;
  function tick() {
    if (view.playing && view.frames.length) {
      const atEnd = view.index === view.frames.length - 1;
      showFrame(atEnd ? 0 : view.index + 1);
      timer = setTimeout(tick, atEnd ? HOLD_LAST_MS : FRAME_MS);
    } else {
      timer = setTimeout(tick, FRAME_MS);
    }
  }

  renderToggles();
  refreshMarkers();
  refreshAlerts();
  loadFrames();
  tick();

  // Alert polygons are tappable through the map's click handler.
  mapEl.addEventListener('click', (event) => {
    if (!onAlertTap || event.target.closest('.map-marker')) return;
    const point = map.screenToLatLon(
      event.clientX - mapEl.getBoundingClientRect().left,
      event.clientY - mapEl.getBoundingClientRect().top
    );
    const hit = (live.weather?.alerts ?? []).find((a) => a.geometry && pointInGeometry(point, a.geometry));
    if (hit) onAlertTap(hit);
  });

  return {
    destroy() {
      clearTimeout(timer);
      map.destroy();
    },
    refresh() {
      refreshAlerts();
      refreshMarkers();
      renderToggles();
    },
  };
}

/* ── Geometry ─────────────────────────────────────────────── */

function pointInGeometry({ lat, lon }, geometry) {
  const rings = geometry.type === 'Polygon'
    ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates : [];
  return rings.some((polygon) => {
    const [outer, ...holes] = polygon;
    if (!pointInRing(lon, lat, outer)) return false;
    return !holes.some((hole) => pointInRing(lon, lat, hole));
  });
}

/** Standard ray-casting test. */
function pointInRing(x, y, ring = []) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* ── Legend ───────────────────────────────────────────────── */

/* Only the two ends are labelled — four labels under a 180px bar just
   run together, and the colour ramp reads on its own. */
function buildLegend() {
  const ramp = RADAR_RAMP;
  return h('div.radar-legend',
    h('div.radar-legend-bar', ...ramp.map((color) =>
      h('span', { style: { background: color } }))),
    h('div.radar-legend-labels',
      h('span', 'Light'),
      h('span', 'Intense'),
    ),
  );
}

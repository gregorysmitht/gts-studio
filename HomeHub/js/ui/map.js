/* ============================================================
   A small slippy map, built from scratch.

   Using Leaflet here would mean a CDN dependency on a display that
   needs to survive a flaky network, and a default look that fights the
   rest of the hub. This is ~400 lines and does exactly what the radar
   needs: Web Mercator tiles, momentum panning, pinch zoom, GeoJSON
   polygons for alert areas, and DOM markers for storms and home.

   Tiles render to canvas; markers are real elements so they stay crisp
   and easy to tap.
   ============================================================ */

import { h, fill } from '../core/dom.js';

const TILE = 256;
const MAX_CACHE = 420;

/* ── Projection ───────────────────────────────────────────── */

export function project(lat, lon, zoom) {
  const scale = TILE * 2 ** zoom;
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

export function unproject(x, y, zoom) {
  const scale = TILE * 2 ** zoom;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  return {
    lon: (x / scale) * 360 - 180,
    lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))),
  };
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/* ── Shared tile cache ────────────────────────────────────── */

const cache = new Map();   // key → { img, ok }

function tileImage(url, onLoad) {
  let entry = cache.get(url);
  if (entry) return entry;

  const img = new Image();
  entry = { img, ok: false, failed: false };
  cache.set(url, entry);

  img.onload = () => { entry.ok = true; onLoad?.(); };
  img.onerror = () => { entry.failed = true; };
  img.decoding = 'async';
  img.src = url;

  // Cheap LRU: once over budget, drop the oldest inserted entries.
  if (cache.size > MAX_CACHE) {
    const excess = cache.size - MAX_CACHE;
    let i = 0;
    for (const key of cache.keys()) {
      if (i++ >= excess) break;
      if (key !== url) cache.delete(key);
    }
  }
  return entry;
}

const fillTemplate = (template, z, x, y) =>
  template
    .replace('{z}', z)
    .replace('{x}', x)
    .replace('{y}', y)
    .replace('{s}', 'abc'[(x + y) % 3]);

/* ── Map ──────────────────────────────────────────────────── */

export class MapView {
  constructor(container, {
    center = { lat: 35.2271, lon: -80.8431 },
    zoom = 7,
    minZoom = 3,
    maxZoom = 12,
    base = null,
    onMove = null,
  } = {}) {
    this.container = container;
    this.center = { ...center };
    this.zoom = zoom;
    this.minZoom = minZoom;
    this.maxZoom = maxZoom;
    this.onMove = onMove;

    this.layers = { base, overlay: null, labels: null };
    this.overlayOpacity = 0.78;
    this.polygons = [];
    this.markers = [];

    this.canvas = h('canvas.map-canvas');
    this.markerHost = h('div.map-markers');
    this.container.classList.add('map-root');
    fill(this.container, this.canvas, this.markerHost);

    this.ctx = this.canvas.getContext('2d');
    this.dirty = true;
    this.raf = null;
    this.destroyed = false;

    this._bindPointer();
    this._observer = new ResizeObserver(() => this.resize());
    this._observer.observe(this.container);
    this.resize();
    this._loop();
  }

  /* ── Layer setters ─────────────────────────────────────── */

  setBase(template) { this.layers.base = template; this.invalidate(); }

  setOverlay(template, opacity = this.overlayOpacity) {
    this.layers.overlay = template;
    this.overlayOpacity = opacity;
    this.invalidate();
  }

  /** Place names, drawn above the radar so they stay readable. */
  setLabels(template) { this.layers.labels = template; this.invalidate(); }

  /**
   * Preload a frame's tiles for the current view so radar animation
   * doesn't flash empty on the first pass through the loop.
   */
  preload(template) {
    if (!template) return;
    for (const t of this._visibleTiles()) {
      tileImage(fillTemplate(template, t.z, t.x, t.y), () => this.invalidate());
    }
  }

  setPolygons(polygons) { this.polygons = polygons ?? []; this.invalidate(); }

  setMarkers(markers) {
    this.markers = markers ?? [];
    fill(this.markerHost, ...this.markers.map((m) => {
      const el = m.render ? m.render() : h('div.map-pin');
      el.classList.add('map-marker');
      if (m.onclick) {
        el.addEventListener('click', (e) => { e.stopPropagation(); m.onclick(m); });
        el.classList.add('clickable');
      }
      m._el = el;
      return el;
    }));
    this.invalidate();
  }

  /* ── View control ──────────────────────────────────────── */

  setView(center, zoom) {
    if (center) this.center = { ...center };
    if (zoom != null) this.zoom = clamp(zoom, this.minZoom, this.maxZoom);
    this.invalidate();
    this.onMove?.(this.center, this.zoom);
  }

  zoomBy(delta, anchor) {
    const next = clamp(this.zoom + delta, this.minZoom, this.maxZoom);
    if (next === this.zoom) return;

    if (anchor) {
      // Keep the point under the finger fixed while zooming.
      const before = this.screenToLatLon(anchor.x, anchor.y);
      this.zoom = next;
      const after = this.screenToLatLon(anchor.x, anchor.y);
      this.center = {
        lat: this.center.lat + (before.lat - after.lat),
        lon: this.center.lon + (before.lon - after.lon),
      };
    } else {
      this.zoom = next;
    }
    this._clampCenter();
    this.invalidate();
    this.onMove?.(this.center, this.zoom);
  }

  screenToLatLon(px, py) {
    const { width, height } = this._size();
    const c = project(this.center.lat, this.center.lon, this.zoom);
    return unproject(c.x + (px - width / 2), c.y + (py - height / 2), this.zoom);
  }

  latLonToScreen(lat, lon) {
    const { width, height } = this._size();
    const c = project(this.center.lat, this.center.lon, this.zoom);
    const p = project(lat, lon, this.zoom);
    return { x: p.x - c.x + width / 2, y: p.y - c.y + height / 2 };
  }

  /* ── Internals ─────────────────────────────────────────── */

  _size() {
    return { width: this.container.clientWidth || 1, height: this.container.clientHeight || 1 };
  }

  resize() {
    const { width, height } = this._size();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.invalidate();
  }

  invalidate() { this.dirty = true; }

  _loop() {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(() => this._loop());
    if (this._inertia) this._stepInertia();
    if (!this.dirty) return;
    this.dirty = false;
    this._draw();
  }

  /** Latitude is clamped so the map can't be dragged off the world. */
  _clampCenter() {
    this.center.lat = clamp(this.center.lat, -85, 85);
    this.center.lon = ((((this.center.lon + 180) % 360) + 360) % 360) - 180;
  }

  _visibleTiles() {
    const { width, height } = this._size();
    const z = Math.round(this.zoom);
    const scale = 2 ** (this.zoom - z);
    const c = project(this.center.lat, this.center.lon, z);

    const halfW = width / 2 / scale;
    const halfH = height / 2 / scale;
    const count = 2 ** z;

    const xMin = Math.floor((c.x - halfW) / TILE);
    const xMax = Math.floor((c.x + halfW) / TILE);
    const yMin = Math.max(0, Math.floor((c.y - halfH) / TILE));
    const yMax = Math.min(count - 1, Math.floor((c.y + halfH) / TILE));

    const tiles = [];
    for (let x = xMin; x <= xMax; x++) {
      for (let y = yMin; y <= yMax; y++) {
        tiles.push({ z, x: ((x % count) + count) % count, y, worldX: x, worldY: y, scale, c });
      }
    }
    return tiles;
  }

  _drawLayer(template, alpha) {
    if (!template) return;
    const { width, height } = this._size();
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;

    for (const t of this._visibleTiles()) {
      const entry = tileImage(fillTemplate(template, t.z, t.x, t.y), () => this.invalidate());
      if (!entry.ok) continue;

      const sx = (t.worldX * TILE - t.c.x) * t.scale + width / 2;
      const sy = (t.worldY * TILE - t.c.y) * t.scale + height / 2;
      const size = TILE * t.scale;
      // Half-pixel overdraw hides seams between neighbouring tiles.
      ctx.drawImage(entry.img, sx, sy, size + 0.6, size + 0.6);
    }
    ctx.restore();
  }

  _draw() {
    const { width, height } = this._size();
    const ctx = this.ctx;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#0b111c';
    ctx.fillRect(0, 0, width, height);

    this._drawLayer(this.layers.base, 1);
    this._drawLayer(this.layers.overlay, this.overlayOpacity);
    this._drawLayer(this.layers.labels, 0.92);
    this._drawPolygons();
    this._positionMarkers();
  }

  _drawPolygons() {
    const ctx = this.ctx;
    for (const poly of this.polygons) {
      const rings = geometryRings(poly.geometry);
      if (!rings.length) continue;

      ctx.save();
      ctx.beginPath();
      for (const ring of rings) {
        ring.forEach(([lon, lat], i) => {
          const p = this.latLonToScreen(lat, lon);
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.closePath();
      }
      ctx.fillStyle = poly.fill ?? 'rgba(255,82,82,0.16)';
      ctx.fill('evenodd');
      ctx.lineWidth = poly.lineWidth ?? 2.5;
      ctx.strokeStyle = poly.stroke ?? 'rgba(255,82,82,0.85)';
      if (poly.dash) ctx.setLineDash(poly.dash);
      ctx.stroke();
      ctx.restore();
    }
  }

  _positionMarkers() {
    const { width, height } = this._size();
    for (const marker of this.markers) {
      if (!marker._el) continue;
      const p = this.latLonToScreen(marker.lat, marker.lon);
      const visible = p.x > -80 && p.x < width + 80 && p.y > -80 && p.y < height + 80;
      marker._el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
      marker._el.style.visibility = visible ? 'visible' : 'hidden';
    }
  }

  /* ── Gestures ──────────────────────────────────────────── */

  _bindPointer() {
    const el = this.container;
    const pointers = new Map();
    let last = null;
    let pinch = null;
    let lastTap = 0;

    const localPoint = (event) => {
      const rect = el.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    el.addEventListener('pointerdown', (event) => {
      el.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, localPoint(event));
      this._inertia = null;

      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = {
          distance: Math.hypot(a.x - b.x, a.y - b.y),
          zoom: this.zoom,
          anchor: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        };
      } else {
        last = { ...localPoint(event), t: performance.now() };
        this._velocity = { x: 0, y: 0 };
      }
    });

    el.addEventListener('pointermove', (event) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, localPoint(event));

      if (pointers.size === 2 && pinch) {
        const [a, b] = [...pointers.values()];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const target = pinch.zoom + Math.log2(distance / (pinch.distance || 1));
        const anchor = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        this.zoomBy(clamp(target, this.minZoom, this.maxZoom) - this.zoom, anchor);
        return;
      }

      if (!last) return;
      const point = localPoint(event);
      const now = performance.now();
      const dt = Math.max(1, now - last.t);
      this._panBy(point.x - last.x, point.y - last.y);
      this._velocity = {
        x: (point.x - last.x) / dt,
        y: (point.y - last.y) / dt,
      };
      last = { ...point, t: now };
    });

    const release = (event) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) {
        last = null;
        const v = this._velocity;
        if (v && Math.hypot(v.x, v.y) > 0.12) this._inertia = { ...v };

        // Double-tap to zoom in.
        const now = performance.now();
        if (now - lastTap < 300) {
          this.zoomBy(1, localPoint(event));
          lastTap = 0;
        } else lastTap = now;
      }
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);

    el.addEventListener('wheel', (event) => {
      event.preventDefault();
      this._inertia = null;
      this.zoomBy(event.deltaY > 0 ? -0.4 : 0.4, localPoint(event));
    }, { passive: false });

    // Stop the page itself from scrolling or bouncing behind the map.
    el.addEventListener('touchmove', (event) => event.preventDefault(), { passive: false });
  }

  _panBy(dx, dy) {
    const { width, height } = this._size();
    const c = project(this.center.lat, this.center.lon, this.zoom);
    const next = unproject(c.x - dx, c.y - dy, this.zoom);
    this.center = next;
    this._clampCenter();
    this.invalidate();
    this.onMove?.(this.center, this.zoom);
    void width; void height;
  }

  _stepInertia() {
    const v = this._inertia;
    if (!v) return;
    this._panBy(v.x * 16, v.y * 16);
    v.x *= 0.92;
    v.y *= 0.92;
    if (Math.hypot(v.x, v.y) < 0.02) this._inertia = null;
  }

  destroy() {
    this.destroyed = true;
    cancelAnimationFrame(this.raf);
    this._observer?.disconnect();
    this._inertia = null;
  }
}

/** GeoJSON geometry → list of coordinate rings, ignoring geometry type quirks. */
function geometryRings(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates ?? [];
  if (geometry.type === 'MultiPolygon') return (geometry.coordinates ?? []).flat();
  if (geometry.type === 'GeometryCollection') {
    return (geometry.geometries ?? []).flatMap(geometryRings);
  }
  return [];
}

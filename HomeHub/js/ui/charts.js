/* SVG charts.

   Drawn at a fixed viewBox and scaled by CSS, so they stay sharp at any
   panel size without needing to re-render on resize. Type sizes are
   chosen so they land near 16–18 real pixels at typical panel widths —
   this is still meant to be read from across a room. */

import { temp } from '../core/format.js';
import { hourLabel } from '../core/time.js';

const NS = 'http://www.w3.org/2000/svg';

function svgRoot(width, height, className) {
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('viewBox', `0 0 ${width} ${height}`);
  el.setAttribute('class', className);
  el.setAttribute('preserveAspectRatio', 'none');
  el.setAttribute('role', 'img');
  return el;
}

/** Catmull–Rom → cubic Bézier, for a temperature line that isn't jagged. */
function smoothPath(points) {
  if (points.length < 2) return '';
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

/**
 * The "when is it going to rain" chart: precipitation probability as
 * columns, thunderstorm risk stacked in warning yellow on top of them,
 * and the temperature curve riding above.
 */
export function dayAheadChart(hours, { count = 24 } = {}) {
  const data = hours.slice(0, count);
  if (!data.length) return document.createElementNS(NS, 'svg');

  const W = 1000, H = 265;
  const padL = 8, padR = 74, padTop = 52, padBottom = 50;
  const plotW = W - padL - padR;
  const plotH = H - padTop - padBottom;
  const barW = plotW / data.length;

  const svg = svgRoot(W, H, 'chart chart-day');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const temps = data.map((d) => d.temp).filter((v) => v != null);
  const tMin = Math.min(...temps) - 3;
  const tMax = Math.max(...temps) + 3;
  const tSpan = Math.max(1, tMax - tMin);

  const y = (pct) => padTop + plotH * (1 - pct / 100);
  const tempY = (v) => padTop + plotH * (1 - (v - tMin) / tSpan) * 0.55 + plotH * 0.06;

  let out = `
  <defs>
    <linearGradient id="ch-rain" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#9BC6DE" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#5A87A8" stop-opacity="0.55"/>
    </linearGradient>
    <linearGradient id="ch-storm" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#E8CE8E" stop-opacity="0.98"/>
      <stop offset="100%" stop-color="#C99248" stop-opacity="0.7"/>
    </linearGradient>
  </defs>`;

  // Horizontal guides at 25/50/75/100% chance, labelled down the right
  // margin so they never collide with the temperature callouts.
  for (const pct of [25, 50, 75, 100]) {
    out += `<line x1="${padL}" y1="${y(pct)}" x2="${W - padR}" y2="${y(pct)}"
             stroke="rgba(255,255,255,0.10)" stroke-width="1.5"/>
            <text x="${W - padR + 10}" y="${y(pct) + 7}" fill="rgba(255,255,255,0.34)"
             font-size="19" font-weight="600">${pct}%</text>`;
  }

  // Precip columns, with thunder risk drawn over the top of each.
  data.forEach((hour, i) => {
    const x = padL + i * barW;
    const w = Math.max(3, barW - 5);
    const pop = hour.precipChance ?? 0;
    const thunder = hour.thunderChance ?? 0;

    if (pop > 0) {
      const barH = (plotH * pop) / 100;
      out += `<rect x="${x + 2.5}" y="${y(pop)}" width="${w}" height="${barH}"
               rx="5" fill="url(#ch-rain)"/>`;
    }
    if (thunder > 0) {
      const barH = (plotH * thunder) / 100;
      out += `<rect x="${x + 2.5 + w * 0.22}" y="${y(thunder)}" width="${w * 0.56}" height="${barH}"
               rx="4" fill="url(#ch-storm)"/>`;
    }
  });

  // Temperature curve above the columns.
  const points = data.map((hour, i) => ({
    x: padL + i * barW + barW / 2,
    y: tempY(hour.temp),
  }));
  const line = smoothPath(points);
  // A soft shadow under the line keeps it legible where it crosses a bar,
  // without the heavy filled area that would hide the columns entirely.
  out += `<path d="${line}" fill="none" stroke="rgba(6,10,18,0.55)"
           stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`;
  out += `<path d="${line}" fill="none" stroke="rgba(255,255,255,0.96)"
           stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`;

  /* Two tiers of label. Every third hour gets a quiet reading, aligned
     with the hour ticks below, so the curve can be read rather than just
     admired. Now, the high and the low keep the loud treatment, because
     those are the three numbers anyone repeats out loud. */
  const hiIdx = data.indexOf(data.reduce((a, b) => (b.temp > a.temp ? b : a)));
  const loIdx = data.indexOf(data.reduce((a, b) => (b.temp < a.temp ? b : a)));
  /* Placed loudest-first, and a candidate is dropped if it would sit on
     top of one already down. Without this, a day whose low happens to be
     the hour after "now" prints the two readings through each other. */
  const placed = [];
  const MIN_GAP = 62;
  const fits = (x) => placed.every((px) => Math.abs(px - x) >= MIN_GAP);

  const candidates = [
    ...[0, hiIdx, loIdx].map((i) => ({ i, loud: true })),
    ...data.map((_, i) => ({ i, loud: false })).filter(({ i }) => i % 3 === 0),
  ];

  for (const { i, loud } of candidates) {
    const p = points[i];
    if (!p || data[i]?.temp == null || !fits(p.x)) continue;
    placed.push(p.x);
    out += loud
      ? `<circle cx="${p.x}" cy="${p.y}" r="6" fill="#fff"/>
         <text x="${p.x}" y="${p.y - 18}" fill="#fff" font-size="26" font-weight="700"
          text-anchor="middle">${temp(data[i].temp)}</text>`
      : `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="rgba(255,255,255,0.7)"/>
         <text x="${p.x}" y="${p.y - 15}" fill="rgba(255,255,255,0.64)" font-size="20"
          font-weight="600" text-anchor="middle">${temp(data[i].temp)}</text>`;
  }

  // Hour ticks every three hours.
  data.forEach((hour, i) => {
    if (i % 3 !== 0) return;
    const x = padL + i * barW + barW / 2;
    out += `<text x="${x}" y="${H - 18}" fill="rgba(255,255,255,0.55)" font-size="21"
             font-weight="600" text-anchor="middle">${i === 0 ? 'Now' : hourLabel(hour.time)}</text>`;
  });

  svg.innerHTML = out;
  return svg;
}

/** Compact bar strip used for AQI/UV over the next day. */
export function barStrip(values, { color = '#8FB0C4', max = 100, labels = [] } = {}) {
  const W = 1000, H = 120;
  const svg = svgRoot(W, H, 'chart chart-strip');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const barW = W / Math.max(1, values.length);
  let out = '';
  values.forEach((value, i) => {
    if (value == null) return;
    const height = Math.max(3, (H - 34) * Math.min(1, value / max));
    out += `<rect x="${i * barW + 2}" y="${H - 34 - height}" width="${barW - 4}" height="${height}"
             rx="4" fill="${color}" opacity="${0.45 + 0.5 * Math.min(1, value / max)}"/>`;
  });
  labels.forEach(({ at, text }) => {
    out += `<text x="${at * barW + barW / 2}" y="${H - 8}" fill="rgba(255,255,255,0.5)"
             font-size="22" font-weight="600" text-anchor="middle">${text}</text>`;
  });
  svg.innerHTML = out;
  return svg;
}

/**
 * Horizontal meter with a coloured scale and a marker — used for AQI,
 * UV and pollen so they all read the same way.
 */
export function meter(value, { max = 300, stops = [], label = '' } = {}) {
  const W = 1000, H = 76;
  const svg = svgRoot(W, H, 'chart chart-meter');
  svg.setAttribute('preserveAspectRatio', 'none');

  const gradientId = `meter-${Math.random().toString(36).slice(2, 8)}`;
  const gradient = stops
    .map((s) => `<stop offset="${((s.at / max) * 100).toFixed(1)}%" stop-color="${s.color}"/>`)
    .join('');

  const pct = Math.max(0, Math.min(1, (value ?? 0) / max));
  const x = 14 + pct * (W - 28);

  svg.innerHTML = `
    <defs><linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="0">${gradient}</linearGradient></defs>
    <rect x="14" y="24" width="${W - 28}" height="20" rx="10" fill="url(#${gradientId})" opacity="0.85"/>
    <circle cx="${x}" cy="34" r="15" fill="#fff" stroke="rgba(0,0,0,0.35)" stroke-width="3"/>
    ${label ? `<text x="14" y="70" fill="rgba(255,255,255,0.5)" font-size="22">${label}</text>` : ''}`;
  return svg;
}

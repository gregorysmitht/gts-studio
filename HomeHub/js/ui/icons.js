/* Icon set.

   Weather glyphs are multi-colour and drawn to read at a glance from
   across a room: solid silhouettes, generous strokes, no hairlines.
   Gradients live in one hidden <svg> injected at boot so every icon
   can reference them by id without re-declaring defs. */

const NS = 'http://www.w3.org/2000/svg';

const DEFS = `
<linearGradient id="hh-sun" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0%" stop-color="#FFE082"/><stop offset="55%" stop-color="#FFC947"/><stop offset="100%" stop-color="#FF9E2C"/>
</linearGradient>
<linearGradient id="hh-moon" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0%" stop-color="#F4F8FF"/><stop offset="100%" stop-color="#C3D2EA"/>
</linearGradient>
<linearGradient id="hh-cloud" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0%" stop-color="#FFFFFF"/><stop offset="100%" stop-color="#D6E1EE"/>
</linearGradient>
<linearGradient id="hh-cloud-dark" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0%" stop-color="#C9D4E1"/><stop offset="100%" stop-color="#8895A6"/>
</linearGradient>
<linearGradient id="hh-storm" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0%" stop-color="#8D9AAA"/><stop offset="100%" stop-color="#5A6675"/>
</linearGradient>
<linearGradient id="hh-bolt" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0%" stop-color="#FFE99A"/><stop offset="100%" stop-color="#FFB300"/>
</linearGradient>
<linearGradient id="hh-drop" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0%" stop-color="#7FC4F5"/><stop offset="100%" stop-color="#3D8FD6"/>
</linearGradient>`;

export function installIconDefs() {
  if (document.getElementById('hh-icon-defs')) return;
  const holder = document.createElementNS(NS, 'svg');
  holder.id = 'hh-icon-defs';
  holder.setAttribute('aria-hidden', 'true');
  holder.setAttribute('width', '0');
  holder.setAttribute('height', '0');
  holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  holder.innerHTML = `<defs>${DEFS}</defs>`;
  document.body.prepend(holder);
}

/* ── Shape fragments ─────────────────────────────────────── */

const sun = (cx = 12, cy = 12, r = 4.6, rays = true) => `
  ${rays ? [...Array(8)].map((_, i) => {
    const a = (i * Math.PI) / 4;
    const x1 = cx + Math.cos(a) * (r + 2.0), y1 = cy + Math.sin(a) * (r + 2.0);
    const x2 = cx + Math.cos(a) * (r + 4.3), y2 = cy + Math.sin(a) * (r + 4.3);
    return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"
            stroke="url(#hh-sun)" stroke-width="2.1" stroke-linecap="round"/>`;
  }).join('') : ''}
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#hh-sun)"/>`;

const moon = (cx = 12, cy = 12, r = 6.2) => `
  <path d="M${cx + r * 0.62} ${cy - r * 0.86}
           a${r} ${r} 0 1 0 ${r * 0.88} ${r * 1.18}
           a${r * 0.82} ${r * 0.82} 0 1 1 -${r * 0.88} -${r * 1.18}z"
        fill="url(#hh-moon)"/>`;

const cloud = (grad = 'hh-cloud', dx = 0, dy = 0, s = 1) => `
  <path transform="translate(${dx} ${dy}) scale(${s})"
        d="M17.6 19.4H6.9a4.6 4.6 0 0 1-.55-9.17 6.15 6.15 0 0 1 11.7-1.05 4.62 4.62 0 0 1-.45 10.22z"
        fill="url(#${grad})"/>`;

const drops = (ys, xs = [8.6, 12, 15.4], color = 'url(#hh-drop)') =>
  xs.map((x, i) => `<line x1="${x}" y1="${ys[i] ?? ys[0]}" x2="${x - 1.1}" y2="${(ys[i] ?? ys[0]) + 3.2}"
       stroke="${color}" stroke-width="2.1" stroke-linecap="round"/>`).join('');

const bolt = (dx = 0, dy = 0) => `
  <path transform="translate(${dx} ${dy})"
        d="M12.9 13.2h3.4l-5.1 8.2 1-5.3H8.9l4.9-7.6z" fill="url(#hh-bolt)"/>`;

const flakes = (pts) =>
  pts.map(([x, y]) => `
    <g stroke="#E8F4FF" stroke-width="1.7" stroke-linecap="round">
      <line x1="${x - 1.5}" y1="${y}" x2="${x + 1.5}" y2="${y}"/>
      <line x1="${x}" y1="${y - 1.5}" x2="${x}" y2="${y + 1.5}"/>
      <line x1="${x - 1.05}" y1="${y - 1.05}" x2="${x + 1.05}" y2="${y + 1.05}"/>
      <line x1="${x - 1.05}" y1="${y + 1.05}" x2="${x + 1.05}" y2="${y - 1.05}"/>
    </g>`).join('');

/* ── Weather glyphs ──────────────────────────────────────── */

const WEATHER = {
  'clear-day':   () => sun(12, 12, 5.2),
  'clear-night': () => moon(11, 12, 6.4),

  'partly-day':   () => sun(16.4, 8, 3.9) + cloud('hh-cloud', -0.6, 2.4, 0.94),
  'partly-night': () => moon(16.6, 8.2, 4.3) + cloud('hh-cloud', -0.6, 2.4, 0.94),

  cloudy:   () => cloud('hh-cloud', 1.6, 3.2, 0.78) + cloud('hh-cloud', -1.4, 1.2, 0.98),
  overcast: () => cloud('hh-cloud-dark', 2.2, 3.6, 0.74) + cloud('hh-cloud', -1.6, 0.8, 1),

  haze: () => sun(12, 9.4, 4.2) + `
    <g stroke="#D8E2EC" stroke-width="2.1" stroke-linecap="round" opacity="0.9">
      <line x1="4.5" y1="16.6" x2="19.5" y2="16.6"/>
      <line x1="6.5" y1="20.2" x2="17.5" y2="20.2"/>
    </g>`,

  fog: () => cloud('hh-cloud', 0, -1.2, 0.92) + `
    <g stroke="#D8E2EC" stroke-width="2.2" stroke-linecap="round">
      <line x1="4.6" y1="18.4" x2="19.4" y2="18.4"/>
      <line x1="6.8" y1="21.8" x2="17.2" y2="21.8"/>
    </g>`,

  drizzle: () => cloud('hh-cloud', 0, -1.6, 0.94) + drops([18.4, 18.9, 18.4]),
  rain:    () => cloud('hh-cloud', 0, -1.8, 0.94) + drops([18.2, 18.9, 18.2]) +
                 drops([21.6], [10.3], 'url(#hh-drop)') + drops([21.6], [13.7], 'url(#hh-drop)'),
  'heavy-rain': () => cloud('hh-cloud-dark', 0, -1.8, 0.94) +
                 drops([17.9, 18.6, 17.9], [7.6, 10.6, 13.6]) +
                 drops([17.9], [16.6]) +
                 drops([21.4, 22.1, 21.4], [9.1, 12.1, 15.1]),

  thunder: () => cloud('hh-storm', 0, -2.2, 0.96) + bolt(0, -0.6),
  hail:    () => cloud('hh-cloud-dark', 0, -1.9, 0.94) + `
    <circle cx="9" cy="19.6" r="1.5" fill="#DCEBFA"/>
    <circle cx="13.4" cy="21.4" r="1.5" fill="#DCEBFA"/>
    <circle cx="16.4" cy="19" r="1.5" fill="#DCEBFA"/>`,

  snow:  () => cloud('hh-cloud', 0, -2, 0.94) + flakes([[8.6, 19.6], [12.6, 21.4], [16.2, 19.2]]),
  sleet: () => cloud('hh-cloud-dark', 0, -2, 0.94) + flakes([[8.8, 19.6], [15.8, 19.4]]) +
               drops([19.4], [12.3]),

  wind: () => `
    <g stroke="#DCE6F0" stroke-width="2.2" stroke-linecap="round" fill="none">
      <path d="M3.4 9.2h9.3a2.9 2.9 0 1 0-2.9-2.9"/>
      <path d="M3.4 14.6h13a2.9 2.9 0 1 1-2.9 2.9"/>
      <path d="M3.4 19.6h6.4"/>
    </g>`,
};

/** Map a normalised condition + day/night to a glyph name. */
export function conditionGlyph(condition = 'clear', night = false) {
  if (condition === 'clear') return night ? 'clear-night' : 'clear-day';
  if (condition === 'partly') return night ? 'partly-night' : 'partly-day';
  return WEATHER[condition] ? condition : (night ? 'clear-night' : 'clear-day');
}

/**
 * Weather icon element.
 * @param {string} condition normalised condition code
 * @param {object} opts { size, night }
 */
export function weatherIcon(condition, { size = 48, night = false } = {}) {
  const glyph = conditionGlyph(condition, night);
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('width', size);
  el.setAttribute('height', size);
  el.setAttribute('class', 'wx-icon');
  el.setAttribute('role', 'img');
  el.setAttribute('aria-label', condition.replace('-', ' '));
  el.innerHTML = (WEATHER[glyph] || WEATHER['clear-day'])();
  return el;
}

/* ── UI glyphs — single-colour, stroked, currentColor ─────── */

const UI = {
  chevronRight: '<path d="M9 6l6 6-6 6"/>',
  chevronLeft:  '<path d="M15 6l-6 6 6 6"/>',
  chevronDown:  '<path d="M6 9l6 6 6-6"/>',
  chevronUp:    '<path d="M6 15l6-6 6 6"/>',
  close:        '<path d="M18 6L6 18M6 6l12 12"/>',
  plus:         '<path d="M12 5v14M5 12h14"/>',
  minus:        '<path d="M5 12h14"/>',
  check:        '<path d="M20 6L9 17l-5-5"/>',
  settings:     '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  calendar:     '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  list:         '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  cart:         '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.4 12.4a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.6L21 8H6"/>',
  broom:        '<path d="M20.5 3.5l-8 8"/><path d="M11.4 9.4l3.2 3.2-6.1 6.1a2.3 2.3 0 0 1-1.6.6H3.5v-3.4a2.3 2.3 0 0 1 .7-1.6z"/><path d="M6.6 14.2l3.2 3.2"/>',
  clipboard:    '<rect x="4.5" y="4.5" width="15" height="16" rx="2.6"/><path d="M9 4.5V3.4A1.4 1.4 0 0 1 10.4 2h3.2A1.4 1.4 0 0 1 15 3.4v1.1z"/><path d="M8.5 11.5l1.8 1.8 3.6-3.6M8.5 16.6h5"/>',
  location:     '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>',
  refresh:      '<path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6"/>',
  layers:       '<path d="M12 2.5L2.5 7.5 12 12.5l9.5-5L12 2.5z"/><path d="M2.5 12.5L12 17.5l9.5-5M2.5 17L12 22l9.5-5"/>',
  play:         '<path d="M7 4.5l12 7.5-12 7.5z" fill="currentColor" stroke="none"/>',
  pause:        '<rect x="6.5" y="5" width="4" height="14" rx="1.4" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="4" height="14" rx="1.4" fill="currentColor" stroke="none"/>',
  alert:        '<path d="M10.3 3.6L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.6a2 2 0 0 0-3.4 0z"/><path d="M12 9v5M12 17.5h.01"/>',
  bolt:         '<path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12L13 2z"/>',
  hurricane:    '<circle cx="12" cy="12" r="2.2"/><path d="M12 9.8c0-4 3-6.8 7-6.8-1 3.4-3.4 5.4-7 6.8zM12 14.2c0 4-3 6.8-7 6.8 1-3.4 3.4-5.4 7-6.8z"/>',
  droplet:      '<path d="M12 3.2s6 6.4 6 10.2a6 6 0 0 1-12 0c0-3.8 6-10.2 6-10.2z"/>',
  wind:         '<path d="M3.5 9h9.3a2.9 2.9 0 1 0-2.9-2.9M3.5 14.5h13a2.9 2.9 0 1 1-2.9 2.9"/>',
  eye:          '<path d="M1.8 12S5.5 5.2 12 5.2 22.2 12 22.2 12 18.5 18.8 12 18.8 1.8 12 1.8 12z"/><circle cx="12" cy="12" r="3.1"/>',
  gauge:        '<path d="M3.4 17.6a9 9 0 1 1 17.2 0"/><path d="M12 17.6l4.5-5.5"/><circle cx="12" cy="17.7" r="1.3"/>',
  sunrise:      '<path d="M12 3v5M6.5 10.5L4.9 8.9M17.5 10.5l1.6-1.6M2.5 17h19M6.5 17a5.5 5.5 0 0 1 11 0M4 21h16"/>',
  sunset:       '<path d="M12 8V3M6.5 10.5L4.9 8.9M17.5 10.5l1.6-1.6M2.5 17h19M6.5 17a5.5 5.5 0 0 1 11 0M4 21h16"/>',
  moon:         '<path d="M20.5 14.6A8.6 8.6 0 1 1 9.4 3.5a6.9 6.9 0 0 0 11.1 11.1z"/>',
  thermometer:  '<path d="M13.5 14.2V4.8a2.3 2.3 0 0 0-4.6 0v9.4a4.4 4.4 0 1 0 4.6 0z"/>',
  umbrella:     '<path d="M12 2.5A9.5 9.5 0 0 0 2.5 12h19A9.5 9.5 0 0 0 12 2.5z"/><path d="M12 12v7a2.5 2.5 0 0 1-5 0"/>',
  trash:        '<path d="M4 7h16M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7M6.5 7l.9 12.1A2 2 0 0 0 9.4 21h5.2a2 2 0 0 0 2-1.9L17.5 7"/>',
  person:       '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 21a7.5 7.5 0 0 1 15 0"/>',
  photo:        '<rect x="3" y="4.5" width="18" height="15" rx="3"/><circle cx="8.6" cy="10" r="1.7"/><path d="M3.4 17l5-4.6a2 2 0 0 1 2.7 0l4.3 4M14.5 14.4l1.6-1.4a2 2 0 0 1 2.7 0l1.8 1.6"/>',
  grid:         '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
  agenda:       '<path d="M4 6.5h3M4 12h3M4 17.5h3M10 6.5h10M10 12h10M10 17.5h10"/>',
  clock:        '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.3l3.4 2"/>',
  pin:          '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.6"/>',
  link:         '<path d="M10.5 13.5a4.5 4.5 0 0 0 6.4 0l2.6-2.6a4.5 4.5 0 0 0-6.4-6.4L11.7 6"/><path d="M13.5 10.5a4.5 4.5 0 0 0-6.4 0l-2.6 2.6a4.5 4.5 0 0 0 6.4 6.4L12.3 18"/>',
  users:        '<circle cx="9" cy="8" r="3.4"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16.5 5.2a3.4 3.4 0 0 1 0 6.6M17.5 14.4A6.5 6.5 0 0 1 21.5 20"/>',
  flame:        '<path d="M12 22a6.5 6.5 0 0 0 6.5-6.5c0-5-4.5-6.8-3.5-11.5-3 1.5-5.5 4.5-5.5 7.5 0 1.5.5 2.5.5 2.5S8 12 8 9.5C6.5 11.5 5.5 13.5 5.5 15.5A6.5 6.5 0 0 0 12 22z"/>',
  zoomIn:       '<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5l-4.4-4.4M11 8.2v5.6M8.2 11h5.6"/>',
  zoomOut:      '<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5l-4.4-4.4M8.2 11h5.6"/>',
  crosshair:    '<circle cx="12" cy="12" r="8"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/>',
  info:         '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8h.01"/>',
  note:         '<path d="M5 3.5h14a1.5 1.5 0 0 1 1.5 1.5v14a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5z"/><path d="M7.5 8.5h9M7.5 12h9M7.5 15.5h5"/>',
  home:         '<path d="M3.5 10.5L12 3.5l8.5 7M5.5 9.4V20h13V9.4"/>',
  music:        '<path d="M9 18.5V6.2l10.5-2.2v12.1"/><circle cx="6.4" cy="18.4" r="2.6"/><circle cx="16.9" cy="16.2" r="2.6"/>',
  search:       '<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5l-4.6-4.6"/>',
  shuffle:      '<path d="M17 3.5L20.5 7 17 10.5"/><path d="M17 13.5L20.5 17 17 20.5"/><path d="M3.5 7h3.2c1.3 0 2.5.7 3.2 1.8l4.2 6.4c.7 1.1 1.9 1.8 3.2 1.8h3.2"/><path d="M3.5 17h3.2c1.3 0 2.5-.7 3.2-1.8l.9-1.4M20.5 7h-3.2c-1.3 0-2.5.7-3.2 1.8l-.9 1.4"/>',
  skipBack:     '<path d="M19 5.5v13L9.5 12z" fill="currentColor" stroke="none"/><rect x="4.5" y="5.5" width="2.8" height="13" rx="1.3" fill="currentColor" stroke="none"/>',
  skipForward:  '<path d="M5 5.5v13L14.5 12z" fill="currentColor" stroke="none"/><rect x="16.7" y="5.5" width="2.8" height="13" rx="1.3" fill="currentColor" stroke="none"/>',
};

/**
 * UI icon element.
 * @param {keyof UI} name
 */
export function icon(name, { size = 24, stroke = 2 } = {}) {
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('width', size);
  el.setAttribute('height', size);
  el.setAttribute('fill', 'none');
  el.setAttribute('stroke', 'currentColor');
  el.setAttribute('stroke-width', stroke);
  el.setAttribute('stroke-linecap', 'round');
  el.setAttribute('stroke-linejoin', 'round');
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = UI[name] || UI.info;
  return el;
}

/** Moon phase disc, drawn from an illumination fraction. */
export function moonIcon(fraction, { size = 24 } = {}) {
  const el = document.createElementNS(NS, 'svg');
  el.setAttribute('viewBox', '0 0 24 24');
  el.setAttribute('width', size);
  el.setAttribute('height', size);
  el.setAttribute('aria-hidden', 'true');

  // Terminator is an ellipse whose x-radius tracks the phase.
  const r = 9;
  const k = Math.cos(2 * Math.PI * fraction) * r;   // +r new, -r full
  const sweepOuter = fraction < 0.5 ? 1 : 0;
  const sweepInner = k > 0 ? (fraction < 0.5 ? 1 : 0) : (fraction < 0.5 ? 0 : 1);

  el.innerHTML = `
    <circle cx="12" cy="12" r="${r}" fill="rgba(255,255,255,0.10)"/>
    <path d="M12 ${12 - r}
             A ${r} ${r} 0 0 ${sweepOuter} 12 ${12 + r}
             A ${Math.abs(k)} ${r} 0 0 ${sweepInner} 12 ${12 - r} z"
          fill="url(#hh-moon)"/>`;
  return el;
}

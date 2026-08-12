/* ============================================================
   The living sky.

   Drives the whole background from real solar geometry rather
   than clock time, so the hub turns gold when the light in the
   room actually turns gold. Current conditions then wash over
   the top: overcast desaturates, rain darkens and cools,
   thunderstorms go slate-green.

   Everything lands on :root as CSS custom properties; CSS does
   the crossfading, so this runs once a minute and costs nothing.
   ============================================================ */

import { sunPosition, moonPhase } from './solar.js';
import { mixStops, mix, desaturate, capLightness, lightness, norm, smooth, lerp, clamp } from './color.js';

/* Palettes are [zenith, mid, horizon], ordered by sun elevation.
   Dawn runs cooler and pinker; dusk runs warmer and redder — the
   same asymmetry the real sky has.

   Tuned warm and slightly desaturated: closer to a hotel terrace at
   altitude than to a weather map. Daytime blues carry a little green
   so they read as sea-and-sky rather than UI blue, and every stop
   keeps a touch of warmth so the brass accents sit inside the palette
   instead of on top of it. */
const NIGHT     = ['#05060C', '#0B0F1B', '#141A26'];
const ASTRO     = ['#06080F', '#101627', '#1E2536'];
const NAUTICAL  = ['#0A1020', '#1A2340', '#313B58'];

const CIVIL_AM  = ['#121A38', '#33375F', '#6F5670'];
const CIVIL_PM  = ['#10152E', '#312B54', '#6E465C'];

const HORIZON_AM = ['#1E2A4E', '#5C4B72', '#BE8069'];
const HORIZON_PM = ['#181A3C', '#6B4257', '#BE6552'];

const GOLDEN_AM = ['#204365', '#7A6B78', '#D9A876'];
const GOLDEN_PM = ['#1B3457', '#8A5A50', '#DE9A55'];

/* Daytime: deep water at the zenith falling to a warm sand haze at the
   horizon. The vertical contrast is what makes it read as sky rather
   than as a flat background colour, and the warm bottom is where the
   brass accents find their footing. */
const LOW_AM    = ['#1C4A6A', '#437290', '#A9A99E'];
const LOW_PM    = ['#1B4462', '#4E7488', '#BFA894'];

const DAY       = ['#133F64', '#2F6B8B', '#B0A492'];
const HIGH      = ['#0F3A60', '#2A6486', '#A79E8E'];

/* Keyframes: sun elevation → palette. Interpolated in Oklab. */
const KEYS = [
  { alt: -90,    am: NIGHT,      pm: NIGHT },
  { alt: -18,    am: ASTRO,      pm: ASTRO },
  { alt: -12,    am: NAUTICAL,   pm: NAUTICAL },
  { alt: -6,     am: CIVIL_AM,   pm: CIVIL_PM },
  { alt: -0.833, am: HORIZON_AM, pm: HORIZON_PM },
  { alt: 3,      am: GOLDEN_AM,  pm: GOLDEN_PM },
  { alt: 10,     am: LOW_AM,     pm: LOW_PM },
  { alt: 26,     am: DAY,        pm: DAY },
  { alt: 55,     am: HIGH,       pm: HIGH },
  { alt: 90,     am: HIGH,       pm: HIGH },
];

/* Condition washes: [tint, strength ceiling, saturation cut].
   Warm-grey rather than blue-grey, so overcast reads as soft linen
   and not as a dead pixel.

   Held deliberately light. Bad weather should make the room feel
   moodier — deeper, warmer, lower — not drain the colour out of it.
   A storm sky that goes monochrome reads as a broken screen, so the
   saturation cuts here stay small and the tints stay warm. */
const WASH = {
  clear:      null,
  partly:     ['#A8ADAC', 0.12, 0.05],
  cloudy:     ['#8E8F8B', 0.26, 0.14],
  overcast:   ['#7C7A74', 0.38, 0.22],
  haze:       ['#A89C78', 0.26, 0.18],
  fog:        ['#84817A', 0.46, 0.32],
  drizzle:    ['#5F6360', 0.36, 0.20],
  rain:       ['#4E5052', 0.44, 0.24],
  'heavy-rain':['#3E4145', 0.52, 0.28],
  sleet:      ['#64676A', 0.44, 0.26],
  snow:       ['#9EA2A0', 0.40, 0.24],
  thunder:    ['#3A362F', 0.50, 0.26],
  hail:       ['#484A4A', 0.50, 0.28],
  wind:       ['#828782', 0.20, 0.12],
};

/* Above this Oklab lightness, near-white type starts to struggle.
   Bright midday palettes get pulled back to it. */
const MAX_L = 0.64;

let starsDrawn = 0;

/**
 * Recompute and apply the sky.
 * @param {{lat:number, lon:number}} place
 * @param {{condition?:string, cloudCover?:number}} weather
 * @param {Date} now
 */
export function paintSky(place, weather = {}, now = new Date()) {
  const root = document.documentElement;
  const { elevation, azimuth } = sunPosition(now, place.lat, place.lon);
  const evening = azimuth > 180;   // sun in the western half of the sky

  let stops = paletteFor(elevation, evening);
  stops = applyWeather(stops, weather);
  stops = stops.map((c) => capLightness(c, MAX_L));

  root.style.setProperty('--sky-1', stops[0]);
  root.style.setProperty('--sky-2', stops[1]);
  root.style.setProperty('--sky-3', stops[2]);

  applyGlow(root, elevation, azimuth, weather, now);
  applyStars(root, elevation, weather);
  applyWeatherVeil(root, weather);
  applyGlassTint(root, stops);

  root.style.setProperty('--sky-lum', lightness(stops[1]).toFixed(3));
  return { elevation, azimuth, stops };
}

/** Blend the two keyframes bracketing this sun elevation. */
function paletteFor(alt, evening) {
  const side = evening ? 'pm' : 'am';
  for (let i = 1; i < KEYS.length; i++) {
    if (alt <= KEYS[i].alt || i === KEYS.length - 1) {
      const a = KEYS[i - 1], b = KEYS[i];
      const t = smooth(norm(alt, a.alt, b.alt));
      return mixStops(a[side], b[side], t);
    }
  }
  return KEYS[0][side];
}

/** Wash the palette with the current conditions. */
function applyWeather(stops, { condition = 'clear', cloudCover = 0 } = {}) {
  const wash = WASH[condition];
  if (!wash) return stops;
  const [tint, ceiling, satCut] = wash;

  // Cloud cover scales the wash, but precipitating conditions always
  // land with at least two-thirds of their weight — it is raining
  // whether or not the sky-cover number agrees.
  const wet = /rain|drizzle|snow|sleet|thunder|hail|fog/.test(condition);
  const cover = clamp((cloudCover || (wet ? 90 : 0)) / 100);
  const strength = ceiling * (wet ? Math.max(0.66, cover) : cover);

  return stops.map((c, i) => {
    // Horizon takes the wash hardest; zenith keeps some of its own colour.
    const depth = strength * [0.72, 0.9, 1][i];
    return desaturate(mix(c, tint, depth), satCut * depth);
  });
}

/** Sun (or moon) bloom, placed by real azimuth and elevation. */
function applyGlow(root, alt, az, weather, now) {
  const cover = clamp((weather.cloudCover ?? 0) / 100);
  const muffle = 1 - cover * 0.72;   // clouds diffuse the bloom away

  // Azimuth 90°(E) → left quarter, 180°(S) → centre, 270°(W) → right quarter.
  let delta = az - 180;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  const x = clamp(50 + (delta / 180) * 55, -12, 112);
  // Horizon sits near the bottom of the panel; overhead is just off the top.
  const y = lerp(86, -6, norm(alt, -8, 88));

  let color, size, alpha;

  if (alt > -8) {
    // Warm and huge at the horizon, softer and creamier overhead.
    const high = norm(alt, 0, 45);
    color = mix('#F5A356', '#FFEFD2', high);
    size = lerp(84, 34, high);
    alpha = lerp(0.50, 0.26, high) * muffle;
  } else {
    // Night: a warm low bloom, like light spilling from indoors, whose
    // strength tracks the moon's illumination.
    const moon = moonPhase(now);
    color = '#C8B79E';
    size = 38;
    alpha = 0.05 + moon.illumination * 0.17 * muffle;
  }

  root.style.setProperty('--sky-glow', hexAlpha(color, alpha));
  root.style.setProperty('--sky-glow-x', `${x.toFixed(1)}%`);
  root.style.setProperty('--sky-glow-y', `${y.toFixed(1)}%`);
  root.style.setProperty('--sky-glow-size', `${size.toFixed(0)}%`);
}

function hexAlpha(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${clamp(a).toFixed(3)})`;
}

/** Stars fade in through twilight and hide behind cloud. */
function applyStars(root, alt, weather) {
  const dark = 1 - norm(alt, -14, -2);           // 0 in daylight, 1 deep night
  const clear = 1 - clamp((weather.cloudCover ?? 0) / 100) * 0.92;
  root.style.setProperty('--star-opacity', (dark * clear).toFixed(3));
  if (dark > 0.02) drawStars();
}

/** One-time starfield render, redrawn only when the panel resizes. */
export function drawStars() {
  const canvas = document.querySelector('.sky-stars');
  if (!canvas) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = Math.round(innerWidth * dpr), hgt = Math.round(innerHeight * dpr);
  if (starsDrawn === w * 100000 + hgt) return;
  starsDrawn = w * 100000 + hgt;

  canvas.width = w;
  canvas.height = hgt;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, hgt);

  // Deterministic scatter so the sky doesn't reshuffle on every repaint.
  let seed = 20260811;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  const count = Math.round((w * hgt) / (16000 * dpr));
  for (let i = 0; i < count; i++) {
    const x = rand() * w;
    // Denser high in the sky, sparse near the horizon glow.
    const y = rand() ** 1.7 * hgt;
    const r = (rand() ** 2.4 * 1.6 + 0.35) * dpr;
    const a = 0.25 + rand() * 0.65;
    // A few stars pick up a faint colour cast, like real ones.
    const tint = rand();
    ctx.fillStyle =
      tint > 0.93 ? `rgba(190, 214, 255, ${a})`
      : tint < 0.06 ? `rgba(255, 226, 196, ${a})`
      : `rgba(255, 255, 255, ${a})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Precipitation texture over the gradient — subtle, never busy. */
function applyWeatherVeil(root, { condition = 'clear' } = {}) {
  const veil = document.querySelector('.sky-weather');
  if (!veil) return;

  if (/rain|drizzle/.test(condition)) {
    veil.style.background =
      'repeating-linear-gradient(74deg, rgba(255,255,255,0.055) 0 1px, transparent 1px 7px)';
    veil.style.opacity = condition === 'heavy-rain' ? '0.85' : '0.5';
  } else if (condition === 'snow') {
    veil.style.background =
      'radial-gradient(circle at 20% 30%, rgba(255,255,255,0.10) 0 1.5px, transparent 2px),' +
      'radial-gradient(circle at 70% 60%, rgba(255,255,255,0.08) 0 1.5px, transparent 2px)';
    veil.style.backgroundSize = '90px 90px, 130px 130px';
    veil.style.opacity = '0.9';
  } else if (condition === 'fog' || condition === 'haze') {
    veil.style.background =
      'linear-gradient(to bottom, transparent 30%, rgba(220,228,235,0.16) 100%)';
    veil.style.opacity = '1';
  } else {
    veil.style.opacity = '0';
  }
}

/**
 * Adaptive glass.
 * Against a dark sky, cards are a light frosted tint. Against a bright
 * midday sky they invert to a dark tint — the same trick iOS uses to
 * keep white widget type readable on a light wallpaper.
 */
function applyGlassTint(root, stops) {
  const lum = lightness(stops[2]);              // horizon drives it — that's where cards sit
  const dark = smooth(norm(lum, 0.30, 0.60));   // 0 = night, 1 = bright day

  // Warm on both ends: parchment-tinted over a dark sky, and a warm
  // near-black — never a neutral grey — over a bright one.
  const r = Math.round(lerp(255, 22, dark));
  const g = Math.round(lerp(250, 17, dark));
  const b = Math.round(lerp(242, 13, dark));
  const a = lerp(0.09, 0.24, dark);

  root.style.setProperty('--glass', `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`);
  root.style.setProperty('--glass-hi', `rgba(${r}, ${g}, ${b}, ${(a + 0.06).toFixed(3)})`);
  root.style.setProperty('--glass-well', `rgba(18, 14, 10, ${lerp(0.18, 0.24, dark).toFixed(3)})`);
  root.style.setProperty('--glass-line', `rgba(255, 246, 232, ${lerp(0.10, 0.16, dark).toFixed(3)})`);
}

/* Redraw the starfield if the panel is rotated or resized. */
addEventListener('resize', () => { starsDrawn = 0; drawStars(); });

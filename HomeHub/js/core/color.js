/* Colour maths.
   Sky gradients interpolate in Oklab rather than sRGB — straight RGB
   blending between, say, sunset orange and twilight indigo detours
   through a muddy brown. Oklab keeps the transition clean. */

export const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;

/** Inverse-lerp with clamping — maps a value in [a,b] to [0,1]. */
export const norm = (v, a, b) => clamp((v - a) / (b - a || 1));

/** Smoothstep easing, used so palette crossfades don't start abruptly. */
export const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };

export function parseHex(hex) {
  let s = String(hex).trim().replace('#', '');
  if (s.length === 3) s = [...s].map((c) => c + c).join('');
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export const toHex = ([r, g, b]) =>
  '#' + [r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');

export const rgba = (hex, a) => {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
};

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

export function rgbToOklab([r, g, b]) {
  const R = srgbToLinear(r / 255), G = srgbToLinear(g / 255), B = srgbToLinear(b / 255);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

export function oklabToRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [
    linearToSrgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
  ].map((v) => Math.round(clamp(v) * 255));
}

/** Perceptual blend of two hex colours. t=0 → a, t=1 → b. */
export function mix(a, b, t) {
  const A = rgbToOklab(parseHex(a)), B = rgbToOklab(parseHex(b));
  return toHex(oklabToRgb([lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)]));
}

/** Blend a whole gradient stack (arrays of hex strings) at once. */
export const mixStops = (a, b, t) => a.map((c, i) => mix(c, b[i] ?? c, t));

/** Pull saturation out without touching lightness — used for overcast skies. */
export function desaturate(hex, amount) {
  const [L, a, b] = rgbToOklab(parseHex(hex));
  const k = 1 - clamp(amount);
  return toHex(oklabToRgb([L, a * k, b * k]));
}

/** Oklab L is already perceptual lightness — good enough for "is this sky bright?" */
export const lightness = (hex) => rgbToOklab(parseHex(hex))[0];

/** WCAG relative luminance, for the contrast guard in sky.js. */
export function luminance(hex) {
  const [r, g, b] = parseHex(hex).map((v) => srgbToLinear(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Cap a colour's lightness so white type never loses contrast against it. */
export function capLightness(hex, max) {
  const lab = rgbToOklab(parseHex(hex));
  if (lab[0] <= max) return hex;
  return toHex(oklabToRgb([max, lab[1], lab[2]]));
}

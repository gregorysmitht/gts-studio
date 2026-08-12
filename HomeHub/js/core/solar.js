/* Sun and moon position.
   Low-precision NOAA algorithm — accurate to roughly an arcminute,
   which is far beyond what a background gradient needs, and it runs
   with no network so the sky is correct even when offline. */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const J2000 = 2451545.0;

const toJulian = (date) => date.getTime() / 86400000 + 2440587.5;
const daysSinceJ2000 = (date) => toJulian(date) - J2000;

/** Sun declination and right ascension for a moment in time. */
function sunEquatorial(n) {
  const L = (280.460 + 0.9856474 * n) % 360;              // mean longitude
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD;      // mean anomaly
  const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;             // obliquity
  return {
    ra: Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)),
    dec: Math.asin(Math.sin(eps) * Math.sin(lambda)),
  };
}

/**
 * Sun position for an observer.
 * @returns {{elevation:number, azimuth:number}} degrees;
 *          elevation is above the horizon, azimuth clockwise from north.
 */
export function sunPosition(date, lat, lon) {
  const n = daysSinceJ2000(date);
  const { ra, dec } = sunEquatorial(n);
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const lmst = (((gmst * 15 + lon) % 360) + 360) % 360 * RAD;
  const H = lmst - ra;
  const phi = lat * RAD;

  const elevation = Math.asin(
    Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H)
  );
  const azimuth = Math.atan2(
    -Math.sin(H),
    Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(H)
  );

  return { elevation: elevation * DEG, azimuth: ((azimuth * DEG) + 360) % 360 };
}

/**
 * Times the sun crosses a given altitude on a given local day.
 * -0.833° is the standard sunrise/sunset refraction allowance;
 * -6/-12/-18 give civil, nautical and astronomical twilight.
 */
export function sunTimes(date, lat, lon, altitude = -0.833) {
  const noon = new Date(date);
  noon.setHours(12, 0, 0, 0);
  const n = daysSinceJ2000(noon);
  const { dec } = sunEquatorial(n);
  const phi = lat * RAD;

  const cosH =
    (Math.sin(altitude * RAD) - Math.sin(phi) * Math.sin(dec)) /
    (Math.cos(phi) * Math.cos(dec));

  // No crossing: polar day or polar night.
  if (cosH > 1) return { rise: null, set: null, alwaysDown: true, alwaysUp: false };
  if (cosH < -1) return { rise: null, set: null, alwaysDown: false, alwaysUp: true };

  const H = Math.acos(cosH) * DEG / 15;   // hour angle in hours

  // Solar noon in UTC hours, converted back to a local Date.
  const eqTime = solarNoonUTC(n, lon);
  const mk = (utcHours) => {
    const t = new Date(noon);
    t.setUTCHours(0, 0, 0, 0);
    t.setUTCMilliseconds(utcHours * 3600e3);
    return t;
  };
  return { rise: mk(eqTime - H), set: mk(eqTime + H), alwaysUp: false, alwaysDown: false };
}

/** Solar noon expressed as UTC hours, including the equation of time. */
function solarNoonUTC(n, lon) {
  const L = (280.460 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD;
  const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
  const eps = (23.439 - 0.0000004 * n) * RAD;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) * DEG;
  // Equation of time in minutes.
  let eot = (L - (ra < 0 ? ra + 360 : ra));
  if (eot > 180) eot -= 360;
  if (eot < -180) eot += 360;
  eot *= 4;
  return 12 - lon / 15 - eot / 60;
}

const MOON_NAMES = [
  'New Moon', 'Waxing Crescent', 'First Quarter', 'Waxing Gibbous',
  'Full Moon', 'Waning Gibbous', 'Last Quarter', 'Waning Crescent',
];

/**
 * Moon phase as a 0–1 fraction of the synodic month.
 * 0 = new, 0.5 = full. Good to about a few hours.
 */
export function moonPhase(date = new Date()) {
  const n = daysSinceJ2000(date);
  const phase = ((n - 5.597661) / 29.5305888610) % 1;
  const frac = phase < 0 ? phase + 1 : phase;
  const idx = Math.round(frac * 8) % 8;
  return {
    fraction: frac,
    name: MOON_NAMES[idx],
    /** 0 = dark, 1 = fully lit — the visible illuminated portion. */
    illumination: (1 - Math.cos(2 * Math.PI * frac)) / 2,
    waxing: frac < 0.5,
  };
}

/** Convenience: is the sun currently above the horizon? */
export const isDaylight = (date, lat, lon) => sunPosition(date, lat, lon).elevation > -0.833;

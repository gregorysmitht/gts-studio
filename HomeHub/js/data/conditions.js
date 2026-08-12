/* Condition normalisation.

   NWS, Open-Meteo and the mock fixtures all describe weather
   differently. Everything upstream of the UI collapses into this one
   small vocabulary so icons, sky washes and colours only ever need to
   understand these codes. */

export const CONDITIONS = [
  'clear', 'partly', 'cloudy', 'overcast', 'haze', 'fog',
  'drizzle', 'rain', 'heavy-rain', 'thunder', 'hail',
  'sleet', 'snow', 'wind',
];

/** Human label for a condition when the source gives us nothing better. */
export const CONDITION_LABEL = {
  clear: 'Clear',
  partly: 'Partly Cloudy',
  cloudy: 'Cloudy',
  overcast: 'Overcast',
  haze: 'Hazy',
  fog: 'Fog',
  drizzle: 'Drizzle',
  rain: 'Rain',
  'heavy-rain': 'Heavy Rain',
  thunder: 'Thunderstorms',
  hail: 'Hail',
  sleet: 'Sleet',
  snow: 'Snow',
  wind: 'Windy',
};

/* NWS icon-path tokens → condition. Checked before free text because
   the icon code is structured and the shortForecast prose is not. */
const NWS_ICON = {
  skc: 'clear', few: 'clear', sct: 'partly', bkn: 'cloudy', ovc: 'overcast',
  wind_skc: 'wind', wind_few: 'wind', wind_sct: 'wind', wind_bkn: 'wind', wind_ovc: 'wind',
  snow: 'snow', blizzard: 'snow', cold: 'snow',
  rain_snow: 'sleet', rain_sleet: 'sleet', snow_sleet: 'sleet', sleet: 'sleet',
  fzra: 'sleet', rain_fzra: 'sleet', snow_fzra: 'sleet',
  rain: 'rain', rain_showers: 'rain', rain_showers_hi: 'drizzle',
  tsra: 'thunder', tsra_sct: 'thunder', tsra_hi: 'thunder',
  tornado: 'thunder', hurricane: 'heavy-rain', tropical_storm: 'heavy-rain',
  dust: 'haze', smoke: 'haze', haze: 'haze', fog: 'fog', hot: 'clear',
};

/** Pull the condition out of an api.weather.gov icon URL. */
export function fromNwsIcon(url) {
  if (!url) return null;
  // …/icons/land/day/tsra,40/rain,20?size=medium → first token wins
  const match = /\/icons\/[^/]+\/(day|night)\/([a-z_]+)/i.exec(url);
  return match ? (NWS_ICON[match[2]] ?? null) : null;
}

/** Is this NWS icon URL a night-time variant? */
export const nwsIconIsNight = (url) => /\/icons\/[^/]+\/night\//i.test(url || '');

/* Ordered matchers — first hit wins, so put the specific ones first. */
const TEXT_RULES = [
  [/thunder|t-?storm|tstm/i, 'thunder'],
  [/hail/i, 'hail'],
  [/blizzard|heavy snow/i, 'snow'],
  [/freezing|sleet|ice pellets|wintry mix|rain and snow/i, 'sleet'],
  [/snow|flurr/i, 'snow'],
  [/heavy rain|downpour|torrential/i, 'heavy-rain'],
  [/drizzle|light rain|sprinkle/i, 'drizzle'],
  [/rain|shower/i, 'rain'],
  [/fog|mist/i, 'fog'],
  [/haze|hazy|smoke|dust/i, 'haze'],
  [/wind|breezy|blustery/i, 'wind'],
  [/overcast/i, 'overcast'],
  [/mostly cloudy|considerable clou/i, 'cloudy'],
  [/partly cloudy|partly sunny|mostly sunny|few clouds|partly clear/i, 'partly'],
  [/cloud/i, 'cloudy'],
  [/clear|sunny|fair/i, 'clear'],
];

/** Best-effort condition from a free-text forecast summary. */
export function fromText(text) {
  if (!text) return null;
  for (const [re, code] of TEXT_RULES) if (re.test(text)) return code;
  return null;
}

/* WMO codes used by Open-Meteo. */
const WMO = {
  0: 'clear', 1: 'clear', 2: 'partly', 3: 'overcast',
  45: 'fog', 48: 'fog',
  51: 'drizzle', 53: 'drizzle', 55: 'drizzle',
  56: 'sleet', 57: 'sleet',
  61: 'rain', 63: 'rain', 65: 'heavy-rain',
  66: 'sleet', 67: 'sleet',
  71: 'snow', 73: 'snow', 75: 'snow', 77: 'snow',
  80: 'rain', 81: 'rain', 82: 'heavy-rain',
  85: 'snow', 86: 'snow',
  95: 'thunder', 96: 'hail', 99: 'hail',
};

export const fromWmo = (code) => WMO[code] ?? 'cloudy';

/** Sky-cover percentage → cloud condition, when that's all we have. */
export function fromCloudCover(pct) {
  if (pct == null) return null;
  if (pct < 12) return 'clear';
  if (pct < 55) return 'partly';
  if (pct < 88) return 'cloudy';
  return 'overcast';
}

/* NWS gridpoint `weather` layer values, which look like
   { coverage:'chance', weather:'thunderstorms', intensity:'light' } */
export function fromNwsWeatherValue(values) {
  if (!Array.isArray(values) || !values.length) return null;
  const kinds = values.map((v) => v?.weather).filter(Boolean).join(' ');
  return fromText(kinds);
}

/** Rough severity ranking, used to pick the headline condition for a day. */
const RANK = {
  thunder: 100, hail: 95, 'heavy-rain': 85, snow: 80, sleet: 75,
  rain: 70, drizzle: 55, fog: 50, haze: 40, wind: 38,
  overcast: 30, cloudy: 25, partly: 15, clear: 5,
};

/** The most "notable" condition in a set — what a day should be named for. */
export function dominant(list) {
  let best = null, bestRank = -1;
  for (const c of list) {
    const r = RANK[c] ?? 0;
    if (r > bestRank) { bestRank = r; best = c; }
  }
  return best ?? 'clear';
}

export const isPrecip = (c) => /rain|drizzle|snow|sleet|thunder|hail/.test(c || '');
export const isSevere = (c) => /thunder|hail|heavy-rain/.test(c || '');

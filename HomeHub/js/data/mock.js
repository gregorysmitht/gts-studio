/* Demo data.

   Generated relative to "now" rather than baked into a JSON file, so a
   freshly installed hub shows a plausible, good-looking day before any
   location or calendar is configured — and so the layout can be
   exercised offline. A "Demo data" pill stays visible whenever this is
   what's on screen.

   Deterministic: the same day always produces the same numbers. */

import { sunTimes } from '../core/solar.js';
import { CONDITION_LABEL } from './conditions.js';
import { PALETTE } from '../core/palette.js';

/** Small seeded PRNG so the demo doesn't shimmer between reloads. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const PLACE = { name: 'Charlotte, NC', lat: 35.2271, lon: -80.8431 };

/* A summer pattern: hot, humid, storms building each afternoon. */
export function mockWeather(place = PLACE) {
  const now = new Date();
  const daySeed = Number(`${now.getFullYear()}${now.getMonth() + 1}${now.getDate()}`);
  const rand = rng(daySeed);

  const startHour = new Date(now);
  startHour.setMinutes(0, 0, 0);

  const mean = 79, amp = 11;
  const hourly = [];

  for (let i = 0; i < 72; i++) {
    const time = new Date(startHour.getTime() + i * 3600e3);
    const hour = time.getHours();
    const dayOffset = Math.floor((time - startHour) / 86400e3);

    // Diurnal curve peaking mid-afternoon, cooling a little each day out.
    const temp = Math.round(
      mean - dayOffset * 1.4 - amp * Math.cos(((hour - 15) * Math.PI) / 12) + (rand() - 0.5) * 2
    );

    // Storms fire between 3 and 8 pm, strongest today and tomorrow.
    const stormWindow = hour >= 15 && hour <= 20;
    const stormStrength = dayOffset === 0 ? 1 : dayOffset === 1 ? 0.8 : 0.35;
    const thunderChance = stormWindow
      ? Math.round((25 + 55 * Math.sin(((hour - 15) / 5) * Math.PI)) * stormStrength)
      : 0;

    const morningShowers = dayOffset === 1 && hour >= 6 && hour <= 10;
    const precipChance = Math.max(
      thunderChance ? thunderChance + 12 : 0,
      morningShowers ? 55 : 0,
      Math.round(rand() * 12)
    );

    const cloudCover = Math.min(
      98,
      Math.round(22 + precipChance * 0.7 + (hour > 13 ? 18 : 0) + rand() * 12)
    );

    const condition =
      thunderChance >= 45 ? 'thunder'
      : precipChance >= 55 ? 'rain'
      : precipChance >= 35 ? 'drizzle'
      : cloudCover > 82 ? 'overcast'
      : cloudCover > 48 ? 'cloudy'
      : cloudCover > 20 ? 'partly'
      : 'clear';

    const { rise, set } = sunTimes(time, place.lat, place.lon);
    const night = rise && set ? time < rise || time > set : hour < 6 || hour > 20;

    hourly.push({
      time,
      temp,
      feelsLike: temp + (temp > 82 ? Math.round(3 + rand() * 5) : 0),
      condition,
      summary: CONDITION_LABEL[condition],
      precipChance,
      precipAmount: precipChance > 40 ? Math.round(rand() * 28) / 100 : 0,
      thunderChance,
      lightning: thunderChance > 55 ? 3 : thunderChance > 30 ? 2 : 0,
      cloudCover,
      humidity: Math.round(58 + (100 - temp) * 0.5 + rand() * 10),
      dewPoint: Math.round(temp - 12 + rand() * 4),
      windSpeed: Math.round(4 + rand() * 9 + (thunderChance > 50 ? 8 : 0)),
      windGust: thunderChance > 50 ? Math.round(24 + rand() * 12) : null,
      windDir: ['SW', 'WSW', 'W', 'S'][Math.floor(rand() * 4)],
      night,
    });
  }

  const daily = [];
  for (let d = 0; d < 10; d++) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
    const hours = hourly.filter((h) => h.time.toDateString() === date.toDateString());

    const pattern = ['thunder', 'rain', 'partly', 'clear', 'partly', 'thunder', 'cloudy', 'clear', 'partly', 'clear'][d];
    const hi = hours.length ? Math.max(...hours.map((h) => h.temp)) : Math.round(90 - d * 1.2 + rand() * 4);
    const lo = hours.length ? Math.min(...hours.map((h) => h.temp)) : Math.round(69 - d * 0.8 + rand() * 3);
    const { rise, set } = sunTimes(date, place.lat, place.lon);

    daily.push({
      date,
      hi,
      lo: Math.min(lo, hi - 8),
      condition: pattern,
      summary: CONDITION_LABEL[pattern],
      detail: DETAIL[pattern],
      precipChance: pattern === 'thunder' ? 70 : pattern === 'rain' ? 80 : pattern === 'cloudy' ? 20 : 8,
      precipAmount: pattern === 'thunder' ? 0.42 : pattern === 'rain' ? 0.68 : 0,
      thunderChance: pattern === 'thunder' ? 70 : 0,
      windSpeed: Math.round(6 + rand() * 8),
      sunrise: rise,
      sunset: set,
      uvMax: Math.round(6 + rand() * 4),
    });
  }

  const current = { ...hourly[0], summary: hourly[0].summary, pressure: 1013, visibility: 9.4 };

  return {
    source: 'mock',
    demo: true,
    updated: new Date(),
    place,
    current,
    hourly,
    daily,
    alerts: mockAlerts(now),
  };
}

const DETAIL = {
  thunder: 'Scattered showers and thunderstorms developing after midday, some capable of gusty winds and frequent lightning. Storms taper after sunset.',
  rain: 'Periods of rain, locally heavy at times during the morning. Rainfall amounts around half an inch.',
  partly: 'Partly sunny with a light southwest breeze. Warm and humid through the afternoon.',
  clear: 'Mostly sunny and hot. Light winds and low rain chances.',
  cloudy: 'Considerable cloudiness with a stray shower possible. Seasonably warm.',
};

function mockAlerts(now) {
  const soon = new Date(now.getTime() + 45 * 60e3);
  const later = new Date(now.getTime() + 7 * 3600e3);
  const tonight = new Date(now.getTime() + 9 * 3600e3);

  return [
    {
      id: 'demo-svr-watch',
      event: 'Severe Thunderstorm Watch',
      severity: 'Severe',
      certainty: 'Possible',
      urgency: 'Expected',
      headline: 'Severe Thunderstorm Watch in effect until 9:00 PM EDT',
      description:
        'Severe thunderstorms are possible this afternoon and evening. The primary threats are damaging wind gusts to 70 mph and frequent cloud-to-ground lightning. Large hail up to quarter size is possible with the strongest cells.',
      instruction:
        'Watch for developing thunderstorms and be ready to move indoors quickly. Bring in outdoor furniture and secure loose items.',
      areaDesc: 'Mecklenburg; Cabarrus; Union; Gaston',
      sender: 'NWS Greenville-Spartanburg',
      onset: soon,
      ends: tonight,
      geometry: null,
      isThunder: true,
      isTropical: false,
    },
    {
      id: 'demo-heat',
      event: 'Heat Advisory',
      severity: 'Moderate',
      certainty: 'Likely',
      urgency: 'Expected',
      headline: 'Heat Advisory in effect from noon to 8:00 PM EDT',
      description:
        'Heat index values up to 105 expected. Hot temperatures and high humidity may cause heat illnesses to occur.',
      instruction:
        'Drink plenty of fluids, stay in an air-conditioned room, and check up on relatives and neighbors.',
      areaDesc: 'Mecklenburg; Cabarrus; Union',
      sender: 'NWS Greenville-Spartanburg',
      onset: now,
      ends: later,
      geometry: null,
      isThunder: false,
      isTropical: false,
    },
  ];
}

export function mockAirQuality() {
  const now = new Date();
  const rand = rng(now.getDate() * 7919);
  const peak = new Date(now);
  peak.setHours(14, 0, 0, 0);

  return {
    updated: now,
    demo: true,
    aqi: Math.round(38 + rand() * 26),
    uv: Math.round(6 + rand() * 3),
    uvPeak: { time: peak, value: 9 },
    pm25: Math.round(8 + rand() * 7),
    pm10: Math.round(14 + rand() * 10),
    ozone: Math.round(58 + rand() * 22),
    no2: Math.round(9 + rand() * 8),
    so2: Math.round(2 + rand() * 3),
    co: Math.round(120 + rand() * 60),
    pollen: [
      { key: 'grass_pollen', label: 'Grass', value: Math.round(18 + rand() * 30) },
      { key: 'ragweed_pollen', label: 'Ragweed', value: Math.round(6 + rand() * 20) },
      { key: 'birch_pollen', label: 'Birch', value: Math.round(rand() * 8) },
    ],
    pollenUnavailable: false,
    hourlyAqi: [],
  };
}

export function mockStorms(place = PLACE) {
  return [
    {
      id: 'demo-al03',
      name: 'Imani',
      classification: 'HU',
      category: 2,
      windKt: 90,
      windMph: 104,
      pressure: 967,
      lat: 26.4,
      lon: -74.8,
      movementDir: 305,
      movementSpeed: 13,
      basin: 'AT3',
      lastUpdate: new Date(Date.now() - 40 * 60e3),
      advisoryUrl: null,
      coneGraphic: null,
      label: 'Cat 2 Hurricane',
      color: '#FFB300',
      distanceMiles: 690,
      demo: true,
    },
    /* Far out in the Atlantic — exists to prove distant systems render
       as one quiet line under the day's real warnings, not as a stack
       of stat cards above them. */
    {
      id: 'demo-al05',
      name: 'Cristobal',
      classification: 'TD',
      category: 0,
      windKt: 30,
      windMph: 35,
      pressure: 1014,
      lat: 14.2,
      lon: -38.5,
      movementDir: 285,
      movementSpeed: 16,
      basin: 'AT5',
      lastUpdate: new Date(Date.now() - 55 * 60e3),
      advisoryUrl: null,
      coneGraphic: null,
      label: 'Tropical Depression',
      color: '#7FB4D4',
      distanceMiles: 2547,
      demo: true,
    },
  ];
}

/* A believable week for a family of four. */
export function mockEvents() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const at = (dayOffset, hour, min = 0) =>
    new Date(today.getTime() + dayOffset * 86400e3 + hour * 3600e3 + min * 60e3);

  const CAL = {
    family: { id: 'demo-family', name: 'Family', color: PALETTE[5] },
    school: { id: 'demo-school', name: 'School', color: PALETTE[3] },
    sports: { id: 'demo-sports', name: 'Sports', color: PALETTE[1] },
    work: { id: 'demo-work', name: 'Work', color: PALETTE[6] },
  };

  const raw = [
    [0, 8, 0, 8, 45, 'Morning drop-off', CAL.school, 'Riverside Elementary'],
    [0, 12, 0, 13, 0, 'Lunch with Dana', CAL.work, 'Amelie\'s French Bakery'],
    /* Deliberately long: real family calendars are full of names like
       this, and a fixture of tidy two-word events hid the fact that the
       widget truncated them. */
    [0, 16, 0, 17, 30, 'Varsity Volleyball Pre-Season Meeting', CAL.sports, 'Freedom Park — Field 3'],
    [0, 18, 30, 19, 30, 'Family dinner', CAL.family, 'Home'],
    [1, 9, 0, 10, 0, 'Dentist — Ellie', CAL.family, 'Ballantyne Dental'],
    [1, 15, 30, 16, 30, 'Piano lesson', CAL.school, 'Ms. Harper\'s studio'],
    [1, 19, 0, 21, 0, 'Book club', CAL.family, 'Rachel\'s house'],
    [2, 7, 30, 8, 15, 'JV & Varsity Setters Training Session', CAL.sports, 'Aquatic Center'],
    [2, 13, 0, 14, 0, 'Project review', CAL.work, 'Zoom'],
    [3, 17, 0, 20, 0, 'Little League game', CAL.sports, 'Veterans Park'],
    [4, 11, 0, 12, 0, 'Field trip — museum', CAL.school, 'Discovery Place'],
    [5, 10, 0, 12, 0, 'Farmers market', CAL.family, 'Atherton Mill'],
    [6, 14, 0, 17, 0, 'Birthday party — Max', CAL.family, 'Sky Zone'],
  ];

  const events = raw.map(([d, h, m, eh, em, title, cal, location], i) => ({
    id: `demo-ev-${i}`,
    uid: `demo-ev-${i}`,
    title,
    start: at(d, h, m),
    end: at(d, eh, em),
    allDay: false,
    location,
    description: '',
    calendarId: cal.id,
    calendarName: cal.name,
    color: cal.color,
    demo: true,
  }));

  events.push({
    id: 'demo-ev-allday',
    uid: 'demo-ev-allday',
    title: 'Trash & recycling out',
    start: at(2, 0),
    end: at(3, 0),
    allDay: true,
    location: '',
    description: 'Bins to the curb by 7 AM.',
    calendarId: CAL.family.id,
    calendarName: CAL.family.name,
    color: CAL.family.color,
    demo: true,
  });

  /* Today's fixtures for two real-device bugs: an all-day event (the
     wall must show it, "All day", first) and the same event carried by
     two calendars at once (the wall must say it once). */
  events.push({
    id: 'demo-ev-allday-today',
    uid: 'demo-ev-allday-today',
    title: "Nana's birthday",
    start: at(0, 0),
    end: at(1, 0),
    allDay: true,
    location: '',
    description: '',
    calendarId: CAL.family.id,
    calendarName: CAL.family.name,
    color: CAL.family.color,
    demo: true,
  });
  events.push({
    id: 'demo-ev-dupe',
    uid: 'demo-ev-dupe',
    title: 'Varsity Volleyball Pre-Season Meeting',
    start: at(0, 16, 0),
    end: at(0, 17, 30),
    allDay: false,
    location: 'Freedom Park — Field 3',
    description: '',
    calendarId: CAL.family.id,
    calendarName: CAL.family.name,
    color: CAL.family.color,
    demo: true,
  });

  return { events: events.sort((a, b) => a.start - b.start), calendars: Object.values(CAL) };
}

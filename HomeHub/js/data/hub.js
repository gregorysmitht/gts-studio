/* The live data store.

   One place that knows how to fetch everything, on what cadence, and
   what to fall back to when a source is unreachable. Views read from
   `live` and re-render when their topic fires — no view ever calls an
   API directly. */

import { poll } from '../core/net.js';
import { state, emit, on } from '../core/store.js';
import { loadWeather, loadNowcast } from './weather.js';
import { loadAirQuality } from './airquality.js';
import { loadStorms } from './storms.js';
import { loadCalendars } from './calendar.js';
import { mockWeather, mockAirQuality, mockStorms } from './mock.js';

export const live = {
  weather: null,
  /** 15-minute precipitation outlook — the "rain in ~20 min" line. */
  nowcast: null,
  air: null,
  storms: [],
  calendar: { events: [], calendars: [] },

  /** Which feeds are currently showing generated data. */
  demo: { weather: false, air: false, storms: false, calendar: false },
  /** Which feeds are mid-flight, for skeleton states. */
  loading: { weather: true, air: true, storms: true, calendar: true },
  /** Last error per feed, surfaced in Settings. */
  errors: {},
};

/* Cadences. Alerts ride along with the weather refresh, which is why
   it's the fastest of the four. */
const EVERY = {
  weather: 6 * 60e3,
  air: 25 * 60e3,
  storms: 20 * 60e3,
  calendar: 5 * 60e3,
};

const useMock = () => state.demo !== 'off';
const forceMock = () => state.demo === 'on';

async function refreshWeather() {
  live.loading.weather = true;
  try {
    if (forceMock()) throw new Error('demo mode');
    live.weather = await loadWeather(state.place);
    live.demo.weather = false;
    delete live.errors.weather;
    // Best-effort extra; a missing nowcast just hides one line.
    live.nowcast = await loadNowcast(state.place);
  } catch (err) {
    if (!forceMock()) {
      live.errors.weather = err.message;
      console.warn('[hub] weather failed', err.message);
    }
    if (useMock()) {
      live.weather = mockWeather(state.place);
      live.demo.weather = true;
    }
    live.nowcast = null;
  } finally {
    live.loading.weather = false;
    emit('weather', live.weather);
  }
}

async function refreshAir() {
  live.loading.air = true;
  try {
    if (forceMock()) throw new Error('demo mode');
    live.air = await loadAirQuality(state.place);
    live.demo.air = false;
    delete live.errors.air;
  } catch (err) {
    if (!forceMock()) live.errors.air = err.message;
    if (useMock()) {
      live.air = mockAirQuality();
      live.demo.air = true;
    }
  } finally {
    live.loading.air = false;
    emit('air', live.air);
  }
}

async function refreshStorms() {
  live.loading.storms = true;
  try {
    if (forceMock()) {
      live.storms = mockStorms(state.place);
      live.demo.storms = true;
    } else {
      live.storms = await loadStorms(state.place);
      live.demo.storms = false;
    }
  } catch (err) {
    live.errors.storms = err.message;
    live.storms = [];
  } finally {
    live.loading.storms = false;
    emit('storms', live.storms);
  }
}

async function refreshCalendar() {
  live.loading.calendar = true;
  try {
    const result = await loadCalendars();
    live.calendar = result;
    live.demo.calendar = result.demo;
    if (result.errors?.length) live.errors.calendar = result.errors.map((e) => `${e.calendar}: ${e.message}`).join('; ');
    else delete live.errors.calendar;
  } catch (err) {
    live.errors.calendar = err.message;
    console.warn('[hub] calendar failed', err.message);
  } finally {
    live.loading.calendar = false;
    emit('calendar', live.calendar);
  }
}

export const refresh = {
  weather: refreshWeather,
  air: refreshAir,
  storms: refreshStorms,
  calendar: refreshCalendar,
  /** Pull everything now — used by the manual refresh control. */
  all: () => Promise.allSettled([refreshWeather(), refreshAir(), refreshStorms(), refreshCalendar()]),
};

let stopFns = [];

export function startData() {
  stopData();
  stopFns = [
    poll(refreshWeather, EVERY.weather),
    poll(refreshAir, EVERY.air),
    poll(refreshStorms, EVERY.storms),
    poll(refreshCalendar, EVERY.calendar),
  ];
}

export function stopData() {
  stopFns.forEach((stop) => stop());
  stopFns = [];
}

/* Changing the location or the calendar list invalidates cached data. */
on('place-changed', () => { refreshWeather(); refreshAir(); refreshStorms(); });
on('calendars-changed', () => refreshCalendar());
on('demo-changed', () => refresh.all());

/** True when anything on screen is generated rather than real. */
export const isDemo = () => Object.values(live.demo).some(Boolean);

/** Highest-priority alert, for the top bar. */
export function topAlert() {
  const alerts = live.weather?.alerts ?? [];
  return alerts[0] ?? null;
}

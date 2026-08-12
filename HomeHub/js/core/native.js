/* The native bridge.

   When the hub runs inside the iPad app (native/), the Swift shell
   injects `window.HomeHubNative` before the page loads. Everything here
   is a thin, typed wrapper around that — and every call is written so
   the same code path simply reports "unavailable" in Safari.

   Nothing in the app requires the bridge. It is strictly additive:
   the real Calendar app instead of ICS links, WeatherKit instead of
   NWS, actual screen brightness instead of a black overlay, and a
   native fetch that removes the need for the server-side proxy. */

const bridge = typeof window !== 'undefined' ? window.HomeHubNative : null;

/** Running inside the native shell rather than a browser. */
export const isNative = () => !!bridge;

/** @param {'calendar'|'weather'|'display'|'fetch'|'music'} cap */
export const nativeHas = (cap) => !!bridge?.capabilities?.includes(cap);

/* ── Events pushed from Swift ─────────────────────────────────
   Some state changes on its own — a track ends, someone skips from a
   phone — and polling for it would be both laggy and wasteful. Swift
   calls `window.HomeHubNative.onEvent(topic, payload)` and it lands
   here. */

const listeners = new Map();

export function onNativeEvent(topic, fn) {
  if (!listeners.has(topic)) listeners.set(topic, new Set());
  listeners.get(topic).add(fn);
  return () => listeners.get(topic)?.delete(fn);
}

if (bridge) {
  bridge.onEvent = (topic, payload) => {
    listeners.get(topic)?.forEach((fn) => {
      try { fn(payload); } catch (err) { console.error(`[native] ${topic} listener failed`, err); }
    });
  };
}

export const nativeVersion = () => bridge?.version ?? 0;

/**
 * Invoke a bridge method. Rejects with a readable Error rather than the
 * opaque WebKit failure, because these surface in Settings → Device.
 */
export async function nativeCall(method, params = {}) {
  if (!bridge) throw new Error('Not running in the HomeHub app');
  try {
    const result = await bridge.call(method, params);
    if (result && result.__error) throw new Error(result.__error);
    return result;
  } catch (err) {
    throw new Error(err?.message || `Native call failed: ${method}`);
  }
}

/* ── Calendar ─────────────────────────────────────────────── */

/**
 * Permission state for the device's calendars.
 * @returns {'granted'|'denied'|'notDetermined'|'unavailable'}
 */
export async function calendarAuthStatus() {
  if (!nativeHas('calendar')) return 'unavailable';
  try { return (await nativeCall('calendar.status')).status; }
  catch { return 'unavailable'; }
}

/** Prompt for calendar access. Resolves to the resulting status. */
export async function requestCalendarAccess() {
  const { status } = await nativeCall('calendar.request');
  return status;
}

/** Every calendar on the device, so the family can choose which to show. */
export async function nativeCalendars() {
  const { calendars } = await nativeCall('calendar.list');
  return calendars ?? [];
}

/**
 * Events between two instants. EventKit expands recurrence itself, so
 * unlike the ICS path there is no rule engine involved here.
 */
export async function nativeEvents(from, to, calendarIds) {
  const { events } = await nativeCall('calendar.events', {
    from: +from,
    to: +to,
    calendarIds: calendarIds?.length ? calendarIds : null,
  });
  return (events ?? []).map((ev) => ({
    ...ev,
    start: new Date(ev.start),
    end: new Date(ev.end),
  }));
}

/* ── Reminders ────────────────────────────────────────────────
   A separate grant from calendars: iPadOS treats events and reminders as
   different permissions, so a family can hand over one and not the
   other, and the hub has to ask twice. */

/** @returns {'granted'|'denied'|'notDetermined'|'unavailable'} */
export async function remindersAuthStatus() {
  if (!nativeHas('reminders')) return 'unavailable';
  try { return (await nativeCall('reminders.status')).status; }
  catch { return 'unavailable'; }
}

export async function requestRemindersAccess() {
  const { status } = await nativeCall('reminders.request');
  return status;
}

/** Every reminder list, so the family can choose which to show. */
export async function nativeReminderLists() {
  const { lists } = await nativeCall('reminders.lists');
  return lists ?? [];
}

/**
 * Incomplete reminders due before `to`, plus undated ones.
 * @param {Date} to
 * @param {string[]} [listIds] empty or omitted means every list
 */
export async function nativeReminders(to, listIds) {
  const { reminders } = await nativeCall('reminders.items', {
    to: +to,
    listIds: listIds?.length ? listIds : null,
  });
  return (reminders ?? []).map((r) => ({
    ...r,
    // A null due date is meaningful — "someday", not "overdue since 1970".
    due: r.due == null ? null : new Date(r.due),
  }));
}

/** Tick one off here and it ticks off on everyone's phone too. */
export async function completeReminder(id, done = true) {
  return nativeCall('reminders.complete', { id, done });
}

/* ── Weather ──────────────────────────────────────────────── */

/**
 * A full weather model from WeatherKit, already in the hub's shape.
 * Apple requires visible attribution wherever this data is shown, so the
 * payload carries the logo and legal URLs the weather panel renders.
 */
export async function nativeWeather(place) {
  const model = await nativeCall('weather.forecast', { lat: place.lat, lon: place.lon });
  return reviveWeather(model);
}

function reviveWeather(model) {
  const date = (v) => (v == null ? null : new Date(v));
  return {
    ...model,
    updated: date(model.updated) ?? new Date(),
    hourly: (model.hourly ?? []).map((h) => ({ ...h, time: date(h.time) })),
    daily: (model.daily ?? []).map((d) => ({
      ...d,
      date: date(d.date),
      sunrise: date(d.sunrise),
      sunset: date(d.sunset),
    })),
    alerts: (model.alerts ?? []).map((a) => ({
      ...a,
      onset: date(a.onset),
      ends: date(a.ends),
    })),
  };
}

/* ── Display ──────────────────────────────────────────────── */

/**
 * Set panel brightness, 0–1. This is the one thing a web page genuinely
 * cannot do: the browser build can only lay a black veil over the page,
 * which leaves the backlight on and reads grey in a dark hallway.
 */
export async function setBrightness(level) {
  if (!nativeHas('display')) return false;
  await nativeCall('display.setBrightness', { level: Math.max(0.01, Math.min(1, level)) });
  return true;
}

export async function getBrightness() {
  if (!nativeHas('display')) return null;
  return (await nativeCall('display.brightness')).level;
}

/** Native idle-timer control — more reliable than the Wake Lock API. */
export async function setKeepAwake(on) {
  if (!nativeHas('display')) return false;
  await nativeCall('display.keepAwake', { on: !!on });
  return true;
}

/* ── Networking ───────────────────────────────────────────────
   Requests made from Swift have no origin and therefore no CORS, which
   is exactly what the Netlify function exists to work around. Inside
   the app the function isn't needed at all. */

export async function nativeFetchText(url) {
  const { body, status } = await nativeCall('fetch.text', { url });
  if (status >= 400) {
    const error = new Error(`HTTP ${status} for ${url}`);
    error.status = status;
    throw error;
  }
  return body;
}

/** One-line summary for Settings → Device. */
export function nativeSummary() {
  if (!bridge) return 'Running in Safari — native features unavailable';
  const caps = bridge.capabilities ?? [];
  return `HomeHub app v${bridge.version} · ${caps.join(', ')}`;
}

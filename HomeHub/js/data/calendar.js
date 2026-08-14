/* Calendar source layer.

   Deliberately an adapter rather than a Google client: each family
   member pastes the "secret address in iCal format" from whatever
   calendar they already use, and the hub treats them all identically.
   Adding an OAuth-backed source later means implementing `fetchFeed`
   for it — nothing above this file needs to change.

   Results are cached to localStorage so the calendar still renders
   through a Wi-Fi outage or a reboot. */

import { getText } from '../core/net.js';
import { parseIcs } from './ics.js';
import { activeCalendars, state } from '../core/store.js';
import { startOfDay, addDays, DAY } from '../core/time.js';
import { mockEvents } from './mock.js';
import { nativeHas, nativeEvents, nativeCalendars, calendarAuthStatus } from '../core/native.js';

const CACHE_KEY = 'homehub.calendar.cache.v1';

/* How much of the calendar the hub keeps in memory. */
const WINDOW_BACK = 45;    // days
const WINDOW_FWD = 400;    // days — enough for a year of birthdays

/** webcal:// is just https:// with a different scheme name. */
export function normalizeFeedUrl(url) {
  const trimmed = String(url || '').trim();
  if (!trimmed) return '';
  if (/^webcal:\/\//i.test(trimmed)) return 'https://' + trimmed.slice(9);
  if (/^http:\/\//i.test(trimmed)) return 'https://' + trimmed.slice(7);
  return trimmed;
}

async function fetchFeed(calendar, window) {
  const url = normalizeFeedUrl(calendar.url);
  const text = await getText(url, { proxy: true, ttl: 4 * 60e3, timeout: 20000 });

  if (!/BEGIN:VCALENDAR/i.test(text)) {
    throw new Error('That link did not return a calendar file');
  }

  const { events, name } = parseIcs(text, {
    windowStart: window.from,
    windowEnd: window.to,
    calendar,
  });

  return { events, discoveredName: name };
}

/**
 * The device's own Calendar app, via EventKit.
 *
 * This is the reason the native shell exists: no secret links to paste,
 * nothing to publish, and anything the family adds on their phones shows
 * up here. EventKit expands recurrence itself, so the RRULE engine in
 * ics.js sits unused on this path.
 */
async function loadFromDevice(window_) {
  const chosen = state.deviceCalendars ?? [];
  const events = await nativeEvents(window_.from, window_.to, chosen);
  const calendars = (await nativeCalendars())
    .filter((c) => !chosen.length || chosen.includes(c.id));

  events.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
  return {
    events,
    /* `editable` survives: the event modal's edit mode needs to know
       which calendars can take a write (subscribed ones cannot). */
    calendars: calendars.map(({ id, name, color, editable }) => ({ id, name, color, editable })),
    demo: false,
    errors: [],
    source: 'device',
  };
}

/**
 * Load every enabled feed.
 * Individual feed failures are recorded on the calendar entry and the
 * rest still render — one bad link must not blank the whole panel.
 *
 * @returns {{events:Array, calendars:Array, demo:boolean, errors:Array}}
 */
export async function loadCalendars({ force = false } = {}) {
  const now0 = new Date();
  const deviceWindow = {
    from: addDays(startOfDay(now0), -WINDOW_BACK),
    to: addDays(startOfDay(now0), WINDOW_FWD),
  };

  /* Prefer the device's calendars when the app has been granted access.
     Falls through to ICS feeds if permission was never granted or the
     read fails, so a denied prompt never leaves the panel empty. */
  if (state.useDeviceCalendar !== false && nativeHas('calendar')) {
    try {
      if (await calendarAuthStatus() === 'granted') {
        return await loadFromDevice(deviceWindow);
      }
    } catch (err) {
      console.warn('[calendar] device calendars unavailable', err.message);
    }
  }

  const feeds = activeCalendars();

  if (!feeds.length) {
    if (state.demo === 'off') return { events: [], calendars: [], demo: false, errors: [] };
    const demo = mockEvents();
    return { ...demo, demo: true, errors: [] };
  }

  const results = await Promise.allSettled(
    feeds.map((feed) => fetchFeed(feed, deviceWindow))
  );

  const events = [];
  const errors = [];

  results.forEach((result, i) => {
    const feed = feeds[i];
    if (result.status === 'fulfilled') {
      events.push(...result.value.events);
      feed.lastSync = Date.now();
      feed.error = null;
      feed.count = result.value.events.length;
      if (!feed.name && result.value.discoveredName) feed.name = result.value.discoveredName;
    } else {
      const message = describeFeedError(result.reason);
      feed.error = message;
      errors.push({ calendar: feed.name || feed.url, message });
      console.warn(`[calendar] ${feed.name || feed.url}: ${message}`);
      // Fall back to whatever this feed gave us last time.
      const cached = readCache()?.byCalendar?.[feed.id];
      if (cached) events.push(...cached.map(reviveEvent));
    }
  });

  events.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));

  writeCache(feeds, events);

  return {
    events,
    calendars: feeds.map(({ id, name, color }) => ({ id, name, color })),
    demo: false,
    errors,
  };
}

function describeFeedError(err) {
  const status = err?.status;
  if (status === 403) return 'Access denied — check the link is the private/secret ICS address';
  if (status === 404) return 'Not found — the calendar link may have been reset';
  if (status === 401) return 'That calendar needs a sign-in; use the secret ICS link instead';
  if (err?.name === 'TimeoutError') return 'Timed out fetching the feed';
  return err?.message || 'Could not load this calendar';
}

/* ── Offline cache ────────────────────────────────────────── */

function writeCache(feeds, events) {
  try {
    const byCalendar = {};
    for (const feed of feeds) byCalendar[feed.id] = [];
    for (const ev of events) {
      const bucket = byCalendar[ev.calendarId];
      if (bucket) bucket.push({ ...ev, start: +ev.start, end: +ev.end });
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), byCalendar }));
  } catch {
    /* Quota or private mode — the cache is a nicety, not a requirement. */
  }
}

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || 'null'); }
  catch { return null; }
}

const reviveEvent = (ev) => ({ ...ev, start: new Date(ev.start), end: new Date(ev.end) });

/* ── Queries ──────────────────────────────────────────────── */

/** Events overlapping [from, to), sorted by start. */
export const eventsBetween = (events, from, to) =>
  events.filter((ev) => +ev.end > +from && +ev.start < +to);

/** Everything happening on a given calendar day. */
export function eventsOnDay(events, day) {
  const from = startOfDay(day);
  const to = new Date(+from + DAY);
  return eventsBetween(events, from, to).sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return a.start - b.start;
  });
}

/**
 * The next `limit` events from now, grouped by day — what the home
 * widget shows. In-progress events stay at the top until they end.
 */
export function upcoming(events, { limit = 8, days = 14, now = new Date() } = {}) {
  const cutoff = +addDays(now, days);
  return events
    .filter((ev) => +ev.end > +now && +ev.start < cutoff)
    .sort((a, b) => a.start - b.start)
    .slice(0, limit);
}

/** Group a list of events into [{ day, events }] buckets. */
export function groupByDay(events) {
  const buckets = new Map();
  for (const ev of events) {
    const key = startOfDay(ev.start).toDateString();
    if (!buckets.has(key)) buckets.set(key, { day: startOfDay(ev.start), events: [] });
    buckets.get(key).events.push(ev);
  }
  return [...buckets.values()].sort((a, b) => a.day - b.day);
}

/** Is this event happening right now? */
export const isNow = (ev, now = Date.now()) => +ev.start <= now && +ev.end > now;

/**
 * Lay out a day's timed events into non-overlapping columns, so the
 * week/day views can render concurrent events side by side.
 */
export function layoutColumns(events) {
  const timed = events.filter((e) => !e.allDay).sort((a, b) => a.start - b.start || b.end - a.end);
  const columns = [];

  for (const ev of timed) {
    let placed = false;
    for (const column of columns) {
      if (+column[column.length - 1].end <= +ev.start) {
        column.push(ev);
        placed = true;
        break;
      }
    }
    if (!placed) columns.push([ev]);
  }

  const positions = new Map();
  columns.forEach((column, index) => {
    for (const ev of column) positions.set(ev.id, { index, total: columns.length });
  });
  return positions;
}

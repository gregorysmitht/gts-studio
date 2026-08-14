/* Ambient mode — the photo screensaver (design handoff 16b, "Glass rail").

   After a quiet stretch the hub fades into a slow photo slideshow. The
   photograph fills the wall; everything worth reading lives in one
   frosted rail down the left edge — clock, date, weather, any warning,
   what is left of today, and the record playing. The point is that
   nobody should have to walk over and tap the screen to find out
   whether they need to leave.

   The rail never moves (it is the design), so burn-in is handled by a
   slow pixel drift on the content column plus the screen rests in the
   ── Screen care ── section at the foot of this file.

   With no photos loaded the rail sits over the live sky, which is a
   perfectly good thing for a wall to be doing at 2am. */

import { h, fill, $ } from '../core/dom.js';
import { clockParts, fullDate, clockTime } from '../core/time.js';
import { temp } from '../core/format.js';
import { state, photos, on, isNightNow } from '../core/store.js';
import { live, topAlert } from '../data/hub.js';
import { eventsOnDay } from '../data/calendar.js';
import { player, hasTrack } from '../data/music.js';
import { weatherIcon } from './icons.js';

let active = false;
let photoTimer = null;
let clockTimer = null;
let unsubscribes = [];

/** Ordered list of `{ id }` (local) or `{ url }` (remote) — not blobs. */
let reel = [];
let index = 0;

export const isAmbient = () => active;

export async function enterAmbient() {
  if (active) return;
  active = true;

  const host = $('#ambient');
  host.hidden = false;
  host.classList.remove('out');
  /* The overlay is transparent so the live sky can show through when
     there are no photos — which means the hub underneath has to be told
     to get out of the way itself. It used to be hidden by ambient being
     solid black, and "the clock over the live sky" quietly meant "the
     clock over nothing". */
  document.body.classList.add('ambient-on');

  fill(host,
    h('div.ambient-stage'),
    h('div.ambient-rail'),
    h('div.ambient-rail-content'),
    h('div.ambient-rest', h('div.ambient-rest-clock')),
  );

  reel = await loadReel();
  index = 0;

  paint();
  showPhoto();
  startScreenCare();

  /* Next frame gives the fade a start state to animate from; the
     timeout guarantees it appears even if no frames are being made. */
  let shown = false;
  const show = () => { if (!shown) { shown = true; host.classList.add('in'); } };
  requestAnimationFrame(show);
  setTimeout(show, 150);

  /* The old version re-read everything on a 20s timer and subscribed to
     nothing, so a warning issued at 2pm did not appear until 2pm-and-a-
     bit and a photo added mid-slideshow never appeared at all. Now the
     data arrives when it arrives and the timer only moves the clock. */
  startClock();
  unsubscribes = [
    on('weather', paint),
    on('calendar', paint),
    on('music', paint),   // the now-playing block follows the record
    on('photos', reloadReel),
  ];
}

/**
 * Repaint on the minute boundary, not every N seconds.
 *
 * A fixed interval drifts: the panel can sit a whole tick behind the
 * clock in the top bar, and two clocks on one wall disagreeing about
 * the time is the sort of thing that gets noticed from the sofa.
 */
function startClock() {
  clearTimeout(clockTimer);
  const now = new Date();
  const toNextMinute = 60000 - (now.getSeconds() * 1000 + now.getMilliseconds());
  clockTimer = setTimeout(() => { paint(); startClock(); }, toNextMinute + 40);
}

export function exitAmbient() {
  if (!active) return;
  active = false;
  clearTimeout(photoTimer);
  clearTimeout(clockTimer);
  stopScreenCare();
  for (const off of unsubscribes) off?.();
  unsubscribes = [];

  const host = $('#ambient');
  host.classList.remove('in');
  host.classList.add('out');
  document.body.classList.remove('ambient-on');
  /* Matches the 900ms CSS fade. It used to be 700, which cut the last
     fifth of the fade off with a hard snap to hidden. */
  setTimeout(() => {
    if (active) return;
    host.hidden = true;
    fill(host);
    releaseShown();
  }, 900);
}

/* ── Photos ───────────────────────────────────────────────────
   The reel holds identifiers, never blobs. Ambient used to mint an
   object URL for every stored photo the moment it started — a library
   of three hundred holidays meant three hundred decoded images pinned
   in memory for as long as the hub stayed on the wall. Now each one is
   read when its turn comes and released when it leaves the screen. */

async function loadReel() {
  const remote = (state.ambient.urls ?? []).map((url) => ({ url }));
  try {
    const stored = await photos.list();
    return [...remote, ...stored.map((row) => ({ id: row.id }))];
  } catch (err) {
    console.warn('[ambient] could not read stored photos', err);
    return remote;
  }
}

async function reloadReel() {
  const next = await loadReel();
  const changed = next.length !== reel.length
    || next.some((entry, i) => (entry.id ?? entry.url) !== (reel[i]?.id ?? reel[i]?.url));
  if (!changed) return;
  reel = next;
  if (index >= reel.length) index = 0;
  /* A newly emptied library has to give the sky back straight away —
     otherwise the last photo hangs there with nothing to replace it. */
  if (!reel.length) {
    const stage = $('.ambient-stage');
    if (stage) { fill(stage); stage.classList.add('no-photos'); releaseShown(); }
  }
}

/** Object URLs currently on screen, so they can be revoked on the way out. */
const shownUrls = new Map();

function releaseShown() {
  for (const url of shownUrls.values()) URL.revokeObjectURL(url);
  shownUrls.clear();
}

async function sourceFor(entry) {
  if (entry.url) return entry.url;
  const blob = await photos.blob(entry.id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  shownUrls.set(entry.id, url);
  return url;
}

async function showPhoto() {
  const stage = $('.ambient-stage');
  if (!stage) return;

  if (!reel.length) {
    stage.classList.add('no-photos');
    return;   // the panel over the live sky
  }
  stage.classList.remove('no-photos');

  const entry = reel[index % reel.length];
  index++;

  const url = await sourceFor(entry);
  if (!active || !url) { queueNext(); return; }

  /* Decode before fading. The cross-fade runs for over two seconds, and
     starting it against an image that has not loaded yet shows a blank
     rectangle for the first second of it. */
  try {
    const preload = new Image();
    preload.src = url;
    await preload.decode();
  } catch { /* a broken file should skip, not stop the slideshow */ }
  if (!active) return;

  const layer = h('div.ambient-photo', { style: { backgroundImage: `url("${url}")` } });
  if (state.ambient.kenBurns) {
    // Alternate the drift so consecutive photos don't all pan one way.
    layer.classList.add(index % 2 ? 'drift-a' : 'drift-b');
    layer.style.animationDuration = `${(state.ambient.seconds + 4) * 1000}ms`;
  }

  stage.appendChild(layer);
  requestAnimationFrame(() => layer.classList.add('in'));

  // Two layers alive at once: the one leaving and the one arriving.
  while (stage.children.length > 2) {
    const gone = stage.firstChild;
    gone.remove();
    releaseLayer(gone);
  }

  queueNext();
}

function queueNext() {
  clearTimeout(photoTimer);
  photoTimer = setTimeout(showPhoto, Math.max(5, state.ambient.seconds) * 1000);
}

/** Give back the object URL a dropped layer was holding. */
function releaseLayer(layer) {
  const match = /url\("([^"]+)"\)/.exec(layer?.style?.backgroundImage ?? '');
  const url = match?.[1];
  if (!url?.startsWith('blob:')) return;
  URL.revokeObjectURL(url);
  for (const [id, held] of shownUrls) if (held === url) shownUrls.delete(id);
}

/* ── The glass rail (handoff 16b) ─────────────────────────────
   One frosted column, top to bottom: clock, date, weather with today's
   range, a warning chip when one is in force, TODAY's remaining events,
   and the record playing pinned at the foot. High-fidelity to the
   handoff: sizes are frame pixels via --px, colours are the design's
   own (amber #f4c363, cool blue #9fc0ea). */

function paint() {
  const col = $('.ambient-rail-content');
  if (!col) return;

  const night = isNightNow();
  col.classList.toggle('night', night);

  const { hour, minute, period } = clockParts(new Date());
  const now = live.weather?.current;
  const today = live.weather?.daily?.[0];
  const alert = topAlert();

  fill(col,
    h('div.rail-clock',
      h('span', `${hour}:${minute}`),
      period ? h('span.rail-ampm', period) : null,
    ),
    h('div.rail-date', fullDate(new Date())),
    h('div.rail-rule'),

    now
      ? h('div.rail-wx',
          weatherIcon(now.condition, { size: 34, night: now.night }),
          h('span.rail-temp', temp(now.temp)),
        )
      : null,
    now
      ? h('div.rail-cond',
          h('span', now.summary || ''),
          today ? h('span.rail-cond-dot', ' · ') : null,
          today ? h('span.rail-hi', temp(today.hi)) : null,
          today ? h('span', ' / ') : null,
          today ? h('span.rail-lo', temp(today.lo)) : null,
        )
      : null,
    alert
      ? h('div.rail-chip',
          h('span.rail-chip-dot'),
          h('span.rail-chip-label', alert.event),
        )
      : null,

    ...todayBlock(night),
    h('div.rail-spacer'),
    nowPlayingBlock(),
  );

  paintRestClock();
}

/* Remaining events only, capped at four. The section hides when the
   day is done and stands down overnight — a hallway at 3am has no use
   for a list of errands, and less lit type is less burn-in. */
function todayBlock(night) {
  if (night || state.ambient.showAgenda === false) return [];
  const events = restOfToday().slice(0, 4);
  if (!events.length) return [];
  return [
    h('div.rail-rule'),
    h('div.rail-today', 'Today'),
    h('div.rail-events', ...events.map((ev) =>
      h('div.rail-event',
        h('span.rail-event-bar', { style: { background: ev.color || 'var(--accent)' } }),
        h('div.rail-event-main',
          h('div.rail-event-title', ev.title),
          h('div.rail-event-time', ev.allDay ? 'All day' : clockTime(ev.start)),
        ),
      ))),
  ];
}

/* Only while something is actually playing: art, title, artist, and
   three small equaliser bars breathing in amber. */
function nowPlayingBlock() {
  if (!hasTrack() || player.state !== 'playing') return null;
  const t = player.track;
  return h('div.rail-np',
    t.artworkUrl
      ? h('img.rail-np-art', { src: t.artworkUrl, alt: '' })
      : h('div.rail-np-art'),
    h('div.rail-np-meta',
      h('div.rail-np-title', t.title ?? ''),
      h('div.rail-np-artist', t.artist ?? ''),
    ),
    h('div.rail-eq', h('span'), h('span'), h('span')),
  );
}

/* `upcoming(events, { days: 1 })` looks like the right call for "the
   rest of today" and is not: its cutoff is twenty-four hours out, so at
   six in the evening it starts listing tomorrow morning. Each row
   drops off the rail after its end time — the minute tick repaints.
   Deduped the same way Up Next is: two subscribed calendars carrying
   the same event must not put it on the wall twice. */
function restOfToday() {
  const now = Date.now();
  const seen = new Set();
  return eventsOnDay(live.calendar?.events ?? [], new Date())
    .filter((ev) => +ev.end > now)
    .filter((ev) => {
      const key = `${ev.title}|${+ev.start}|${+ev.end}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/* ── Screen care ──────────────────────────────────────────────
   Two layers now. The rail is fixed to the left edge by design, so the
   old corner-hopping is gone; what protects the panel is a continuous
   pixel drift on the content column, and the whole screen still takes
   its short rests. */

/** Smallest period we will schedule on, in minutes — see scheduleRest. */
const MIN_PERIOD = 0.05;
let driftTimer = null;
let restTimer = null;
let restingUntil = 0;

function startScreenCare() {
  drift();
  driftTimer = setInterval(drift, 30000);
  scheduleRest();
}

function stopScreenCare() {
  clearInterval(driftTimer);
  clearTimeout(restTimer);
  driftTimer = restTimer = null;
  restingUntil = 0;
}

/**
 * Continuous, imperceptible movement.
 *
 * Two sine waves with coprime periods — eleven minutes across, seventeen
 * up — so the path does not retrace itself for a little over three
 * hours. A thirty-second tick paired with a thirty-second linear
 * transition is smooth without an animation frame loop running all
 * evening. A few pixels only: the rail's glass gradient is low-contrast
 * and safe; it is the type that must not sit still.
 */
function drift() {
  const col = $('.ambient-rail-content');
  if (!col) return;
  const t = Date.now() / 1000;
  const dx = Math.sin((t / 660) * Math.PI * 2) * 5;
  const dy = Math.cos((t / 1020) * Math.PI * 2) * 7;
  col.style.setProperty('--drift-x', `${dx.toFixed(1)}px`);
  col.style.setProperty('--drift-y', `${dy.toFixed(1)}px`);
}

function scheduleRest() {
  if (state.ambient.rest === false) return;
  /* More rest overnight, when there is nobody to interrupt and the
     panel has the longest unbroken run ahead of it. */
  const minutes = isNightNow()
    ? Math.max(MIN_PERIOD, (state.ambient.restMinutes ?? 60) / 2)
    : Math.max(MIN_PERIOD, state.ambient.restMinutes ?? 60);
  restTimer = setTimeout(rest, minutes * 60e3);
}

function rest() {
  const host = $('#ambient');
  if (!host || !active) return;
  const seconds = isNightNow()
    ? Math.min(300, (state.ambient.restSeconds ?? 25) * 2)
    : (state.ambient.restSeconds ?? 25);

  restingUntil = Date.now() + seconds * 1000;
  paintRestClock();
  host.classList.add('resting');

  restTimer = setTimeout(() => {
    host.classList.remove('resting');
    restingUntil = 0;
    scheduleRest();
  }, seconds * 1000);
}

/**
 * The rest is not quite black.
 *
 * A wall display that goes fully dark for half a minute reads as broken,
 * and somebody will come and prod it. A single dim line of time says
 * "resting" instead — and it lands somewhere different each time, so the
 * one thing still lit is never the same pixels twice.
 */
function paintRestClock() {
  const el = $('.ambient-rest-clock');
  if (!el) return;
  const { hour, minute, period } = clockParts(new Date());
  fill(el, `${hour}:${minute}${period ? ` ${period.toLowerCase()}` : ''}`);
  if (!restingUntil) return;
  el.style.setProperty('--rest-x', `${12 + Math.random() * 76}%`);
  el.style.setProperty('--rest-y', `${14 + Math.random() * 72}%`);
}

/* Nothing needs to ask whether a rest is running: any touch exits
   ambient mode outright, veil and all, which is the behaviour a room
   walking past a dark screen expects anyway. */

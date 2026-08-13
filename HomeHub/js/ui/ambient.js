/* Ambient mode.

   After a quiet stretch the hub fades into a slow photo slideshow. The
   photograph fills the wall; everything worth reading collects into one
   frosted panel over it — the time, the weather, what is left of today,
   and anything overdue. The point is that nobody should have to walk
   over and tap the screen to find out whether they need to leave.

   That panel is also the burn-in strategy. It drifts continuously,
   changes corner every few minutes, and the whole screen takes a short
   rest every so often. See the ── Screen care ── section at the foot of
   this file.

   With no photos loaded it shows the same panel over the live sky,
   which is a perfectly good thing for a wall to be doing at 2am. */

import { h, fill, $ } from '../core/dom.js';
import { clockParts, fullDate, clockTime, isToday } from '../core/time.js';
import { temp } from '../core/format.js';
import { state, photos, on, isNightNow } from '../core/store.js';
import { live, topAlert } from '../data/hub.js';
import { eventsOnDay, upcoming, isNow } from '../data/calendar.js';
import {
  remindersAvailable, openReminders, isOverdue,
} from '../data/reminders.js';
import {
  nextPrecipWindow, nextThunderWindow, nowcastSentence,
} from '../data/weather.js';
import { weatherIcon, icon } from './icons.js';

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
    h('div.ambient-vignette'),
    h('div.ambient-panel'),
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
    on('reminders', paint),
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
  clearInterval(rotateTimer);
  rotateTimer = null;
  rotateIndex = 0;
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

/* ── What the panel says ──────────────────────────────────────
   A quarter of the wall used to be a frosted rectangle, and on a real
   family photo it landed squarely on somebody's face. The rectangle was
   most of the problem: it blocked a bounding box, not the text inside
   it. So there is no card any more — type sits on the photograph over a
   soft pool of shade that fades out in every direction.

   The rest was quantity. Six stacked blocks were on screen at all times
   whether or not any of them mattered. Now three lines are permanent —
   time, date, weather — and everything else earns its place: anything
   happening within the hour pins itself and stays, and the remainder
   takes turns on one rotating line. A quiet afternoon is three lines. A
   busy one grows to five and shrinks back on its own. */

/** How near a thing has to be before it stops taking turns and stays put. */
const SOON = 60 * 60e3;

let rotateTimer = null;
let rotateIndex = 0;

function paint() {
  const panel = $('.ambient-panel');
  if (!panel) return;

  const night = isNightNow();
  panel.classList.toggle('night', night);
  /* No photos means the panel is the whole composition, not a caption on
     one — the type scales up to wall-clock size (see .ambient-panel.sky). */
  panel.classList.toggle('sky', !reel.length);

  const { hour, minute, period } = clockParts(new Date());

  /* At 3am a hallway wants the time, not a list of errands. Overnight
     the panel is only ever its three permanent lines — which also means
     far less of the screen is lit for the eight hours nobody reads it. */
  const { pins, spare } = night ? { pins: [], spare: [] } : composeLines();

  fill(panel,
    h('div.ambient-head',
      h('div.ambient-clock',
        h('span.num', `${hour}:${minute}`),
        period ? h('span.ambient-period', period) : null,
      ),
      h('div.ambient-date', fullDate(new Date())),
    ),
    weatherLine(),
    ...pins,
    spare.length ? h('div.ambient-rotator') : null,
  );

  startRotation(spare);
  paintRestClock();
}

/**
 * One line, not a block: icon, temperature, today's range, conditions.
 *
 * The three of these used to be a 64px glyph beside a stacked
 * temperature and a right-aligned summary, which needed 85px of height
 * and most of the panel's width to say what fits on a line.
 */
function weatherLine() {
  const now = live.weather?.current;
  if (!now) return null;
  const today = live.weather?.daily?.[0];

  return h('div.ambient-wx',
    weatherIcon(now.condition, { size: 40, night: now.night }),
    h('span.ambient-temp.num', temp(now.temp)),
    today
      ? h('span.ambient-hilo',
          h('span.hi', temp(today.hi)),
          h('span.lo', temp(today.lo)),
        )
      : null,
    h('span.ambient-wx-summary', now.summary || ''),
  );
}

/* ── What competes for the space ─────────────────────────────
   One ranked list, split in two. The top three pin themselves and stay;
   everything below takes turns on a single line.

   Built as one list on purpose. The first version had a pinned builder
   and a rotating builder that each decided independently what belonged
   to them, and anything the pin cap threw away fell down the gap
   between the two and was never shown at all — including, in the case
   that found it, a storm warning already in force. */

const RANK = {
  alert: 0,        // a warning in force
  eventNow: 1,     // already under way; you may be late
  overdue: 2,      // somebody dropped something
  eventSoon: 3,    // starts within the hour
  weatherSoon: 4,  // rain or storms within the hour
  eventLater: 5,   // later today, or tomorrow once today is done
  task: 6,         // due today, not yet late
  weatherLater: 7, // a window further out — context, not news
};

/* Exported for the probes: it is a pure function of `live`, and the
   thing most worth testing about this screen is which of the day's
   facts win the three pinned slots and that none are dropped on the
   floor. Checking that through the DOM means waiting out an eight
   second rotation to see the tail of the queue. */
export function composeLines() {
  const all = [];
  const now = Date.now();
  const add = (rank, el) => { if (el) all.push({ rank, el }); };

  const alert = topAlert();
  if (alert) {
    const loud = /extreme|severe/i.test(alert.severity ?? '');
    add(RANK.alert, line(`alert${loud ? ' severe' : ''}`,
      alert.isTropical ? 'hurricane' : alert.isThunder ? 'bolt' : 'alert',
      alert.event));
  }

  if (state.ambient.showAgenda !== false) {
    const today = restOfToday();
    for (const ev of today) {
      const running = isNow(ev);
      const soon = running || +ev.start - now <= SOON;
      add(running ? RANK.eventNow : soon ? RANK.eventSoon : RANK.eventLater,
        eventLine(ev, running ? 'Now' : clockTime(ev.start)));
    }
    /* Once today is done, "nothing else today" is a weak thing to leave
       on a wall all evening. By nine the useful question is the school
       run, not the leftovers. */
    if (!today.length) {
      for (const ev of upcoming(live.calendar?.events ?? [], { limit: 2, days: 2 })
        .filter((ev) => !isToday(ev.start))) {
        add(RANK.eventLater, eventLine(ev, `Tomorrow ${clockTime(ev.start)}`));
      }
    }
  }

  if (state.ambient.showReminders !== false) {
    for (const r of dueReminders()) {
      add(isOverdue(r) ? RANK.overdue : RANK.task,
        isOverdue(r)
          ? line('task overdue', 'alert', r.title, 'Overdue')
          : line('task', 'clock', r.title, r.hasTime ? clockTime(r.due) : 'Today'));
    }
  }

  const weather = weatherLineFor(now);
  if (weather) add(weather.rank, weather.el);

  all.sort((a, b) => a.rank - b.rank);
  /* Only the most important line gets coloured text. A stack of orange
     reads as a malfunction; one orange line above neutral ones reads as
     news. The icons keep their colour everywhere — a mark, not a block. */
  all[0]?.el.classList.add('lead');
  /* Three is the ceiling for pinning. It is for the handful of things
     worth interrupting a photograph for, and a morning where six are
     true at once is exactly when the wall should not become a list
     again. */
  return {
    pins: all.slice(0, 3).map((x) => x.el),
    spare: all.slice(3).map((x) => x.el),
  };
}

/** Rain right now, or the next window — ranked by how soon it matters. */
function weatherLineFor(now) {
  const sentence = nowcastSentence(live.nowcast);
  if (sentence) {
    return { rank: RANK.weatherSoon, el: line('timing now', 'umbrella', sentence) };
  }
  const model = live.weather;
  if (!model) return null;
  const storm = nextThunderWindow(model);
  const window = storm ?? nextPrecipWindow(model);
  if (!window) return null;
  return {
    rank: +window.from - now <= SOON ? RANK.weatherSoon : RANK.weatherLater,
    el: line(`timing ${storm ? 'storm' : 'rain'}`, storm ? 'bolt' : 'umbrella',
      `${storm ? 'Storms' : 'Rain'} ${clockTime(window.from)} – ${clockTime(new Date(+window.to + 3600e3))}`),
  };
}

/**
 * Take turns on one line rather than stacking.
 *
 * Eight seconds each: long enough to read across a room without
 * hurrying, short enough that a queue of four has come round twice
 * before the photograph changes.
 */
function startRotation(lines) {
  clearInterval(rotateTimer);
  rotateTimer = null;
  const host = $('.ambient-rotator');
  if (!host || !lines.length) return;

  if (rotateIndex >= lines.length) rotateIndex = 0;

  const put = (el) => {
    fill(host, el.cloneNode(true));
    requestAnimationFrame(() => host.classList.add('in'));
  };

  put(lines[rotateIndex % lines.length]);
  rotateIndex++;

  if (lines.length < 2) return;
  rotateTimer = setInterval(() => {
    /* Out, swap, in — rather than replacing the contents underneath a
       running transition, which reads as a flicker rather than as a
       change. */
    host.classList.remove('in');
    setTimeout(() => {
      if (!host.isConnected) return;
      put(lines[rotateIndex % lines.length]);
      rotateIndex++;
    }, 320);
  }, 8000);
}

/* ── Line builders ───────────────────────────────────────────── */

/** Every line is the same shape: a mark, a label, and an optional time. */
function line(kind, iconName, text, when) {
  return h(`div.ambient-line.${kind.split(' ').join('.')}`,
    icon(iconName, { size: 19, stroke: 2.2 }),
    h('span.ambient-line-text', text),
    when ? h('span.ambient-line-when', when) : null,
  );
}

function eventLine(ev, when) {
  return h('div.ambient-line.event',
    h('span.ambient-dot', { style: { background: ev.color || 'var(--accent)' } }),
    h('span.ambient-line-text', ev.title),
    h('span.ambient-line-when', ev.allDay ? 'All day' : when),
  );
}

/* `upcoming(events, { days: 1 })` looks like the right call for "the
   rest of today" and is not: its cutoff is twenty-four hours out, so at
   six in the evening it starts listing tomorrow morning. */
function restOfToday() {
  const now = Date.now();
  return eventsOnDay(live.calendar?.events ?? [], new Date())
    .filter((ev) => +ev.end > now);
}

/* Already sorted overdue-first by openReminders. Undated ones are left
   out on purpose: "someday" belongs in the app, not on a wall. */
function dueReminders() {
  if (!remindersAvailable()) return [];
  return openReminders().filter((r) => isOverdue(r) || (r.due && isToday(r.due)));
}

/* ── Screen care ──────────────────────────────────────────────
   Three layers, on very different clocks.

   The global nudge in idle.js only ever moved `.shift-root`, which is
   the hub — so the one screen that stays up for eight hours at a time
   never moved at all. Ambient owns its own motion rather than getting
   that class, because two systems translating the same element just
   fight over the transform. */

const ANCHORS = ['bl', 'tr', 'tl', 'br'];
/** Smallest period we will schedule on, in minutes — see scheduleMove. */
const MIN_PERIOD = 0.05;
let anchorStep = 0;
let driftTimer = null;
let moveTimer = null;
let restTimer = null;
let restingUntil = 0;

function startScreenCare() {
  const panel = $('.ambient-panel');
  if (!panel) return;
  anchorStep = 0;
  applyAnchor();

  drift();
  driftTimer = setInterval(drift, 30000);

  scheduleMove();
  scheduleRest();
}

function stopScreenCare() {
  clearInterval(driftTimer);
  clearTimeout(moveTimer);
  clearTimeout(restTimer);
  driftTimer = moveTimer = restTimer = null;
  restingUntil = 0;
}

/**
 * Continuous, imperceptible movement.
 *
 * Two sine waves with coprime periods — eleven minutes across, seventeen
 * up — so the path does not retrace itself for a little over three
 * hours. A thirty-second tick paired with a thirty-second linear
 * transition is smooth without an animation frame loop running all
 * evening for something nobody can see happening.
 */
function drift() {
  const panel = $('.ambient-panel');
  if (!panel) return;
  const t = Date.now() / 1000;
  const dx = Math.sin((t / 660) * Math.PI * 2) * 2.5;
  const dy = Math.cos((t / 1020) * Math.PI * 2) * 2.5;
  panel.style.setProperty('--drift-x', `${dx.toFixed(2)}vw`);
  panel.style.setProperty('--drift-y', `${dy.toFixed(2)}vh`);
}

function scheduleMove() {
  /* The floor is a guard against a zero or a NaN turning this into a
     runaway timer, not a policy — Settings already refuses anything
     under a minute, and duplicating that here just gives the two places
     a chance to disagree. */
  const minutes = Math.max(MIN_PERIOD, state.ambient.moveMinutes ?? 6);
  moveTimer = setTimeout(() => {
    hopAnchor();
    scheduleMove();
  }, minutes * 60e3);
}

/**
 * Corner to corner, as far as each hop can manage.
 *
 * Every hop cannot be a diagonal: the only diagonal pairs are bl↔tr and
 * tl↔br, which are two disjoint edges, so no cycle through all four
 * corners can use diagonals alone. bl → tr → tl → br alternates a
 * diagonal with a long side, which is the most travel available from a
 * four-corner cycle — and it beats a rotation, which would be four
 * short hops around the rim.
 */
function hopAnchor() {
  const panel = $('.ambient-panel');
  if (!panel) return;
  panel.classList.add('moving');
  setTimeout(() => {
    anchorStep = (anchorStep + 1) % ANCHORS.length;
    applyAnchor();
    panel.classList.remove('moving');
  }, 420);
}

function applyAnchor() {
  const panel = $('.ambient-panel');
  if (!panel) return;
  const at = ANCHORS[anchorStep];
  for (const a of ANCHORS) panel.classList.toggle(`at-${a}`, a === at);
  /* The shade is painted on the full-screen layer, so it has to be told
     which corner the type went to. */
  const vignette = $('.ambient-vignette');
  for (const a of ANCHORS) vignette?.classList.toggle(`at-${a}`, a === at);
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

/* The top bar: clock, date, and the few controls worth a permanent home.

   The clock is the single largest thing on the wall — it's what the
   hub is read for most often, from furthest away. */

import { h, fill, $ } from '../core/dom.js';
import { clockParts, fullDate } from '../core/time.js';
import { icon } from './icons.js';
import { on } from '../core/store.js';
import { isDemo } from '../data/hub.js';
import { openSettings } from './settings.js';
import { openMusicPanel } from './music-panel.js';
import { musicAvailable, hasTrack } from '../data/music.js';
import { openListsPanel } from './lists.js';
import { openChoresPanel } from './chores.js';
import { choresDueCount } from '../data/reminders.js';

let tickTimer = null;

export function mountTopbar() {
  render();
  on('weather', render);
  on('settings', render);
  on('calendar', render);
  on('reminders', render);   // the chores badge counts overdue + today
  startTicking();
}

/** Re-render exactly on the minute boundary rather than every second. */
function startTicking() {
  clearTimeout(tickTimer);
  const now = new Date();
  const msToNextMinute = 60000 - (now.getSeconds() * 1000 + now.getMilliseconds());
  tickTimer = setTimeout(() => { renderClock(); startTicking(); }, msToNextMinute + 40);
}

function renderClock() {
  const el = $('.topbar-clock');
  if (el) fill(el, ...clockNodes());
  /* The minute tick refreshes the date too — midnight changes it. */
  const date = $('.topbar-date');
  if (date) fill(date, dateLine());
}

/* Just the date. The handoff appended "· GOOD MORNING" here; it was
   tried and asked off — the same words for six hours at a stretch, on
   the line that holds the room's calendar. The daypart still drives
   the palette; it just no longer speaks. */
function dateLine() {
  return fullDate(new Date());
}

function clockNodes() {
  const { hour, minute, period } = clockParts(new Date());
  return [
    h('span.clock-time.num', `${hour}:${minute}`),
    period ? h('span.clock-period', period) : null,
  ];
}

/* The two ends are refilled, never the bar itself: the mini player lives
   between them and would be destroyed by a wholesale rebuild every time
   the weather updated. */
function render() {
  const left = $('.topbar-left');
  const right = $('.topbar-right');
  if (!left || !right) return;

  fill(left,
    h('div.topbar-clock', ...clockNodes()),
    h('div.topbar-date', dateLine()),
    /* Demo lives under the date, not in the right cluster: the bar has
       to seat four buttons around a centred music pill, and a wide pill
       of caps was the one tenant with somewhere better to be. */
    isDemo() ? demoNote() : null,
  );

  fill(right,
    /* No location pill and no alert pill. The place never changes on a
       wall-mounted iPad, so it was permanent furniture saying nothing;
       warnings moved onto the weather card, beside the conditions they
       describe. Settings is still one tap away for both. */

    /* The front door for lists and chores now that their cards are off
       the grid. Same treatment as music: a quiet icon, a full panel. */
    h('button.icon-btn.no-expand', {
      onclick: (event) => openListsPanel({ source: event.currentTarget }),
      'aria-label': 'Lists',
    }, icon('list', { size: 24 })),
    h('button.icon-btn.no-expand', {
      onclick: (event) => openChoresPanel({ source: event.currentTarget }),
      'aria-label': 'Chores',
    },
      icon('broom', { size: 24 }),
      /* The whole home-screen presence chores get: a count of what is
         owed today. Zero means no badge, not a zero. */
      choresDueCount() ? h('span.btn-badge.num', String(choresDueCount())) : null,
    ),

    /* How you reach music from a silent house. Once something is
       playing the mini player beside it is the way in, and CSS hides
       this so the bar does not carry two doors to the same room. */
    musicAvailable()
      ? h('button.icon-btn.music-btn.no-expand', {
          onclick: (event) => openMusicPanel({
            source: event.currentTarget,
            tab: hasTrack() ? 'playing' : 'browse',
          }),
          'aria-label': 'Music',
        }, icon('music', { size: 24 }))
      : null,

    h('button.icon-btn.no-expand', {
      onclick: () => openSettings(),
      'aria-label': 'Settings',
    }, icon('settings', { size: 24 })),
  );
}


function demoNote() {
  return h('button.demo-note.no-expand', {
    onclick: () => openSettings('sources'),
    title: 'Showing generated sample data — add a location or calendar to go live',
  }, 'Demo data');
}

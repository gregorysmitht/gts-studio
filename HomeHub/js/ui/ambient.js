/* Ambient mode.

   After a quiet stretch the hub fades into a slow photo slideshow with
   the time, date and next event laid over it. Doubles as burn-in
   protection: nothing stays in the same pixels for long.

   With no photos loaded it shows the clock over the live sky, which is
   a perfectly good thing for a wall to be doing at 2am. */

import { h, fill, $ } from '../core/dom.js';
import { clockParts, fullDate, clockTime, relativeDay } from '../core/time.js';
import { temp } from '../core/format.js';
import { state, photos } from '../core/store.js';
import { live } from '../data/hub.js';
import { upcoming } from '../data/calendar.js';
import { weatherIcon } from './icons.js';

let active = false;
let timer = null;
let clockTimer = null;
let urls = [];
let index = 0;

export const isAmbient = () => active;

export async function enterAmbient() {
  if (active) return;
  active = true;

  const host = $('#ambient');
  host.hidden = false;
  host.classList.remove('out');

  urls = await loadPhotoUrls();
  index = 0;

  fill(host,
    h('div.ambient-stage'),
    h('div.ambient-scrim'),
    h('div.ambient-info',
      h('div.ambient-clock'),
      h('div.ambient-date'),
      h('div.ambient-extra'),
    ),
  );

  paintClock();
  showPhoto();

  // Next frame gives the fade a start state to animate from; the timeout
  // guarantees it appears even if no frames are being produced.
  let shown = false;
  const show = () => { if (!shown) { shown = true; host.classList.add('in'); } };
  requestAnimationFrame(show);
  setTimeout(show, 150);

  clockTimer = setInterval(paintClock, 20000);
}

export function exitAmbient() {
  if (!active) return;
  active = false;
  clearTimeout(timer);
  clearInterval(clockTimer);

  const host = $('#ambient');
  host.classList.remove('in');
  host.classList.add('out');
  setTimeout(() => {
    if (active) return;
    host.hidden = true;
    fill(host);
    revokeUrls();
  }, 700);
}

async function loadPhotoUrls() {
  revokeUrls();
  const out = [...(state.ambient.urls ?? [])];
  try {
    const stored = await photos.all();
    for (const photo of stored) out.push({ blobUrl: URL.createObjectURL(photo.blob) });
  } catch (err) {
    console.warn('[ambient] could not read stored photos', err);
  }
  return out.map((entry) => (typeof entry === 'string' ? entry : entry.blobUrl));
}

function revokeUrls() {
  for (const url of urls) if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
  urls = [];
}

function showPhoto() {
  const stage = $('.ambient-stage');
  if (!stage) return;

  if (!urls.length) {
    stage.classList.add('no-photos');
    return;   // clock over the live sky
  }

  const url = urls[index % urls.length];
  index++;

  const layer = h('div.ambient-photo', {
    style: { backgroundImage: `url("${url}")` },
  });
  if (state.ambient.kenBurns) {
    // Alternate the drift direction so consecutive photos don't all
    // pan the same way.
    layer.classList.add(index % 2 ? 'drift-a' : 'drift-b');
    layer.style.animationDuration = `${(state.ambient.seconds + 4) * 1000}ms`;
  }

  stage.appendChild(layer);
  requestAnimationFrame(() => layer.classList.add('in'));

  // Keep at most two layers alive: the outgoing one and the incoming one.
  while (stage.children.length > 2) stage.firstChild.remove();

  timer = setTimeout(showPhoto, Math.max(5, state.ambient.seconds) * 1000);
}

function paintClock() {
  const { hour, minute, period } = clockParts(new Date());
  const clock = $('.ambient-clock');
  const date = $('.ambient-date');
  const extra = $('.ambient-extra');
  if (!clock) return;

  fill(clock,
    h('span.num', `${hour}:${minute}`),
    period ? h('span.ambient-period', period) : null,
  );
  fill(date, fullDate(new Date()));

  const now = live.weather?.current;
  const next = upcoming(live.calendar?.events ?? [], { limit: 1, days: 3 })[0];

  fill(extra,
    now
      ? h('span.ambient-chip',
          weatherIcon(now.condition, { size: 30, night: now.night }),
          temp(now.temp),
        )
      : null,
    next
      ? h('span.ambient-chip',
          h('span.cal-dot', { style: { background: next.color || 'var(--accent)' } }),
          `${next.allDay ? relativeDay(next.start) : clockTime(next.start)} · ${next.title}`,
        )
      : null,
  );
}

/* The Up Next card, to the design handoff: one merged agenda for the
   day. The soonest event is pinned in a highlighted row with a live
   countdown; overdue reminders sit boxed at the top; the rest of the
   day follows in time order, with finished things faded out rather
   than removed — by evening the card reads as the day's story, not
   just its remainder. */

import { h, fill, toast } from '../core/dom.js';
import { clockTime, isToday } from '../core/time.js';
import { icon } from './icons.js';
import { makeExpandable } from '../core/panel.js';
import { live } from '../data/hub.js';
import { eventsOnDay, upcoming, isNow } from '../data/calendar.js';
import { nextPrecipWindow } from '../data/weather.js';
import { openCalendarPanel } from './calendar-panel.js';
import { openEventModal } from './event-modal.js';
import { openSettings } from './settings.js';
import { state, save } from '../core/store.js';
import {
  remindersAvailable, openReminders, isOverdue, tickOff,
} from '../data/reminders.js';

let repaintTimer = null;

export function createCalendarWidget() {
  const card = h('article.card.cal-card', { id: 'w-calendar' });
  makeExpandable(card, (source) => openCalendarPanel({ source }));
  renderCalendarWidget(card);
  /* The countdown badge ("NEXT · 40 MIN") drifts a minute at a time. */
  clearInterval(repaintTimer);
  repaintTimer = setInterval(() => renderCalendarWidget(card), 30e3);
  /* Rotation changes how many whole rows fit. */
  new ResizeObserver(() => trimToWholeRows(card)).observe(card);
  return card;
}

export function renderCalendarWidget(card) {
  const { events } = live.calendar ?? { events: [] };

  if (live.loading.calendar && !events.length) {
    return fill(card,
      h('div.label', 'Up next'),
      ...[1, 2, 3].map(() => h('div.skeleton', { style: { height: 'calc(var(--px) * 56)', marginTop: 'var(--u)' } })),
    );
  }

  const now = Date.now();
  /* Deduped: a family event often lives on two subscribed calendars at
     once, and the wall should not say it twice. All-day events stay in
     (a birthday is the day's most important row); eventsOnDay already
     sorts them first. */
  const seen = new Set();
  const today = eventsOnDay(events, new Date()).filter((ev) => {
    const key = `${ev.title}|${+ev.start}|${+ev.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const reminders = remindersAvailable() ? openReminders() : [];
  const overdue = reminders.filter(isOverdue);
  const dueToday = reminders.filter((r) => !isOverdue(r) && r.due && isToday(r.due));

  if (!today.length && !overdue.length && !dueToday.length) {
    return fill(card, header(0, 0), emptyState(events));
  }

  /* The pin: the running event, else the soonest still ahead. All-day
     events never pin — there is nothing to count down to. Falls through
     to tomorrow's first once today is out of events. */
  const timed = today.filter((ev) => !ev.allDay);
  let pinned = timed.find(isNow) ?? timed.find((ev) => +ev.start > now) ?? null;
  let pinnedTomorrow = false;
  if (!pinned) {
    pinned = upcoming(events, { limit: 1, days: 2 })
      .filter((ev) => !isToday(ev.start) && !ev.allDay)[0] ?? null;
    pinnedTomorrow = !!pinned;
  }

  const rows = [];

  for (const r of overdue) rows.push(reminderRow(r, { boxed: true }));

  const remaining = today.filter((ev) => +ev.end > now).length + dueToday.length;
  rows.push(h('div.up-section',
    h('span.label', 'Today'),
    h('span.section-head-count.note', String(today.length + dueToday.length)),
  ));

  /* One list in time order: events and timed reminders interleaved. */
  const entries = [
    ...today.filter((ev) => ev !== pinned).map((ev) => ({ at: +ev.start, el: eventRow(ev, now) })),
    ...dueToday.map((r) => ({ at: r.due ? +r.due : Infinity, el: reminderRow(r, {}) })),
  ].sort((a, b) => a.at - b.at);
  rows.push(...entries.map((e) => e.el));

  fill(card,
    header(remaining, overdue.length),
    pinned ? pinRow(pinned, { now, tomorrow: pinnedTomorrow }) : null,
    h('div.up-rows', ...rows),
  );
  requestAnimationFrame(() => trimToWholeRows(card));
}

function header(remaining, overdueCount) {
  return h('div.section-head',
    h('div.label', 'Up next'),
    overdueCount
      ? h('button.note.overdue-note.no-expand', {
          onclick: (e) => { e.stopPropagation(); openCalendarPanel({}); },
        }, `${overdueCount} overdue ›`)
      : h('div.note', `${remaining} remaining`),
  );
}

/* "NEXT · 40 MIN" / "NEXT · 1H 15M" (handoff badge format). */
function countdown(ms) {
  const mins = Math.max(1, Math.round(ms / 60e3));
  if (mins < 60) return `${mins} min`;
  const h_ = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h_}h ${m}m` : `${h_}h`;
}

function leaveBy(ev) {
  if (!ev.location) return null;
  const lead = state.leaveLeadMin ?? 20;
  return clockTime(new Date(+ev.start - lead * 60e3));
}

function pinRow(ev, { now, tomorrow }) {
  const running = isNow(ev);
  const sub = [ev.location, !running && leaveBy(ev) ? `leave by ${leaveBy(ev)}` : null]
    .filter(Boolean).join(' · ');

  return h(`button.up-pin.no-expand${running ? '.now' : ''}`, {
    onclick: (e) => { e.stopPropagation(); openEventModal(ev); },
    'aria-label': `${ev.title}, ${running ? 'happening now' : clockTime(ev.start)}`,
  },
    h('span.up-dot', { style: { background: ev.color || 'var(--hh-cat-blue)' } }),
    h('div.up-pin-main',
      h('div.up-pin-title', ev.title),
      sub ? h('div.up-pin-sub', running ? `${ev.location ?? ''}${ev.location ? ' · ' : ''}started ${clockTime(ev.start)}` : sub) : null,
    ),
    h('div.up-pin-right',
      running ? null : h('div.up-pin-time', `${tomorrow ? 'Tomorrow ' : ''}${clockTime(ev.start)}`),
      h('div.up-pin-badge', running ? 'Happening now' : `Next · ${countdown(+ev.start - now)}`),
    ),
  );
}

function eventRow(ev, now) {
  const done = +ev.end < now;
  return h(`button.up-row.no-expand${done ? '.done' : ''}`, {
    onclick: (e) => { e.stopPropagation(); openEventModal(ev); },
    'aria-label': `${ev.title}, ${ev.allDay ? 'all day' : clockTime(ev.start)}`,
  },
    done
      ? h('span.up-tick', '✓')
      : h('span.up-dot', { style: { background: ev.color || 'var(--hh-cat-blue)' } }),
    h('div.up-main',
      h('div.up-title', ev.title),
      !done && ev.location ? h('div.up-sub', ev.location) : null,
    ),
    h('span.up-time', ev.allDay ? 'All day' : clockTime(ev.start)),
  );
}

/* Rain does some chores for you: a watering task on a ≥60% rain day
   offers a one-tap skip instead of a nag (handoff 3b). */
function skippable(reminder) {
  if (!/water|sprinkler|lawn|plant/i.test(reminder.title)) return false;
  const chance = live.weather?.daily?.[0]?.precipChance ?? 0;
  return chance >= 60 && !nextPrecipWindowPassed();
}
function nextPrecipWindowPassed() {
  const w = nextPrecipWindow(live.weather ?? {});
  return w ? +w.to < Date.now() : false;
}
const todayKey = () => new Date().toISOString().slice(0, 10);

function reminderRow(reminder, { boxed }) {
  const late = isOverdue(reminder);
  const skippedToday = state.skipped?.[reminder.id] === todayKey();
  const done = () => tickOff(reminder.id, true).catch((err) => toast(err.message, 'warn'));
  const skip = () => {
    state.skipped = { ...state.skipped, [reminder.id]: todayKey() };
    save('skipped');
  };

  return h(`div.up-row${late && boxed ? '.overdue' : ''}${skippedToday ? '.skipped' : ''}`,
    h('button.up-check.no-expand', {
      onclick: (e) => { e.stopPropagation(); done(); },
      'aria-label': `Mark ${reminder.title} done`,
    }),
    h('div.up-main',
      h('div.up-title', reminder.title),
      h('div.up-sub', skippedToday
        ? 'Skipped — rain will handle it'
        : [reminder.listName, skippable(reminder) ? 'Rain will handle it — skip today?' : null]
            .filter(Boolean).join(' · ')),
    ),
    skippedToday
      ? h('span.up-skipped', 'Skipped')
      : late
        ? h('span.up-tag', 'Overdue')
        : skippable(reminder)
          ? h('button.up-skip.no-expand', {
              onclick: (e) => { e.stopPropagation(); skip(); },
            }, 'Skip ›')
          : h('span.up-time', reminder.due && reminder.hasTime ? clockTime(reminder.due) : 'Today'),
  );
}

/**
 * Hide any row that would only partly fit, and never leave a section
 * heading as the last thing showing. A half-visible row invites a tap
 * the card doesn't really answer; the full list is one tap away.
 */
function trimToWholeRows(card) {
  const list = card.querySelector('.up-rows');
  if (!list) return;
  const kids = [...list.children];
  for (const el of kids) el.style.display = '';
  const bottom = list.getBoundingClientRect().top + list.clientHeight + 1;
  let cut = kids.length;
  for (let i = 0; i < kids.length; i++) {
    if (kids[i].getBoundingClientRect().bottom > bottom) { cut = i; break; }
  }
  while (cut > 0 && kids[cut - 1].classList.contains('up-section')) cut--;
  for (let i = cut; i < kids.length; i++) kids[i].style.display = 'none';
}

function emptyState(events) {
  const hasFeeds = live.calendar?.calendars?.length;
  return h('div.empty',
    icon('calendar', { size: 44, stroke: 1.6 }),
    h('div', hasFeeds || events.length ? 'Nothing on the calendar' : 'No calendars connected yet'),
    !hasFeeds && !events.length
      ? h('button.btn.no-expand', { onclick: (e) => { e.stopPropagation(); openSettings('calendars'); } }, 'Add a calendar')
      : null,
  );
}

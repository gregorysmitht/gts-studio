/* Home-screen calendar: what's next, grouped by day.

   Deliberately not a mini month grid — from across a room the useful
   question is "what's coming up", not "what does August look like".
   The month view lives one tap away in the panel. */

import { h, fill, toast } from '../core/dom.js';
import { clockTime, relativeDay, relativeTime, isToday } from '../core/time.js';
import { icon } from './icons.js';
import { makeExpandable } from '../core/panel.js';
import { live } from '../data/hub.js';
import { upcoming, groupByDay, isNow } from '../data/calendar.js';
import { openCalendarPanel, openEventSheet } from './calendar-panel.js';
import { openSettings } from './settings.js';
import {
  remindersAvailable, openReminders, remindersOn, isOverdue, tickOff,
} from '../data/reminders.js';

export function createCalendarWidget() {
  const card = h('article.card.cal-card', { id: 'w-calendar' });
  makeExpandable(card, (source) => openCalendarPanel({ source }));
  renderCalendarWidget(card);
  return card;
}

export function renderCalendarWidget(card) {
  const { events } = live.calendar ?? { events: [] };

  if (live.loading.calendar && !events.length) {
    return fill(card,
      h('div.label', 'Up next'),
      ...[1, 2, 3].map(() => h('div.skeleton', { style: { height: 'calc(var(--u) * 7)', marginTop: 'var(--u)' } })),
    );
  }

  if (!events.length) return fill(card, header(0), emptyState());

  const next = upcoming(events, { limit: 9, days: 21 });
  const groups = groupByDay(next);
  const todayCount = events.filter((e) => isToday(e.start)).length;

  /* Reminders sit inside the same day groups rather than in a card of
     their own. An event is where you have to be and a reminder is what
     you have to do, but on a wall they answer one question together:
     what does today still hold. Overdue ones break that rule and go on
     top, because something already missed is not "up next". */
  const overdue = remindersAvailable() ? openReminders().filter(isOverdue) : [];

  fill(card,
    header(todayCount, overdue.length),
    h('div.cal-list.scroll',
      ...(overdue.length ? [
        h('div.cal-day-head.overdue',
          h('span.cal-day-name', 'Overdue'),
          h('span.cal-day-rule'),
          h('span.cal-day-count', `${overdue.length}`),
        ),
        ...overdue.slice(0, 3).map(reminderRow),
      ] : []),

      ...groups.flatMap(({ day, events: dayEvents }) => {
        const dayReminders = remindersAvailable() ? remindersOn(day) : [];
        return [
          /* An editorial rule rather than a filled bar — the old grey slab
             read as UI chrome sitting on top of the list. */
          h('div.cal-day-head',
            h('span.cal-day-name', relativeDay(day)),
            h('span.cal-day-rule'),
            h('span.cal-day-count', `${dayEvents.length + dayReminders.length}`),
          ),
          ...dayEvents.map(eventRow),
          ...dayReminders.map(reminderRow),
        ];
      }),
    ),
  );
}

function header(todayCount, overdueCount = 0) {
  return h('div.section-head',
    h('div.label', 'Up next'),
    overdueCount
      ? h('div.note.overdue-note', `${overdueCount} overdue`)
      : todayCount ? h('div.note', `${todayCount} today`) : null,
  );
}

/**
 * A reminder row. Same rhythm as an event so the list reads as one list,
 * but a checkbox rather than a colour dot — the difference between a
 * thing that happens to you and a thing you have to do.
 */
function reminderRow(reminder) {
  const late = isOverdue(reminder);
  const done = () => tickOff(reminder.id, true).catch((err) => toast(err.message, 'warn'));

  return h(`div.cal-row.rem-row.no-expand${late ? '.late' : ''}`, {
    role: 'button',
    tabindex: '0',
    'aria-label': `Reminder: ${reminder.title}. Tap to mark done.`,
    onclick: (e) => { e.stopPropagation(); done(); },
    onkeydown: (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      done();
    },
  },
    h('span.rem-check', { style: { '--chip': reminder.color || 'var(--accent)' } }),
    h('div.cal-row-main',
      h('div.cal-row-title', reminder.title),
      h('div.cal-row-where', reminder.listName),
    ),
    h('div.cal-row-time',
      h('div.cal-time-main',
        reminder.due
          ? (reminder.hasTime ? clockTime(reminder.due) : 'Today')
          : 'Someday'),
      late ? h('div.cal-time-rel.late', 'Overdue') : null,
    ),
  );
}

/**
 * Rows carry `.no-expand`, which the card's expand handler skips — so a
 * tap on an event opens that event, and a tap anywhere else on the card
 * (the header, the day rules, the space between rows) opens the full
 * calendar.
 */
function eventRow(event) {
  const running = isNow(event);
  const soon = !running && event.start - Date.now() < 3 * 3600e3;

  return h(`div.cal-row.no-expand${running ? '.now' : ''}`, {
    role: 'button',
    tabindex: '0',
    'aria-label': `${event.title}, ${event.allDay ? 'all day' : clockTime(event.start)}`,
    onclick: (e) => { e.stopPropagation(); openEventSheet(event); },
    onkeydown: (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      openEventSheet(event);
    },
  },
    h('span.cal-dot', { style: { background: event.color || 'var(--accent)' } }),
    h('div.cal-row-main',
      h('div.cal-row-title', event.title),
      event.location ? h('div.cal-row-where', event.location) : null,
    ),
    h('div.cal-row-time',
      h('div.cal-time-main', event.allDay ? 'All day' : clockTime(event.start)),
      running
        ? h('div.cal-time-rel.live', 'Now')
        : soon
          ? h('div.cal-time-rel', relativeTime(event.start))
          : null,
    ),
  );
}

function emptyState() {
  const hasFeeds = live.calendar?.calendars?.length;
  return h('div.empty',
    icon('calendar', { size: 44, stroke: 1.6 }),
    h('div', hasFeeds ? 'Nothing on the calendar' : 'No calendars connected yet'),
    !hasFeeds
      ? h('button.btn.no-expand', { onclick: (e) => { e.stopPropagation(); openSettings('calendars'); } }, 'Add a calendar')
      : null,
  );
}

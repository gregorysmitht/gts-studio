/* Chores board.

   Each chore belongs to a person and repeats on a schedule. Completion
   is recorded per date, which makes streaks free and means checking a
   box on Tuesday doesn't clear Wednesday's copy. */

import { h, fill, toast } from '../core/dom.js';
import { icon } from './icons.js';
import { makeExpandable, openPanel, onPanelClose, redrawPanel } from '../core/panel.js';
import { state, save, uid, on, personById } from '../core/store.js';
import { openSettings } from './settings.js';
import {
  remindersAvailable, listItems, listName, tickOff, addReminder, isOverdue,
} from '../data/reminders.js';
import { isToday, clockTime, relativeDay, startOfDay } from '../core/time.js';

const dateKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const REPEATS = [
  { id: 'daily', label: 'Every day' },
  { id: 'weekdays', label: 'Weekdays' },
  { id: 'weekly', label: 'Certain days' },
  { id: 'once', label: 'Just once' },
];

/** Is this chore on the board for the given day? */
export function dueOn(chore, date = new Date()) {
  const day = date.getDay();
  switch (chore.repeat) {
    case 'daily': return true;
    case 'weekdays': return day >= 1 && day <= 5;
    case 'weekly': return (chore.days ?? []).includes(day);
    case 'once': return !Object.keys(chore.history ?? {}).length;
    default: return true;
  }
}

export const isDone = (chore, date = new Date()) => !!chore.history?.[dateKey(date)];

export function toggleChore(chore, date = new Date()) {
  chore.history ||= {};
  const key = dateKey(date);
  if (chore.history[key]) delete chore.history[key];
  else chore.history[key] = true;
  prune(chore);
  save('chores');
}

/** Keep only the last 120 days of history so state stays small. */
function prune(chore) {
  const cutoff = dateKey(new Date(Date.now() - 120 * 86400e3));
  for (const key of Object.keys(chore.history)) if (key < cutoff) delete chore.history[key];
}

/** Consecutive due-days completed, counting back from today. */
export function streak(chore) {
  let count = 0;
  const cursor = new Date();
  for (let i = 0; i < 90; i++) {
    if (dueOn(chore, cursor)) {
      if (isDone(chore, cursor)) count++;
      else if (i > 0 || isDone(chore, cursor) === false) break;
    }
    cursor.setDate(cursor.getDate() - 1);
  }
  return count;
}

const todaysChores = () => state.chores.filter((c) => dueOn(c));

/* ── Home tile ────────────────────────────────────────────── */

export function createChoresWidget() {
  const card = h('article.card.chore-card', { id: 'w-chores' });
  makeExpandable(card, (source) => openChoresPanel({ source }));
  renderChores(card);
  on('chores', () => renderChores(card));
  on('people', () => renderChores(card));
  return card;
}

export function renderChores(card) {
  const due = todaysChores();
  const done = due.filter((c) => isDone(c));

  if (!state.chores.length) {
    return fill(card,
      h('div.label', 'Chores'),
      h('div.empty',
        icon('clipboard', { size: 40, stroke: 1.6 }),
        h('div', 'No chores yet'),
        h('span.empty-hint', 'Tap to set up the board'),
      ),
    );
  }

  const pending = due.filter((c) => !isDone(c)).slice(0, 3);

  fill(card,
    h('div.section-head',
      h('div.label', 'Chores today'),
      h('div.note', `${done.length}/${due.length}`),
    ),

    h('div.chore-progress',
      h('div.chore-progress-fill', {
        style: { width: `${due.length ? (done.length / due.length) * 100 : 0}%` },
      }),
    ),

    pending.length
      ? h('div.chore-mini', ...pending.map((chore) => {
          const person = personById(chore.personId);
          return h('div.chore-mini-row',
            h('button.check.small.no-expand', {
              onclick: (e) => { e.stopPropagation(); toggleChore(chore); },
              'aria-label': `Mark ${chore.title} done`,
            }),
            h('span.chore-mini-title', chore.title),
            person ? h('span.chore-mini-who', { style: { color: person.color } }, person.name) : null,
          );
        }))
      : h('div.chore-clear',
          icon('check', { size: 30, stroke: 2.4 }),
          h('span', 'All done today'),
        ),
  );
}

/* ── Panel ────────────────────────────────────────────────── */

export function openChoresPanel({ source } = {}) {
  /* Linked to a Reminders list: the whole feature becomes a window onto
     that list. iOS owns the schedule — a repeating reminder rolls to its
     next occurrence when completed — so the local repeat/streak
     machinery stands down while a link is set. */
  if (remindersAvailable() && choreBoards().length) {
    openPanel({
      id: 'chores',
      title: 'Chores',
      source,
      tabs: [
        { id: 'today', label: 'Today', render: renderLinkedToday },
        { id: 'upcoming', label: 'Upcoming', render: renderLinkedUpcoming },
      ],
      actions: [
        h('button.icon-btn', {
          onclick: () => openSettings('reminders'),
          'aria-label': 'Chore list settings',
        }, icon('users', { size: 24 })),
      ],
    });
    /* Siri or a phone adds a chore while the board is up on the wall —
       but never mid-word in an add box. */
    const stop = on('reminders', () => {
      if (document.activeElement instanceof HTMLInputElement) return;
      redrawPanel();
    });
    onPanelClose(stop);
    return;
  }

  openPanel({
    id: 'chores',
    title: 'Chores',
    source,
    tabs: [
      { id: 'today', label: 'Today', render: (body) => renderToday(body) },
      { id: 'all', label: 'All chores', render: (body) => renderAll(body) },
    ],
    actions: [
      h('button.icon-btn', { onclick: () => addChore(), 'aria-label': 'Add chore' },
        icon('plus', { size: 24 })),
      /* People are edited in one place now — Settings → Family. */
      h('button.icon-btn', {
        onclick: () => openSettings('family'),
        'aria-label': 'Family settings',
      }, icon('users', { size: 24 })),
    ],
  });
}

/* ── Linked mode (choreLinks per person + choresLink shared) ── */

/** Every chore board with a Reminders list behind it, people first,
    the shared "Everyone" bucket last. */
function choreBoards() {
  const boards = state.people
    .map((person) => ({ person, listId: state.choreLinks?.[person.id] }))
    .filter((b) => b.listId);
  if (state.choresLink) boards.push({ person: null, listId: state.choresLink });
  return boards;
}

/* One reminder as a chore row: tick, title, and the schedule under it —
   the overdue tag, the due time, the repeat rule. Completing a repeating
   reminder makes EventKit schedule the next occurrence, so recurring
   chores maintain themselves; the emit-driven redraw repaints the tab. */
function linkedChoreRow(r) {
  const meta = [
    isOverdue(r) ? h('span.chore-linked-tag', 'Overdue') : null,
    r.due && r.hasTime ? h('span.chore-due', clockTime(r.due)) : null,
    r.recurring ? h('span.chore-repeat', icon('refresh', { size: 13 }), r.repeatText || 'Repeats') : null,
  ].filter(Boolean);

  return h('div.chore-row',
    h('button.check', {
      onclick: () => tickOff(r.id, true).catch((err) => toast(err.message, 'warn')),
      'aria-label': `Mark ${r.title} done`,
    }),
    h('div.chore-row-main',
      h('div.chore-row-title', r.title),
      meta.length ? h('div.chore-row-meta', ...meta) : null,
    ),
  );
}

function boardHead(board, remaining, late) {
  const { person } = board;
  return h('div.chore-column-head',
    h('span.person-chip', { style: { background: person?.color ?? 'var(--fg-faint)' } },
      person ? person.name.slice(0, 1).toUpperCase() : icon('users', { size: 15, stroke: 2.4 })),
    h('span.chore-column-name', person?.name ?? 'Everyone'),
    h('span.chore-column-count',
      remaining ? `${remaining} today${late ? ` · ${late} late` : ''}` : '✓'),
  );
}

function boardAddInput(board) {
  const who = board.person?.name ?? 'everyone';
  const input = h('input.list-input', {
    type: 'text',
    placeholder: `Add for ${who}…`,
    autocapitalize: 'sentences',
    enterkeyhint: 'done',
    onkeydown: (e) => {
      if (e.key !== 'Enter') return;
      const text = input.value.trim();
      if (!text) return;
      input.value = '';
      addReminder(board.listId, text).catch((err) => toast(err.message, 'warn'));
    },
  });
  return h('div.list-add.compact', icon('plus', { size: 20 }), input);
}

/** What is owed right now: late first, then today, then the undated
    "anytime" pile — one column per person, so a kid walks up and reads
    only their own. */
function renderLinkedToday(body) {
  const boards = choreBoards();

  fill(body,
    h('div.chore-columns',
      ...boards.map((board) => {
        const items = listItems(board.listId);
        const late = items.filter((r) => isOverdue(r));
        const today = items.filter((r) => !isOverdue(r) && r.due && isToday(r.due));
        const anytime = items.filter((r) => !r.due);

        return h('div.chore-column.well',
          boardHead(board, late.length + today.length, late.length),
          late.length + today.length
            ? h('div.chore-board-rows',
                ...late.map(linkedChoreRow),
                ...today.map(linkedChoreRow))
            : h('div.chore-clear',
                icon('check', { size: 30, stroke: 2.4 }),
                h('span', 'All done today')),
          anytime.length
            ? h('div.chore-anytime',
                h('div.chore-anytime-head', 'Anytime'),
                ...anytime.map(linkedChoreRow))
            : null,
          boardAddInput(board),
        );
      }),
    ),
    syncNote(boards),
  );
}

/** The days ahead, grouped under day headers inside each column. */
function renderLinkedUpcoming(body) {
  const boards = choreBoards();

  fill(body,
    h('div.chore-columns',
      ...boards.map((board) => {
        const later = listItems(board.listId)
          .filter((r) => r.due && !isOverdue(r) && !isToday(r.due));

        const byDay = new Map();
        for (const r of later) {
          const key = +startOfDay(r.due);
          if (!byDay.has(key)) byDay.set(key, []);
          byDay.get(key).push(r);
        }

        return h('div.chore-column.well',
          boardHead(board, later.length, 0),
          later.length
            ? h('div.chore-board-rows',
                ...[...byDay.entries()].sort(([a], [b]) => a - b).flatMap(([day, rows]) => [
                  h('div.chore-anytime-head', relativeDay(new Date(day))),
                  ...rows.map(linkedChoreRow),
                ]))
            : h('div.chore-clear',
                icon('clipboard', { size: 30, stroke: 2 }),
                h('span', 'Nothing scheduled')),
        );
      }),
    ),
    syncNote(boards),
  );
}

function syncNote(boards) {
  const names = boards.map((b) => listName(b.listId) ?? 'Chores');
  return h('div.list-sync-note',
    icon('refresh', { size: 16 }),
    `Synced with Reminders · ${names.join(', ')}`,
    h('span.list-sync-hint', 'Repeats and due dates are set in the Reminders app — or by Siri'),
  );
}

function renderToday(body) {
  const due = todaysChores();
  if (!due.length) {
    return fill(body, h('div.empty', icon('clipboard', { size: 48, stroke: 1.6 }),
      h('div', 'Nothing due today'),
      h('button.btn', { onclick: () => addChore() }, 'Add a chore')));
  }

  // Group by person so each family member sees their own column.
  const groups = new Map();
  for (const chore of due) {
    const key = chore.personId ?? '_';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(chore);
  }

  fill(body,
    h('div.chore-columns',
      ...[...groups.entries()].map(([personId, chores]) => {
        const person = personById(personId);
        const done = chores.filter((c) => isDone(c)).length;
        return h('div.chore-column.well',
          h('div.chore-column-head',
            h('span.person-chip', { style: { background: person?.color ?? 'var(--fg-faint)' } },
              (person?.name ?? '?').slice(0, 1).toUpperCase()),
            h('span.chore-column-name', person?.name ?? 'Anyone'),
            h('span.chore-column-count', `${done}/${chores.length}`),
          ),
          ...chores.map((chore) => choreRow(chore, body)),
        );
      }),
    ),
  );
}

function choreRow(chore, body) {
  const done = isDone(chore);
  const run = streak(chore);
  return h(`div.chore-row${done ? '.done' : ''}`,
    h('button.check', {
      onclick: () => { toggleChore(chore); renderToday(body); },
      'aria-label': `${done ? 'Undo' : 'Complete'} ${chore.title}`,
    }, done ? icon('check', { size: 22, stroke: 3 }) : null),
    h('div.chore-row-main',
      h('div.chore-row-title', chore.title),
      run >= 2 ? h('div.chore-streak', icon('flame', { size: 15 }), `${run} day streak`) : null,
    ),
  );
}

function renderAll(body) {
  if (!state.chores.length) {
    return fill(body, h('div.empty', icon('clipboard', { size: 48, stroke: 1.6 }), 'No chores yet'));
  }
  fill(body,
    h('div.chore-all',
      ...state.chores.map((chore) => {
        const person = personById(chore.personId);
        const repeat = REPEATS.find((r) => r.id === chore.repeat)?.label ?? '';
        return h('div.chore-manage-row.well',
          h('div.chore-manage-main',
            h('div.chore-row-title', chore.title),
            h('div.chore-manage-meta',
              person ? h('span', { style: { color: person.color } }, person.name) : h('span.dim', 'Anyone'),
              h('span.dim', '·'),
              h('span.dim', repeat),
              chore.repeat === 'weekly' && chore.days?.length
                ? h('span.dim', chore.days.map((d) => 'SMTWTFS'[d]).join(' '))
                : null,
            ),
          ),
          h('button.icon-btn.ghost', {
            onclick: () => {
              state.chores = state.chores.filter((c) => c.id !== chore.id);
              save('chores');
              renderAll(body);
            },
            'aria-label': `Delete ${chore.title}`,
          }, icon('trash', { size: 20 })),
        );
      }),
      h('button.btn.primary.chore-add', { onclick: () => addChore(body) },
        icon('plus', { size: 22 }), 'Add chore'),
    ),
  );
}

function addChore(body) {
  const title = prompt('What is the chore?');
  if (!title?.trim()) return;

  state.chores.push({
    id: uid(),
    title: title.trim(),
    personId: state.people[0]?.id ?? null,
    repeat: 'daily',
    days: [],
    history: {},
  });
  save('chores');
  toast('Chore added — set who and how often in “All chores”');
  if (body) renderAll(body);
}

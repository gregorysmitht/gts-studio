/* Apple Reminders.

   Only available inside the iPad app — there is no web equivalent, and
   unlike calendars there is no ICS-shaped fallback to reach for. So
   `remindersAvailable()` is false in Safari and every view that shows
   reminders simply omits them rather than showing an empty shelf.

   Reminders are deliberately kept beside events rather than merged into
   them. They answer a different question: an event is where you have to
   be, a reminder is what you have to do. The calendar shows both, but a
   family reads them differently and they should not sort into one
   another. */

import {
  nativeHas, remindersAuthStatus, requestRemindersAccess,
  nativeReminderLists, nativeReminders, completeReminder, createReminder,
} from '../core/native.js';
import { state, save, emit } from '../core/store.js';
import { startOfDay, addDays } from '../core/time.js';

export const remindersAvailable = () => nativeHas('reminders');

/** How far ahead to look. Beyond this it stops being "upcoming". */
const HORIZON_DAYS = 21;

export const reminderState = {
  auth: 'unavailable',
  lists: [],
  items: [],
  loaded: false,
  error: null,
};

/* ── Access ───────────────────────────────────────────────── */

export async function reminderAuth() {
  reminderState.auth = await remindersAuthStatus();
  return reminderState.auth;
}

export async function connectReminders() {
  const status = await requestRemindersAccess();
  reminderState.auth = status;
  if (status === 'granted') await loadReminders();
  emit('reminders');
  return status;
}

/* ── Loading ──────────────────────────────────────────────── */

export async function loadReminderLists() {
  if (!remindersAvailable()) return [];
  try {
    reminderState.lists = await nativeReminderLists();
  } catch {
    reminderState.lists = [];
  }
  return reminderState.lists;
}

export async function loadReminders() {
  if (!remindersAvailable()) return [];

  reminderState.auth = await remindersAuthStatus();
  if (reminderState.auth !== 'granted') {
    reminderState.items = [];
    reminderState.loaded = true;
    return [];
  }

  try {
    await loadReminderLists();
    const horizon = addDays(startOfDay(new Date()), HORIZON_DAYS);
    /* The agenda's list filter must never starve a linked list: a
       Groceries list excluded from Up Next still has to feed the Lists
       panel. Union the linked ids into the request ([] still means all). */
    const chosen = state.reminderLists ?? [];
    const linked = [...Object.values(state.listLinks ?? {}), state.choresLink]
      .filter(Boolean);
    const ids = chosen.length ? [...new Set([...chosen, ...linked])] : [];
    reminderState.items = await nativeReminders(horizon, ids);
    reminderState.error = null;
  } catch (err) {
    reminderState.error = err.message;
    reminderState.items = [];
  }

  reminderState.loaded = true;
  emit('reminders');
  return reminderState.items;
}

/* ── Selection ────────────────────────────────────────────── */

/** Empty means every list, matching how device calendars behave. */
export function isListShown(id) {
  const chosen = state.reminderLists ?? [];
  return !chosen.length || chosen.includes(id);
}

export function toggleList(id) {
  const chosen = state.reminderLists ?? [];
  const all = reminderState.lists.map((l) => l.id);
  let next = chosen.length ? [...chosen] : all;
  next = next.includes(id) ? next.filter((x) => x !== id) : [...next, id];
  // Back to "all" rather than an exhaustive list, so a list added on a
  // phone later shows up instead of being silently excluded.
  state.reminderLists = next.length === all.length ? [] : next;
  save('settings');
  loadReminders();
}

/* ── Completing ───────────────────────────────────────────── */

export async function tickOff(id, done = true) {
  // Optimistic: the tap should feel instant on a wall, and EventKit is
  // the source of truth on the next load either way.
  const item = reminderState.items.find((r) => r.id === id);
  if (item) item.completed = done;
  emit('reminders');

  try {
    await completeReminder(id, done);
  } catch (err) {
    if (item) item.completed = !done;
    emit('reminders');
    throw err;
  }
  // Completed items drop out of the next fetch on their own.
  loadReminders();
}

/* ── Adding ───────────────────────────────────────────────── */

/** Create a reminder in a specific list and refresh. */
export async function addReminder(listId, title) {
  await createReminder(listId, title);
  await loadReminders();
}

/* ── Queries ──────────────────────────────────────────────── */

const isOverdue = (r) => r.due && r.due < new Date() && !r.completed;

/** Everything still open, overdue first, then by due date, undated last. */
export function openReminders() {
  return reminderState.items
    .filter((r) => !r.completed)
    .sort((a, b) => {
      if (isOverdue(a) !== isOverdue(b)) return isOverdue(a) ? -1 : 1;
      const at = a.due ? +a.due : Infinity;
      const bt = b.due ? +b.due : Infinity;
      return at - bt;
    });
}

/** Those due on a given day — what the calendar's day cells ask for. */
export function remindersOn(day) {
  const from = startOfDay(day);
  const to = addDays(from, 1);
  return reminderState.items.filter(
    (r) => !r.completed && r.due && r.due >= from && r.due < to
  );
}

export function overdueCount() {
  return reminderState.items.filter(isOverdue).length;
}

/** One list's open items — what a linked hub list renders. Dated first
    (a grocery with a date means "before Saturday"), undated after, in
    the order Reminders returned them. */
export function listItems(listId) {
  return reminderState.items
    .filter((r) => !r.completed && r.listId === listId)
    .sort((a, b) => (a.due ? +a.due : Infinity) - (b.due ? +b.due : Infinity));
}

/** The linked list's display name, for "Synced with Reminders · X". */
export function listName(listId) {
  return reminderState.lists.find((l) => l.id === listId)?.name ?? null;
}

export { isOverdue };

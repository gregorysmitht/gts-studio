/* Persistent app state.

   One object, saved to localStorage, with a coarse pub/sub. The hub is
   small enough that "something changed, re-render the affected view" is
   the right granularity — no reactive framework needed. */

const KEY = 'homehub.state.v1';

import { PALETTE } from './palette.js';

export const uid = () =>
  Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

const DEFAULTS = {
  /* Charlotte, NC as a sensible starting point — Settings replaces it
     on first run via geolocation or a place search. */
  place: { name: 'Charlotte, NC', lat: 35.2271, lon: -80.8431 },

  units: 'F',            // 'F' | 'C'
  windUnit: 'mph',       // 'mph' | 'kph'
  scale: 1,              // global UI size multiplier
  weekStartsOn: 0,       // 0 = Sunday

  calendars: [],         // { id, name, url, color, enabled, lastSync, error }
  people: [],            // { id, name, color }

  /* Native shell only. When the app has calendar access, the device's
     own calendars replace the ICS feeds; an empty list means "all". */
  useDeviceCalendar: true,
  deviceCalendars: [],   // EKCalendar identifiers to include
  nativeBrightness: true, // let the hub set panel brightness at night

  lists: [
    { id: 'groceries', name: 'Groceries', icon: 'cart', items: [] },
    { id: 'todo',      name: 'To Do',     icon: 'check', items: [] },
  ],

  chores: [],            // { id, title, personId, repeat, days[], history{} }

  ambient: {
    enabled: true,
    idleMinutes: 8,
    seconds: 22,          // per photo
    kenBurns: true,
    urls: [],             // remote photos; local ones live in IndexedDB
  },

  night: {
    enabled: true,
    start: '22:00',
    end: '06:30',
    dim: 0.55,            // 0–0.9 veil opacity
  },

  burnIn: true,           // periodic few-pixel layout nudge
  keepAwake: true,        // request a screen wake lock
  demo: 'auto',           // 'auto' | 'on' | 'off'
  onboarded: false,
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const saved = JSON.parse(raw);
    // Shallow-merge so new defaults appear for existing installs.
    const merged = { ...structuredClone(DEFAULTS), ...saved };
    for (const k of ['place', 'ambient', 'night']) {
      merged[k] = { ...DEFAULTS[k], ...(saved[k] || {}) };
    }
    return merged;
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export const state = load();

const listeners = new Map();   // topic → Set<fn>

/** Subscribe to a topic ('settings', 'calendars', 'lists', 'chores', …). */
export function on(topic, fn) {
  if (!listeners.has(topic)) listeners.set(topic, new Set());
  listeners.get(topic).add(fn);
  return () => listeners.get(topic)?.delete(fn);
}

export function emit(topic, payload) {
  listeners.get(topic)?.forEach((fn) => {
    try { fn(payload); } catch (err) { console.error(`[store] ${topic} listener failed`, err); }
  });
  listeners.get('*')?.forEach((fn) => fn(topic, payload));
}

let saveTimer = null;
/** Persist (debounced) and notify. */
export function save(topic = 'settings', payload) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('[store] could not persist state', err);
    }
  }, 120);
  if (topic) emit(topic, payload);
}

/** Apply a patch to the top level of state and save. */
export function update(patch, topic = 'settings') {
  Object.assign(state, patch);
  save(topic);
}

export function resetAll() {
  localStorage.removeItem(KEY);
  location.reload();
}

/**
 * First-run starter content.
 *
 * An empty chores board and an empty shopping list make a brand-new hub
 * look broken rather than new, so the first launch seeds a couple of
 * obvious examples. Everything here is ordinary user data — delete it
 * and it stays deleted, because `onboarded` is only ever set once.
 */
export function seedFirstRun() {
  if (state.onboarded) return;
  state.onboarded = true;

  if (!state.people.length) {
    state.people = [
      { id: uid(), name: 'Grown-ups', color: PALETTE[3] },
      { id: uid(), name: 'Kids', color: PALETTE[5] },
    ];
  }

  if (!state.chores.length) {
    const [grownups, kids] = state.people;
    state.chores = [
      { id: uid(), title: 'Dishes after dinner', personId: kids?.id ?? null, repeat: 'daily', days: [], history: {} },
      { id: uid(), title: 'Take the bins out', personId: grownups?.id ?? null, repeat: 'weekly', days: [2], history: {} },
      { id: uid(), title: 'Tidy bedrooms', personId: kids?.id ?? null, repeat: 'weekly', days: [6], history: {} },
    ];
  }

  const groceries = state.lists.find((l) => l.id === 'groceries');
  if (groceries && !groceries.items.length) {
    groceries.items = ['Milk', 'Bread', 'Coffee'].map((text) => ({
      id: uid(), text, done: false, at: Date.now(),
    }));
  }

  save('settings');
}

/* ── Derived helpers ──────────────────────────────────────── */

export const activeCalendars = () => state.calendars.filter((c) => c.enabled !== false && c.url);

export const personById = (id) => state.people.find((p) => p.id === id);

/** Palette offered when adding a calendar or a family member. */
export { PALETTE } from './palette.js';

/** Pick the least-used colour so new entries stay visually distinct. */
export function nextColor(used = []) {
  const counts = PALETTE.map((c) => used.filter((u) => u === c).length);
  return PALETTE[counts.indexOf(Math.min(...counts))];
}

/* ── Local photo storage (IndexedDB) ──────────────────────────
   Photos picked from the iPad live here as blobs so ambient mode
   works offline and survives reloads. */

const DB_NAME = 'homehub-photos';
let dbPromise = null;

function db() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('photos', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const conn = await db();
  return new Promise((resolve, reject) => {
    const t = conn.transaction('photos', mode);
    const store = t.objectStore('photos');
    const result = fn(store);
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
  });
}

export const photos = {
  async add(blob, name) {
    const id = uid();
    await tx('readwrite', (s) => s.put({ id, blob, name, added: Date.now() }));
    emit('photos');
    return id;
  },
  async all() {
    return tx('readonly', (s) => s.getAll());
  },
  async remove(id) {
    await tx('readwrite', (s) => s.delete(id));
    emit('photos');
  },
  async count() {
    return tx('readonly', (s) => s.count());
  },
  async clear() {
    await tx('readwrite', (s) => s.clear());
    emit('photos');
  },
};

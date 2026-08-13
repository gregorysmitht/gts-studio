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

  /* Handoff additions. skipped: reminder id → 'YYYY-MM-DD' it was skipped
     for ("rain will handle it"). checklists: event id → { itemText: true }
     for the modal's packing list. leaveLeadMin: how long before a located
     event the "leave by" line assumes you need. */
  skipped: {},
  checklists: {},
  leaveLeadMin: 20,

  ambient: {
    enabled: true,
    idleMinutes: 8,
    seconds: 22,          // per photo
    kenBurns: true,
    urls: [],             // remote photos; local ones live in IndexedDB
    showAgenda: true,     // the rest of today, on the ambient panel
    showReminders: true,  // overdue and due today
    moveMinutes: 6,       // how often the panel changes corner
    rest: true,           // periodic black rest, for the panel's sake
    restMinutes: 60,
    restSeconds: 25,
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

/**
 * Is the clock inside the configured quiet hours? Handles windows that
 * wrap past midnight (22:00 → 06:30).
 *
 * It lives here rather than in idle.js — which is what acts on it — so
 * that ambient mode can ask the question without the two importing each
 * other. The bundler refuses a cycle, and it would be right to.
 */
export function isNightNow(now = new Date()) {
  if (!state.night.enabled) return false;
  const toMinutes = (hhmm) => {
    const [h, m] = String(hhmm || '0:00').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const minutes = now.getHours() * 60 + now.getMinutes();
  const start = toMinutes(state.night.start);
  const end = toMinutes(state.night.end);
  return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

/* ── Local photo storage (IndexedDB) ──────────────────────────
   Photos picked from the iPad live here as blobs so ambient mode
   works offline and survives reloads.

   Two stores, not one. Everything that wants to *list* photos — the
   settings grid, the slideshow deciding what comes next — needs the
   name and the order and a picture small enough to show at thumbnail
   size. None of them need four megabytes of original. Keeping the full
   images in their own store means listing the library reads a few
   hundred kilobytes instead of the whole thing.

     photoMeta  { id, thumb, name, added, order, w, h }
     photoFull  { id, blob } */

const DB_NAME = 'homehub-photos';
const DB_VERSION = 2;
const META = 'photoMeta';
const FULL = 'photoFull';

let dbPromise = null;

function db() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => migrate(req.result, req.transaction, event.oldVersion);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/**
 * v1 kept one store of `{ id, blob, name, added }`. Split it, and give
 * every existing photo an `order` of its `added` timestamp — `id` was
 * already timestamp-prefixed, so that preserves exactly the sequence
 * they have been displaying in. Thumbnails are left null and filled in
 * the first time the grid renders; generating them here would mean
 * decoding the whole library inside an upgrade transaction.
 */
function migrate(conn, upgradeTx, oldVersion) {
  if (!conn.objectStoreNames.contains(META)) conn.createObjectStore(META, { keyPath: 'id' });
  if (!conn.objectStoreNames.contains(FULL)) conn.createObjectStore(FULL, { keyPath: 'id' });
  if (oldVersion >= 1 && conn.objectStoreNames.contains('photos')) {
    const old = upgradeTx.objectStore('photos');
    const meta = upgradeTx.objectStore(META);
    const full = upgradeTx.objectStore(FULL);
    old.openCursor().onsuccess = (event) => {
      const cursor = event.target.result;
      if (!cursor) {
        /* Reclaim the space, but never at the cost of the upgrade: if
           this throws the copies are already written, and a stale store
           is a much smaller problem than a database that won't open. */
        try { conn.deleteObjectStore('photos'); } catch (err) {
          console.warn('[store] kept the old photo store', err);
        }
        return;
      }
      const { id, blob, name, added } = cursor.value;
      meta.put({ id, thumb: null, name, added, order: added ?? 0, w: 0, h: 0 });
      full.put({ id, blob });
      cursor.continue();
    };
  }
}

async function tx(names, mode, fn) {
  const conn = await db();
  const list = Array.isArray(names) ? names : [names];
  return new Promise((resolve, reject) => {
    const t = conn.transaction(list, mode);
    const result = fn(...list.map((n) => t.objectStore(n)));
    t.oncomplete = () => resolve(result?.result ?? result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const byOrder = (a, b) => (a.order ?? a.added ?? 0) - (b.order ?? b.added ?? 0);

export const photos = {
  /**
   * Store one picked file. `prepared` is the `{ full, thumb, w, h }` from
   * imaging.prepare — passed in rather than imported so this module stays
   * free of anything that needs a canvas.
   */
  async add(prepared, name, order) {
    const id = uid();
    const added = Date.now();
    await tx([META, FULL], 'readwrite', (meta, full) => {
      meta.put({ id, thumb: prepared.thumb, name, added, order: order ?? added, w: prepared.w, h: prepared.h });
      full.put({ id, blob: prepared.full });
    });
    emit('photos');
    return id;
  },

  /** Everything known about every photo, in display order — no full blobs. */
  async list() {
    const rows = await tx(META, 'readonly', (s) => s.getAll());
    return (rows ?? []).sort(byOrder);
  },

  /** The one full-size image, for the slideshow to show right now. */
  async blob(id) {
    const row = await tx(FULL, 'readonly', (s) => s.get(id));
    return row?.blob ?? null;
  },

  /** Backfill for photos migrated from v1, which have no thumbnail yet. */
  async setThumb(id, thumb, w, h) {
    await tx(META, 'readwrite', (s) => {
      const get = s.get(id);
      get.onsuccess = () => {
        if (!get.result) return;
        s.put({ ...get.result, thumb, w, h });
      };
    });
  },

  /** Rewrite display order from a sequence of ids. Unlisted ids are left alone. */
  async reorder(ids) {
    await tx(META, 'readwrite', (s) => {
      ids.forEach((id, index) => {
        const get = s.get(id);
        get.onsuccess = () => {
          if (!get.result) return;
          s.put({ ...get.result, order: index });
        };
      });
    });
    emit('photos');
  },

  async remove(id) {
    await tx([META, FULL], 'readwrite', (meta, full) => {
      meta.delete(id);
      full.delete(id);
    });
    emit('photos');
  },

  async count() {
    return tx(META, 'readonly', (s) => s.count());
  },

  async clear() {
    await tx([META, FULL], 'readwrite', (meta, full) => {
      meta.clear();
      full.clear();
    });
    emit('photos');
  },
};

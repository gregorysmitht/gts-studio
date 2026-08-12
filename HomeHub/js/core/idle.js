/* Wall-display housekeeping.

   Four small jobs that together make the difference between "a web page
   left open" and "an appliance":
     • keep the screen awake
     • dim it overnight
     • nudge the layout a few pixels so nothing burns in
     • drop into ambient mode when nobody has touched it for a while
*/

import { $ } from './dom.js';
import { state, on } from './store.js';
import { enterAmbient, exitAmbient, isAmbient } from '../ui/ambient.js';
import { nativeHas, setBrightness, getBrightness, setKeepAwake } from './native.js';

const ACTIVITY = ['pointerdown', 'keydown', 'wheel', 'touchstart'];

let idleTimer = null;
let wakeLock = null;

export function startIdleWatch() {
  resetIdle();
  for (const event of ACTIVITY) {
    document.addEventListener(event, onActivity, { passive: true, capture: true });
  }
  on('ambient-changed', resetIdle);
  on('night-changed', applyNight);
  on('wake-changed', requestWakeLock);

  applyNight();
  setInterval(applyNight, 60e3);

  startBurnInShift();
  requestWakeLock();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestWakeLock();
  });
}

function onActivity() {
  if (isAmbient()) exitAmbient();
  resetIdle();
}

function resetIdle() {
  clearTimeout(idleTimer);
  if (!state.ambient.enabled) return;
  const delay = Math.max(1, state.ambient.idleMinutes) * 60e3;
  idleTimer = setTimeout(() => {
    if (!isAmbient()) enterAmbient();
  }, delay);
}

/* ── Night dimming ────────────────────────────────────────── */

const toMinutes = (hhmm) => {
  const [h, m] = String(hhmm || '0:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

/** Handles windows that wrap past midnight (22:00 → 06:30). */
export function isNightNow(now = new Date()) {
  if (!state.night.enabled) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const start = toMinutes(state.night.start);
  const end = toMinutes(state.night.end);
  return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

let brightnessRestored = null;

/**
 * In the browser this can only lay a black veil over the page — the
 * backlight stays on and a dark hallway still glows grey. In the native
 * app it dims the panel for real, and the veil is skipped entirely.
 */
function applyNight() {
  const dimmer = $('#dimmer');
  if (!dimmer) return;
  const night = isNightNow();

  if (state.nativeBrightness !== false && nativeHas('display')) {
    dimmer.style.opacity = '0';
    // night.dim is "how much to take away", so brightness is its inverse.
    const target = night ? Math.max(0.02, 1 - state.night.dim) : brightnessRestored;
    if (night && brightnessRestored == null) {
      getBrightness().then((level) => { brightnessRestored = level ?? 1; });
    }
    if (target != null) setBrightness(target).catch(() => {});
    if (!night) brightnessRestored = null;
    return;
  }

  dimmer.style.opacity = night ? String(state.night.dim) : '0';
}

/* ── Burn-in shift ────────────────────────────────────────── */

/** Nudge the whole layout a few pixels every ten minutes. */
function startBurnInShift() {
  let step = 0;
  setInterval(() => {
    if (!state.burnIn) {
      for (const el of document.querySelectorAll('.shift-root')) el.style.translate = '';
      return;
    }
    step = (step + 1) % 8;
    const angle = (step / 8) * Math.PI * 2;
    const dx = Math.round(Math.cos(angle) * 3);
    const dy = Math.round(Math.sin(angle) * 3);
    for (const el of document.querySelectorAll('.shift-root')) {
      el.style.translate = `${dx}px ${dy}px`;
    }
  }, 10 * 60e3);
}

/* ── Wake lock ────────────────────────────────────────────── */

async function requestWakeLock() {
  if (nativeHas('display')) {
    setKeepAwake(state.keepAwake).catch(() => {});
    return;
  }
  if (!state.keepAwake || !('wakeLock' in navigator)) return;
  try {
    if (wakeLock && !wakeLock.released) return;
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (err) {
    // Denied or unsupported — the iPad's own Auto-Lock setting takes over.
    console.info('[idle] wake lock unavailable:', err.message);
  }
}

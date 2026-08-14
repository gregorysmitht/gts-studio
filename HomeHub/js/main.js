/* Boot. */

import { installIconDefs } from './ui/icons.js';
import { paintSky, drawStars } from './core/sky.js';
import { state, on, seedFirstRun } from './core/store.js';
import { live, startData, refresh } from './data/hub.js';
import { onNativeEvent } from './core/native.js';
import { mountTopbar } from './ui/topbar.js';
import { mountHome } from './ui/home.js';
import { startIdleWatch } from './core/idle.js';
import { startDaypart } from './core/daypart.js';
import { startMusic } from './data/music.js';
import { loadReminders, remindersAvailable } from './data/reminders.js';
import { mountMiniPlayer } from './ui/music-widget.js';
import { toast } from './core/dom.js';

function applyScale() {
  document.documentElement.style.setProperty('--scale', state.scale);
}

/** Repaint the sky from the current conditions. */
function refreshSky() {
  const now = live.weather?.current;
  paintSky(
    state.place,
    { condition: now?.condition ?? 'clear', cloudCover: now?.cloudCover ?? 0 },
    new Date()
  );
}

function boot() {
  installIconDefs();
  applyScale();
  seedFirstRun();

  startDaypart();
  refreshSky();
  drawStars();
  // The sun moves; repaint once a minute so dawn and dusk actually roll in.
  setInterval(refreshSky, 60e3);
  on('weather', refreshSky);
  on('place-changed', refreshSky);
  on('settings', applyScale);

  mountTopbar();
  mountHome();
  mountMiniPlayer();
  startData();
  startMusic();
  if (remindersAvailable()) {
    loadReminders();
    // The shell nudges the page the moment the Reminders database
    // changes under it — Siri, a phone across the house, a sync. The
    // interval stays as the fallback for a missed nudge.
    setInterval(loadReminders, 5 * 60e3);
    onNativeEvent('reminders', () => loadReminders());
  }
  onNativeEvent('calendar', () => refresh.calendar());
  // A wall iPad coming back from overnight idle should not spend its
  // first five minutes showing yesterday.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (remindersAvailable()) loadReminders();
    refresh.calendar();
  });
  startIdleWatch();

  registerServiceWorker();

  // Safari fires this when a PWA is re-shown from the app switcher.
  addEventListener('pageshow', (event) => { if (event.persisted) refreshSky(); });

  addEventListener('online', () => toast('Back online'));
  addEventListener('offline', () => toast('Offline — showing the last update', 'warn'));
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // file:// has no service worker scope; skip rather than throw.
  if (location.protocol === 'file:') return;
  addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.info('[main] service worker not registered:', err.message);
    });
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}

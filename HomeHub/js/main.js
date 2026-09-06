/* Boot. */

import { installIconDefs } from './ui/icons.js';
import { paintSky, drawStars } from './core/sky.js';
import { state, on, seedFirstRun, activeHomeStyle } from './core/store.js';
import { live, startData, refresh } from './data/hub.js';
import { onNativeEvent } from './core/native.js';
import { mountTopbar } from './ui/topbar.js';
import { mountHome } from './ui/home.js';
import { mountDepthHome } from './ui/depth-home.js';
import { mountJarvisHome } from './ui/jarvis-home.js';
import { startIdleWatch } from './core/idle.js';
import { startDaypart } from './core/daypart.js';
import { startMusic } from './data/music.js';
import { loadReminders, remindersAvailable } from './data/reminders.js';
import { mountMiniPlayer } from './ui/music-widget.js';
import { startIntentRouter } from './ui/intents.js';
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

  /* Three homes, one switch (Settings → Display). JARVIS is the Stark
     heads-up display; DEPTH is the volumetric stack from handoff 28a;
     classic is the widget grid. A style change reloads the page rather
     than remounting live — on a wall kiosk a reload is invisible, and
     it keeps every home free of teardown code. */
  const home = activeHomeStyle();
  if (home === 'classic') {
    mountTopbar();
    mountHome();
    mountMiniPlayer();
  } else if (home === 'depth') {
    document.body.classList.add('depth-home');
    mountDepthHome();
  } else {
    document.body.classList.add('jarvis-home');
    mountJarvisHome();
  }
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
  startIntentRouter();

  registerServiceWorker();

  // Safari fires this when a PWA is re-shown from the app switcher.
  addEventListener('pageshow', (event) => { if (event.persisted) refreshSky(); });

  addEventListener('online', () => toast('Back online'));
  addEventListener('offline', () => toast('Offline — showing the last update', 'warn'));
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  /* Only a real web origin wants the cache: file:// has no worker scope,
     and the iPad app serves the bundled files through its own URL scheme
     — offline by construction, and a stale-while-revalidate cache there
     would only ever hand a fresh build the previous launch's code. */
  if (!/^https?:$/.test(location.protocol)) return;
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

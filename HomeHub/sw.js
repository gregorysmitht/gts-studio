/* Service worker.

   Caches the app shell so the hub still comes up after a router reboot
   or a power cut, before any network is available. Data requests are
   deliberately never cached here — net.js already has a smarter
   stale-while-error policy that knows how old is too old for a
   forecast. */

const VERSION = 'homehub-v1';

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/icon.svg',
  './css/tokens.css',
  './css/base.css',
  './css/home.css',
  './css/panel.css',
  './css/weather.css',
  './css/radar.css',
  './css/calendar.css',
  './css/boards.css',
  './css/settings.css',
  './css/music.css',
  './js/main.js',
  './js/core/dom.js',
  './js/core/store.js',
  './js/core/time.js',
  './js/core/color.js',
  './js/core/solar.js',
  './js/core/sky.js',
  './js/core/net.js',
  './js/core/format.js',
  './js/core/panel.js',
  './js/core/idle.js',
  './js/core/native.js',
  './js/core/sheet.js',
  './js/core/palette.js',
  './js/core/imaging.js',
  './js/data/conditions.js',
  './js/data/weather.js',
  './js/data/airquality.js',
  './js/data/storms.js',
  './js/data/radar-source.js',
  './js/data/geocode.js',
  './js/data/ics.js',
  './js/data/calendar.js',
  './js/data/mock.js',
  './js/data/hub.js',
  './js/data/music.js',
  './js/data/reminders.js',
  './js/ui/icons.js',
  './js/ui/topbar.js',
  './js/ui/home.js',
  './js/ui/weather-widget.js',
  './js/ui/weather-panel.js',
  './js/ui/calendar-widget.js',
  './js/ui/calendar-panel.js',
  './js/ui/air-widget.js',
  './js/ui/charts.js',
  './js/ui/map.js',
  './js/ui/radar.js',
  './js/ui/lists.js',
  './js/ui/chores.js',
  './js/ui/ambient.js',
  './js/ui/settings.js',
  './js/ui/music-widget.js',
  './js/ui/music-panel.js',
  './js/ui/photo-grid.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      // addAll fails the whole install if one entry 404s; add individually
      // so a missing optional asset can't stop the shell from caching.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Same-origin only: never intercept weather, radar tiles or calendars.
  if (url.origin !== location.origin) return;
  if (url.pathname.includes('/.netlify/functions/')) return;

  /* Stale-while-revalidate: the hub paints instantly from cache, and the
     next launch picks up whatever the network returned in the background.
     A deploy therefore lands one reload later, which is the right trade
     for a display that must survive booting with no Wi-Fi. */
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(VERSION).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);

      return cached || network;
    })
  );
});

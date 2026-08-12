# HomeHub

A wall-mounted family home hub for an iPad. Weather, radar, and the family
calendar at a glance — every widget opens into the full thing when you tap it.

Built as a plain static web app: no build step, no framework, no runtime
dependencies. Add it to the iPad's Home Screen and it runs full screen like a
native app.

---

## What it does

**Home screen.** A big clock, the current conditions, the next six hours, a
five-day outlook, what's next on the calendar, air quality, the shopping list,
and today's chores — all readable from across a room.

**Tap anything to open it.**

| Widget | Opens |
| --- | --- |
| Weather | Today · Hourly · 10 Days · Radar · Alerts · Air |
| Calendar | Month · Week · Agenda, and a detail sheet for every event |
| Air & sun | AQI, UV, pollutants, pollen |
| Lists | Groceries, to-dos, anything you add |
| Chores | Today's board, all chores, family members |
| Music | Full-screen Now Playing · Browse and search *(native app only)* |

**The weather panel** answers the questions a family actually asks: *is it going
to rain, when, and how hard.* The home screen carries a one-line answer
("Storms 3:00 PM – 9:00 PM · 77% peak"); the Today tab expands it into a
24-hour chart of rain chance, storm risk, and temperature together.

**Radar** is a full pan/pinch/zoom map with roughly two hours of past scans plus
a half-hour forecast loop, National Weather Service watch and warning polygons
drawn on top, and active tropical systems plotted with category and distance.

**Alerts** are the real NWS products — severe thunderstorm, tornado, flood,
hurricane, heat — with the headline, the full text, and the "what to do"
instructions pulled out separately.

**Apple Music** appears as a slim bar across the foot of the hub whenever
something is playing, and nothing at all when the house is quiet — a permanent
tile would sit empty most of the day. Tap it and the album art fills the wall:
the cover is the composition, a blurred enlargement of it colours everything
behind, and the transport fades away after six untouched seconds so what's left
is just the record. Any touch brings the controls back. Browse searches the
catalog and your own playlists. This one needs the native shell, because
playback runs through the system player — what the wall starts also shows up in
Control Center and can play out to a HomePod.

**Ambient mode** fades into a slow full-screen photo slideshow after a few quiet
minutes. The photograph fills the wall and everything worth reading collects
into one frosted panel over it: the time and date, the temperature with today's
high and low, any warning in force, when rain or storms are expected, what is
left of today's schedule, and anything overdue. The idea is that nobody should
have to walk over and tap the screen to find out whether they need to leave.
Touch anywhere to come straight back.

Overnight the panel keeps the time and the weather and drops the rest — a
hallway at 3am has no use for a list of errands.

**Screen care.** That panel is also what protects the display. It drifts
continuously on two slow sine waves with coprime periods, changes corner every
few minutes, and every so often the whole screen rests: everything fades to
black for a few seconds bar one dim line of time, which lands somewhere
different each time so the only lit pixels are never the same twice. More rest
overnight, when there is nobody to interrupt. All of it is adjustable in
Settings → Photos → Screen care.

---

## Running it

It's static files. Any web server works:

```bash
cd HomeHub
python3 -m http.server 8000
# then open http://localhost:8000
```

### Deploying to Netlify (recommended)

The repo is already configured — `netlify.toml` sets the publish directory and
the functions directory.

1. In Netlify, **Add new site → Import an existing project**, and pick this repo.
2. Leave the build command empty. Publish directory: `.`
3. Deploy.

The one server-side piece is `netlify/functions/proxy.js`. Three upstreams can't
be called straight from a browser — `api.weather.gov` wants a descriptive
User-Agent, and `nhc.noaa.gov` and calendar feeds send no CORS headers — so
those go through it. Everything else is called directly from the iPad.

The app works without the function too: if the proxy isn't there, it falls back
to direct requests, and calendars are the only feature that needs it.

### Putting it on the iPad

1. Open the site in **Safari** (not Chrome — only Safari can install web apps).
2. Share → **Add to Home Screen**.
3. Launch it from that icon. It runs full screen with no browser chrome.
4. Settings → Accessibility → **Guided Access** locks the iPad to just this app,
   which is what you want on a wall.
5. In HomeHub's own Settings → Display, turn on **Keep the screen awake**.

---

## Setting it up

Everything is under the gear icon, top right.

### Location

Search for your town, or tap **Use this device** to take the iPad's location.
This drives the forecast, the radar centre, and sunrise/sunset.

### Calendars

Each person pastes their own private iCal (`.ics`) link, so everyone keeps using
whatever calendar app they already use. Give each one a name and a colour.

- **Google Calendar** — on a computer: Settings → click the calendar under
  "Settings for my calendars" → Integrate calendar → copy the
  **Secret address in iCal format**.
- **Apple / iCloud** — Calendar on a Mac: right-click the calendar → Share
  Calendar → tick Public Calendar → copy the `webcal://` link. Paste it as-is.
- **Outlook / Microsoft 365** — Outlook on the web: Settings → Calendar →
  Shared calendars → Publish a calendar → "Can view all details" → copy the ICS
  link.

Those links are secret — anyone with one can read that calendar. They're stored
only in this browser's local storage and are never sent anywhere except to
fetch the calendar itself.

Recurring events, all-day events, exceptions, and per-instance changes are all
handled. Feeds refresh every few minutes and are cached, so the calendar
survives a Wi-Fi outage.

### Family, lists, and chores

Add family members under Settings → Family (or the Chores panel). Chores are
assigned to a person and repeat daily, on weekdays, on chosen days, or once;
checking one off is recorded per date, so Tuesday's tick doesn't clear
Wednesday's, and streaks come for free.

A first launch seeds a couple of example people, chores, and grocery items so
the hub doesn't start out empty. Delete them and they stay deleted.

### Photos

Settings → Photos → **Add photos** picks any number of images at once from the
iPad. They appear straight away as a grid of thumbnails, numbered in the order
they will play. Touch and hold one to pick it up and drag it somewhere else in
the run; tap the × on a photo to remove just that one. (Arrow keys move the
focused photo too, for anyone the drag gesture does not work for.)

Each photo is stored twice: once resized to 2560px on the long edge, which is
as much as the iPad's screen can show, and once as a thumbnail. That is what
lets the grid and the slideshow list a large library without pulling several
gigabytes of original photographs into memory. Nothing is uploaded anywhere.

With no photos added, ambient mode shows the same panel over the live sky
instead.

---

## How it looks

The aim is a hotel lobby, not a control panel.

**The background is a real sky.** It's computed from the sun's actual position
for your coordinates — not the clock — so the hub turns gold when the light
outside does, goes deep indigo through twilight, and fills with stars at night.
Daytime runs from deep water at the zenith to a warm sand haze at the horizon.
Conditions wash over the top: overcast softens to linen, rain cools and darkens,
thunderstorms go warm charcoal. The washes are held deliberately light — bad
weather should make the room feel moodier, not drain the colour out of it.

**Two typefaces, and the pairing does the work.** An editorial serif carries
what you look at — the clock, the temperature, event titles, panel headings.
The sans carries what you read — data rows, labels, controls. Both resolve
natively on iPad (New York and SF Pro), so the whole typographic identity costs
zero bytes and never flashes an unstyled frame.

**Brass and sand, not electric blue.** One accent runs through the interface,
and even the alert colours are pulled back far enough to sit in the same room —
while still escalating unmistakably when a tornado warning lands.

**Cards are furniture, not chrome.** No outlines: depth comes from a wide soft
shadow, a hairline of light along the top edge, and a faint warm bloom in the
upper-left, the way real glass catches a room. The clock isn't in a box at all —
it sits directly on the sky above a brass hairline, because a lobby display
doesn't frame its own time.

Type is sized for distance: nothing below 15px ships, and the whole interface
scales from one slider in Settings → Display if the iPad hangs further away.
Portrait drops the interface a notch in density automatically so all six cards
still breathe.

---

## Where the data comes from

| Data | Source | Notes |
| --- | --- | --- |
| Forecast, alerts | [National Weather Service](https://www.weather.gov/documentation/services-web-api) | Free, no key, US only |
| Forecast (fallback / outside the US) | [Open-Meteo](https://open-meteo.com/) | Free, no key |
| Radar & satellite tiles | [RainViewer](https://www.rainviewer.com/api.html) | Free, no key |
| Basemap | [CARTO](https://carto.com/basemaps/) / OpenStreetMap | Attribution shown on the map |
| Next-hour precipitation | [Open-Meteo](https://open-meteo.com/) `minutely_15` | Free, no key |
| Air quality, UV, pollen | [Open-Meteo Air Quality](https://open-meteo.com/en/docs/air-quality-api) | Free, no key |
| Tropical systems | [National Hurricane Center](https://www.nhc.noaa.gov/) | `CurrentStorms.json` |
| Place search | [Open-Meteo Geocoding](https://open-meteo.com/en/docs/geocoding-api) | Free, no key |

No API keys, no accounts, no billing.

### Why not Apple WeatherKit?

It was considered and deliberately skipped. WeatherKit's Swift framework is
native-app only; the REST API is open to anyone, but it needs an Apple Developer
Program membership (**$99/year**) and a private key that must be kept off the
device — so every request has to be signed by a server function. That part is
buildable here, since the proxy function already exists.

The problem is that it doesn't buy much. WeatherKit has no radar tiles, so radar
would still come from RainViewer. Its alerts are re-published from the same
National Weather Service feed the hub already reads directly. Its one genuine
advantage is minute-level precipitation nowcasting — and the hub now approximates
that free from Open-Meteo's 15-minute grid (see "Rain starting in about 20 min"
on the weather card) plus RainViewer's half-hour forecast loop on the radar.

If you ever want it anyway — global coverage outside the US is the strongest
argument — it slots in as another source in `js/data/`, with a token-signing
function alongside `proxy.js`.

### Running as a native iPad app

`native/` holds a thin Swift shell that hosts this same web UI in a
`WKWebView` and adds the four things a browser cannot have: the iPad's
own Calendar app via EventKit, WeatherKit, real panel brightness at
night, and origin-free networking that removes the need for the proxy
function. Every line of UI code is shared — in Safari the same paths
report "unavailable" and the ICS/NWS sources take over.

See `native/README.md` for the build. Two things worth knowing up front:
it needs a Mac and the $99/year Apple Developer Program (free
provisioning profiles expire weekly, which is unworkable for a wall),
and the Swift has never been compiled — it was written without access to
Xcode. The *bridge contract* is tested on every change though:
`tools/mock-native.js` fakes the bridge in a browser so all the native
JavaScript paths run without a Mac.

### What the iPad itself can provide

Safari gives a web app much less hardware access than a native app. The useful
things are already wired up:

| On-device | Used for | Status |
| --- | --- | --- |
| Geolocation | "Use this device" in Settings → Location | ✅ in use |
| Screen Wake Lock | Keeping the display awake on the wall | ✅ in use |
| Time zone + locale (`Intl`) | Clock format, week start, date wording | ✅ in use |
| Photo picker + IndexedDB | Ambient slideshow, stored locally | ✅ in use |
| Canvas + `createImageBitmap` | Resizing photos on the way in | ✅ in use |
| `prefers-reduced-motion` | Honouring the accessibility setting | ✅ in use |

And what simply isn't available to any web page on iPadOS:

- **The Calendar app.** There is no web API to read local iCloud calendars. The
  ICS links are the supported route, which is why the hub uses them.
- **Ambient light sensor.** Not implemented in Safari, so automatic brightness
  isn't possible; night dimming runs on a schedule instead.
- **Battery status, network type, Bluetooth, NFC, contacts.** All unavailable.
- **HomeKit and HealthKit.** Native frameworks only.

**Two honest limitations:**

- **Pollen** comes from Open-Meteo's CAMS model, which only covers **Europe**.
  Outside Europe those fields come back empty; the Air tab says so plainly and
  shows the pollutants instead of empty rows.
- **Live lightning strikes** aren't available from any free, reliable feed.
  What the hub shows instead is genuine NWS thunderstorm data: per-hour storm
  probability, the NWS lightning-activity-level grid, severe thunderstorm and
  tornado warnings with their polygons, and radar intensity. If you ever want
  real strike plotting, that needs a paid feed (Vaisala, Earth Networks) and
  would slot into `js/data/` as another source.

### Demo data

The hub ships with generated sample weather and a sample family calendar, so it
looks right the moment you open it and before anything is configured. A **Demo
data** pill appears whenever any of it is on screen. Once real sources are
connected, generated data is only used if a source can't be reached — and you
can force it always on or always off under Settings → Data.

---

## Layout of the code

```
index.html              shell: sky layers, hub, panel host, ambient, dimmer
manifest.webmanifest    PWA manifest
sw.js                   service worker — caches the shell so it boots offline
netlify.toml            publish + functions config
netlify/functions/
  proxy.js              read-only fetch proxy with SSRF guards

css/
  tokens.css            design tokens: scale, type ramp, glass, motion
  base.css              reset, the sky, shared primitives
  home.css              top bar + widget grid (landscape / portrait / phone)
  panel.css             expanding panels and the segmented control
  weather.css  radar.css  calendar.css  boards.css  settings.css
  music.css             mini player + full-screen Now Playing

js/
  main.js               boot
  core/
    dom.js              h() and friends
    store.js            persisted state + pub/sub + photo storage
    time.js             date formatting and day buckets
    color.js            Oklab interpolation
    solar.js            sun position, sunrise/sunset, moon phase
    sky.js              the living background
    net.js              fetch with retry, caching, stale-while-error, polling
    format.js           units and display formatting
    imaging.js          resizing and thumbnailing photos on the way in
    panel.js            expanding panel system
    idle.js             wake lock, night dimming, hub pixel shift, ambient trigger
    native.js           the iPad bridge — capabilities, calls, pushed events
    sheet.js            modal sheets, in their own layer above any panel
    palette.js          every data-driven colour: severity, temperature, radar
  data/
    conditions.js       one condition vocabulary for every source
    weather.js  airquality.js  storms.js  radar-source.js  geocode.js
    ics.js              iCalendar parser incl. recurrence rules
    calendar.js         multi-feed adapter + queries
    mock.js             generated demo data
    hub.js              the live data store — the only thing that fetches
    music.js            Apple Music state, transport, and local playhead
  ui/
    icons.js  topbar.js  home.js  charts.js
    weather-widget.js  weather-panel.js
    calendar-widget.js calendar-panel.js
    air-widget.js  map.js  radar.js
    lists.js  chores.js  settings.js
    ambient.js         the screensaver, its info panel, and screen care
    photo-grid.js      the photo library: thumbnails, reorder, delete
    music-widget.js    the mini player bar
    music-panel.js     Now Playing + Browse

native/                 the iPad app — a WKWebView shell around all of the above
tools/
  bundle.js             rolls the whole app into one HTML file
  mock-native.js        a fake bridge, so native paths run in a browser
```

A few decisions worth knowing about:

- **No dependencies.** The map is a small purpose-built Web Mercator canvas
  renderer (`js/ui/map.js`, ~400 lines) rather than Leaflet, so a wall display
  with flaky Wi-Fi never waits on a CDN and the map matches the rest of the
  design.
- **`js/data/hub.js` is the only module that fetches.** Views read from `live`
  and re-render when their topic fires.
- **Calendars go through an adapter.** ICS is the only source today; adding
  Google OAuth later means implementing one `fetchFeed` and nothing above it
  changes.
- **The native bridge is strictly additive.** Every call in `js/core/native.js`
  reports "unavailable" in Safari and the web path takes over, so the same `js/`
  runs in both places. `tools/mock-native.js` fakes the bridge well enough to
  drive all of it in a plain browser.
- **The music playhead is extrapolated locally.** The bridge reports a position
  on each state change and `livePosition()` advances it from there, so the
  scrubber runs at 60fps without asking native sixty times a second.
- **Everything stays on the device.** Settings, lists, chores, and photos live
  in localStorage and IndexedDB. There is no backend and no account.

---

## Ideas worth adding later

- Sync lists and chores across devices (Netlify Blobs would do it without a
  server)
- A school-day / trash-day countdown strip
- Meal plan for the week
- Live transit or commute times
- HomeKit or smart-home tiles
- Real lightning strike plotting, if a feed is available

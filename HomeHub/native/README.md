# HomeHub for iPad — native shell

A thin Swift app that hosts the same web UI in a `WKWebView` and hands it
five things a browser can't have:

| | What it unlocks |
| --- | --- |
| **EventKit** | The iPad's own Calendar app. No secret links to paste, no publishing — anything the family adds on their phones shows up here. |
| **WeatherKit** | Apple's global forecast, included with the developer membership this app needs anyway. |
| **MusicKit** | Apple Music through the *system* player, so what the wall starts also appears in Control Center and can play out to a HomePod. |
| **`UIScreen.brightness`** | Night mode dims the *panel*. The browser build can only lay a black layer over the page, which leaves the backlight on and reads grey in a dark hallway. |
| **`URLSession`** | Requests with no origin, so no CORS — the Netlify proxy function isn't needed at all. |

Everything is additive. The same `js/` runs unchanged in Safari, where
each of these quietly reports "unavailable" and the existing ICS/NWS
paths take over.

---

## ⚠️ Read this first

**These Swift files have never been compiled.** They were written without
access to macOS or Xcode, so treat this as a careful first draft rather
than a tested build. The structure and the bridge contract are sound —
the contract is exercised on every commit by `tools/mock-native.js`,
which fakes the bridge in a browser and drives the real JavaScript
against it — but expect to fix some Swift.

The likeliest places to need a touch-up, in order:

1. **`WeatherBridge.alert(_:)`** — `WeatherAlert`'s property names shift
   between WeatherKit releases. If it doesn't compile, that's the first
   place to look; the fix is usually renaming one or two fields.
2. **`.onChange(of:)` in `HomeHubApp.swift`** — the single-parameter form
   is deprecated on iOS 17 (a warning, not an error).
3. **`MusicBridge.startObserving()`** — observing
   `ApplicationMusicPlayer.state` via `objectWillChange.values` is
   correct but easy to get wrong. If pushes never arrive, everything
   still works: `js/data/music.js` polls every 5 seconds as a backstop,
   so the symptom is laggy updates when someone skips a track from their
   phone, not a broken player.
4. **`ApplicationMusicPlayer.Queue` construction** in `playItem` —
   `Queue(for:)`, `Queue(album:)` and `Queue(playlist:)` have moved
   between MusicKit releases more than anything else here.
5. **Deployment target** — set to iOS 16.0. WeatherKit needs 16+;
   MusicKit's `ApplicationMusicPlayer` needs 15+;
   `requestFullAccessToEvents` is already guarded for 17+.

Two whole classes of bug have already been swept out, so don't go
looking for them: every value that crosses into JavaScript is an
explicit JSON type (`String(describing:)` on ids, `?? NSNull()` rather
than a boxed `Optional` — `JSONSerialization` rejects those and the
reply or push vanishes silently), and `playItem` is written out
longhand rather than as one generic constrained to both
`MusicCatalogResourceRequestable` and `MusicLibraryRequestable`.

---

## What you need

- A **Mac with Xcode 15+**. (Or **Swift Playgrounds on the iPad itself** —
  it can build and install an app without a Mac. You'd recreate the file
  list by hand, but for a project this small that's genuinely viable.)
- An **Apple Developer Program membership, $99/year**. Not optional:
  free provisioning profiles expire after **7 days**, so a wall display
  would need re-plugging every week. Paid profiles last a year.
- WeatherKit **and MusicKit** enabled for your App ID (below).
- An **Apple Music subscription** on the iPad's Apple ID, for the music
  feature specifically. Without one, MusicKit authorises but the catalog
  is unavailable; the hub simply never shows the mini player.

---

## Build it

### 1. Copy the web app in

```bash
cd native
./sync-web.sh
```

This copies `index.html`, `css/`, `js/` and `assets/` into
`HomeHub/Web/`, which the app serves verbatim. **Re-run it after any web
change** — it's the only build step in the project.

### 2. Generate the Xcode project

```bash
brew install xcodegen
xcodegen          # from native/
open HomeHub.xcodeproj
```

Prefer not to install XcodeGen? Create it by hand instead:

1. Xcode → **File → New → Project → iOS → App**
2. Name `HomeHub`, interface **SwiftUI**, language **Swift**
3. Delete the generated `ContentView.swift` and `HomeHubApp.swift`
4. Drag in every `.swift` file from `native/HomeHub/`
5. Drag in `HomeHub/Web` and choose **Create folder references** (blue
   folder, not yellow group — the directory structure has to survive)
6. Replace the generated `Info.plist` with `native/HomeHub/Info.plist`
7. Target → **Signing & Capabilities** → your team, then **+ Capability
   → WeatherKit**
8. Target → **General** → Supported Destinations: **iPad** only
9. Deployment target: **iOS 16.0**

### 3. Turn on WeatherKit and MusicKit

1. [developer.apple.com](https://developer.apple.com/account) →
   **Certificates, Identifiers & Profiles → Identifiers**
2. Select (or create) the App ID matching `studio.gts.homehub`
3. Tick **WeatherKit** *and* **MusicKit**, save
4. Back in Xcode, Signing & Capabilities → **+ Capability → WeatherKit**

MusicKit needs no entitlement file entry and no capability row in Xcode —
ticking it on the App ID is the whole of it. What it *does* need is
`NSAppleMusicUsageDescription` in `Info.plist` (already there) and the
`audio` background mode, so music keeps playing when the hub isn't
frontmost.

It can take up to 30 minutes for a newly enabled App ID to start serving
weather. Until then `WeatherBridge` throws and the hub falls back to the
National Weather Service — which is the designed behaviour, not a bug.

### 4. Run it

Plug in the iPad, pick it as the destination, hit ⌘R. On first launch,
open **Settings → Device** in the hub and tap **Connect** to grant
calendar access.

---

## Locking it to the wall

Neither native nor web can truly self-kiosk on iPadOS without supervision.

- **Guided Access** (Settings → Accessibility → Guided Access) is the
  easy option: triple-click the top button to lock the iPad to HomeHub.
  It does not survive a reboot.
- **Autonomous Single App Mode** does survive a reboot and auto-launches,
  but requires supervising the iPad with Apple Configurator and an MDM
  profile. Worth it if the iPad is permanently mounted.

Also turn off Auto-Lock (Settings → Display & Brightness → Auto-Lock →
Never) as a belt-and-braces measure alongside the app's idle-timer
control.

---

## How the bridge works

Swift injects `window.HomeHubNative` before any page script runs:

```js
window.HomeHubNative = {
  version: 1,
  capabilities: ['calendar', 'weather', 'display', 'fetch', 'music'],
  call(method, params) { /* → Promise */ },
  onEvent(topic, payload) { /* assigned by js/core/native.js */ }
}
```

`call` is backed by `WKScriptMessageHandlerWithReply`, so it's a plain
`await` on both sides — no callback ids, no correlation table.
`js/core/native.js` wraps it in typed helpers; `Bridge.swift` routes
methods to the five small classes beside it.

`onEvent` is the one channel that runs the other way. Almost everything
here is the page asking a question, but music changes on its own — a
track ends, someone skips from their phone — so `MusicBridge` observes
`ApplicationMusicPlayer` and `Bridge.push` calls into the page via
`evaluateJavaScript`. The page listens with `onNativeEvent('music', fn)`.

**Adding a method** means two edits: a `case` in `Bridge.dispatch`, and a
wrapper in `js/core/native.js`. If it should be optional, add a
capability string so the web side can check `nativeHas()` first.

### Testing the bridge without a Mac

```html
<script src="tools/mock-native.js"></script>
<script type="module" src="js/main.js"></script>
```

`tools/mock-native.js` implements the same contract with fabricated
calendars, weather and music, so every native path — device calendars,
WeatherKit, brightness, native fetch, Apple Music — can be driven in a
normal browser. Album art is generated as SVG data URIs, and the fake
player pushes on every state change exactly as `MusicBridge` does, so
the push path is exercised too. Keep its shapes identical to what Swift
returns; if they drift, the mock is the thing that catches it.

---

## File map

```
native/
├── project.yml                XcodeGen spec
├── sync-web.sh                copies the web app into the bundle
└── HomeHub/
    ├── HomeHubApp.swift       @main; restores brightness on background
    ├── HubWebView.swift       WKWebView + custom-scheme file server
    ├── Bridge.swift           method router + injected JS
    ├── CalendarBridge.swift   EventKit → the hub's event shape
    ├── WeatherBridge.swift    WeatherKit → the hub's weather shape
    ├── MusicBridge.swift      MusicKit playback, search, and push
    ├── DisplayBridge.swift    brightness + idle timer
    ├── NetBridge.swift        URLSession fetch (replaces the proxy)
    ├── Assets.xcassets       app icon + the launch-screen colour
    ├── Info.plist
    ├── HomeHub.entitlements
    └── Web/                   generated by sync-web.sh — not committed
```

### Why a custom URL scheme

The bundle is served over `homehub://app/` rather than `file://`. A file
origin is opaque, which would block the map's tile requests; a custom
scheme gives the page a real origin. Data still travels through
`NetBridge`, but tiles load directly as images — the map draws them
without ever reading their pixels, so they need no CORS.

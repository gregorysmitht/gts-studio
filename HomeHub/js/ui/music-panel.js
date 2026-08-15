/* Full-screen Now Playing, and the browse/search view behind it.

   The "Immersive" set (handoff 18a/18b): the album's light fills the
   room. A warm glow derived from the cover sits behind everything;
   controls put the lit art card left with the full hierarchy right and
   a glass queue bar at the foot. Left alone while playing, the same
   screen becomes the ambient state: the art floats centered in its own
   glow with a pulsing EQ, a clock in the corner, a hairline of progress
   along the bottom edge — the point of a wall display is the art, not
   the buttons. Any touch brings the controls back. */

import { h, fill, $, toast } from '../core/dom.js';
import { clockParts, clockTime, fullDate } from '../core/time.js';
import { temp } from '../core/format.js';
import { live } from '../data/hub.js';
import { eventsOnDay } from '../data/calendar.js';
import { icon } from './icons.js';
import { openPanel, closePanel, onPanelClose, onTabClose, setPanelTab, activeTabId } from '../core/panel.js';
import { enterAmbient } from './ambient.js';
import { setBrightness, getBrightness } from '../core/native.js';
import { on } from '../core/store.js';
import {
  player, livePosition, formatTime, hasTrack,
  togglePlay, next, previous, seek, setShuffle, setRepeat,
  search, playlists, recentlyPlayed, playItem,
  musicAuthStatus, requestMusicAccess, musicBlockedReason,
} from '../data/music.js';

/** How long the controls stay up after the last touch — ~30s per the
    handoff. Probes shorten it through the global rather than waiting
    half a minute to watch one rest. */
const FADE_AFTER = globalThis.__NP_FADE_AFTER ?? 30000;

let musicSubscribed = false;   // one panel, one music listener

export function openMusicPanel({ source, tab = 'playing' } = {}) {
  openPanel({
    id: 'music',
    title: 'Music',
    source,
    tabs: [
      { id: 'playing', label: 'Now Playing', render: renderNowPlaying, flush: true },
      { id: 'browse', label: 'Browse', render: renderBrowse, flush: true },
    ],
    /* 17c header: the Apple Music status dot lives up in the chrome. */
    actions: [connectionStatus()],
  }).then(() => {
    /* Even when the panel was already open: the music saver may be
       steering a panel that is sitting on Browse. */
    if (activeTabId() !== tab) setPanelTab(tab);

    /* Steering an already-open panel must not stack a second music
       subscription on it — one panel, one listener. */
    if (musicSubscribed) return;
    musicSubscribed = true;

    let lastState = player.state;
    const stop = on('music', () => {
      /* A track appearing on a silent screen (or the queue emptying
         under a playing one) swaps the whole tab between the stage and
         the empty state. Everything else is a patch in place: rebuilding
         the tab would restart the artwork's fade-in every few seconds
         and interrupt anyone scrolling the browse list. */
      if (activeTabId() === 'playing'
          && (hasTrack() ? !!$('.panel .np-empty') : !!$('.panel .np-stage'))) {
        setPanelTab('playing');
      } else {
        paintTransport();
        paintTrack();
        paintQueue();
      }
      paintBrowseBar();
      /* On a play⇄pause flip only — track changes must not disturb the
         ambient screen. Pausing exits ambient (18d), wherever the pause
         came from; resuming re-arms the way back into it. */
      if (player.state !== lastState) {
        lastState = player.state;
        wakeNow?.();
      }
    });
    onPanelClose(() => { musicSubscribed = false; stop(); });
  });
}

/* ── Now Playing ──────────────────────────────────────────── */

let fadeTimer = null;      // controls → ambient
let settleTimer = null;    // the music saver's fast path into ambient
let rafId = null;
let scrubbing = false;     // a finger on the scrubber; the loop holds off
let wakeNow = null;        // armFade's wake, reachable by the music push
let restNow = null;        // armFade's rest, reachable by the music saver

/* 18b's ☾: the screen drops to ~25% for the night; any tap restores.
   Dimming is a lights-out, not an exit — the ambient screen stays. The
   CSS veil carries the effect where there is no display bridge. */
const nightDim = { active: false, prev: 1 };

async function setNightDim(on) {
  if (on === nightDim.active) return;
  nightDim.active = on;
  $('.np-stage')?.classList.toggle('night-dim', on);
  try {
    if (on) {
      nightDim.prev = (await getBrightness()) ?? 1;
      await setBrightness(0.25);
    } else {
      await setBrightness(nightDim.prev);
    }
  } catch { /* plain web view — the veil is the whole effect */ }
}

function renderNowPlaying(body, panel) {
  if (!hasTrack()) {
    panel?.classList.remove('resting');
    return fill(body, emptyState());
  }

  /* 18a and 18b in one DOM; `.panel.resting` is the mode switch. The
     panel's own header IS the 18a header row (back · Music · tabs), so
     it stays up in the controls and folds only for the ambient state. */
  const stage = h('div.np-stage',
    /* The warm glow, twice: JS alternates .current between songs so the
       room's light crossfades — background-image itself cannot animate.
       The cool counter-glow is part of the stage's own ground. */
    h('div.np-glow'),
    h('div.np-glow'),
    h('div.np-body',
      h('div.np-art-wrap', h('img.np-art', { alt: '' })),
      h('div.np-right',
        h('div.np-meta',
          h('div.np-kicker'),
          h('div.np-title'),
          /* Artist and record as separate spans: the controls show the
             name alone; the record joins it in the ambient caption. */
          h('div.np-artist',
            h('span.np-artist-name'),
            h('span.np-artist-dot', '·'),
            h('span.np-album-name'),
          ),
        ),
        h('div.np-scrub',
          h('div.np-track',
            h('div.np-track-fill'),
            h('div.np-track-knob'),
          ),
          h('div.np-times',
            h('span.np-elapsed.num', '0:00'),
            h('span.np-remaining.num', '−0:00'),
          ),
        ),
        h('div.np-buttons',
          h('button.np-btn.ghost-btn.np-shuffle', {
            onclick: () => setShuffle(!player.shuffle).catch(reportError),
            'aria-label': 'Shuffle',
          }, icon('shuffle', { size: 20 })),
          h('button.np-btn.ring-btn', {
            onclick: () => previous().catch(reportError),
            'aria-label': 'Previous track',
          }, icon('skipBack', { size: 24 })),
          h('button.np-btn.np-play', {
            onclick: () => togglePlay().catch(reportError),
            'aria-label': 'Play or pause',
          }),
          h('button.np-btn.ring-btn', {
            onclick: () => next().catch(reportError),
            'aria-label': 'Next track',
          }, icon('skipForward', { size: 24 })),
          h('button.np-btn.ghost-btn.np-repeat', {
            onclick: () => setRepeat(nextRepeat(player.repeat)).catch(reportError),
            'aria-label': 'Repeat',
          }, icon('refresh', { size: 20 })),
        ),
        /* 18b: the pulse under the caption — ambient-only, dancing only
           while something actually plays (frozen low when paused). */
        h('div.np-eq', h('span'), h('span'), h('span'), h('span')),
      ),
    ),
    /* A stable slot at the stage's foot: the 18a glass queue bar is
       repainted on every push, so the rows move with the track. */
    h('div.np-queue-host'),
    /* 18b: a hairline of progress along the very bottom edge. */
    h('div.np-edge', h('div.np-edge-fill')),
    /* Only lit while ambient: the room's clock, so the floating-art
       screen still answers the wall's first question. */
    h('div.np-clock',
      h('div.np-clock-time.num'),
      h('div.np-clock-date'),
    ),
    /* The way across to the photo screensaver, for when the room would
       rather look at the holiday than the record. Top left — bottom
       right belongs to the night-dim. */
    h('button.np-saver-btn.no-expand', {
      onclick: () => { closePanel().then(() => enterAmbient()); },
      'aria-label': 'Switch to the photo screensaver',
    }, icon('photo', { size: 20 })),
    /* 18b ☾: lights out for the night; any tap restores. */
    h('button.np-dim-btn.no-expand', {
      onclick: () => { setNightDim(true); },
      'aria-label': 'Dim the screen for the night',
    }, icon('moon', { size: 18 })),
  );

  fill(body, stage);
  armScrub(stage.querySelector('.np-track'));
  paintTrack();
  paintTransport();
  paintQueue();
  paintNpClock();
  startScrubLoop();
  armFade(panel ?? stage);

  onTabClose(() => {
    cancelAnimationFrame(rafId);
    clearTimeout(fadeTimer);
    clearTimeout(settleTimer);
    rafId = null;
    scrubbing = false;
    /* Crossing away while dimmed must not strand a 25% screen. */
    setNightDim(false);
  });
}

const nextRepeat = (mode) => ({ off: 'all', all: 'one', one: 'off' }[mode] ?? 'off');

/* The 18a queue: one glass bar along the stage's foot — "UP NEXT", the
   next two tracks inline, the queue count off to the right. Repainted
   on every push, so the rows move along when the track does. Only when
   the bridge actually reports upcoming tracks. */
function paintQueue() {
  const host = $('.np-queue-host');
  if (!host) return;
  const queue = player.queue ?? [];
  if (!queue.length) return fill(host);
  fill(host, h('div.np-queue',
    h('span.np-queue-label', 'Up next'),
    ...queue.slice(0, 2).map((track) => h('div.np-queue-item',
      h('div.np-queue-art', artOrNote(track.artworkUrl, 18, `queued "${track.title}"`)),
      h('div.np-queue-meta',
        h('div.np-queue-title', track.title),
        h('div.np-queue-artist', track.subtitle ?? track.artist ?? ''),
      ),
    )),
    h('span.np-queue-count',
      `Queue · ${queue.length} track${queue.length === 1 ? '' : 's'} ›`),
  ));
}

/* The ambient clock: "9:12 AM" over "FRIDAY, AUGUST 14 · 82°" (18b).
   Cheap to keep honest: the scrub loop already runs once a second and
   calls this when the minute turns. */
function paintNpClock() {
  const time = $('.np-clock-time');
  if (!time) return;
  const now = new Date();
  const { hour, minute, period } = clockParts(now);
  fill(time, `${hour}:${minute}`, period ? h('span.np-clock-ampm', ` ${period}`) : null);

  const bits = [fullDate(now)];
  const t = live.weather?.current?.temp;
  if (t != null) bits.push(temp(t));
  fill($('.np-clock-date'), bits.join(' · '));
}

function reportError(err) {
  toast(err.message, 'warn');
}

/** Artwork and text only change between tracks, so they repaint separately. */
function paintTrack() {
  const stage = $('.np-stage');
  const art = $('.np-art');
  if (!stage || !art || !player.track) return;
  const { id, artworkUrl, title, artist, album } = player.track;

  /* Track identity gates the choreography. A manual skip delivers the
     same snapshot twice (command reply + observer push), and catalog
     artwork lands late on the same track — neither may re-run a swap. */
  const sameTrack = stage.dataset.trackId === id;
  stage.dataset.trackId = id;

  if (artworkUrl && art.dataset.src !== artworkUrl) {
    if (!sameTrack && art.classList.contains('loaded')) {
      crossfadeArt(art, artworkUrl);
    } else {
      /* First paint, or the cover arriving a beat late for the track
         already showing: the plain fade-in is right, nothing outgoing. */
      art.dataset.src = artworkUrl;
      art.classList.remove('loaded');
      art.onload = () => art.classList.add('loaded');
      // Say so rather than leaving an empty square: a cover that arrives
      // and fails to fetch looks exactly like one that never arrived.
      art.onerror = () => console.warn(`[music] now-playing artwork failed: ${artworkUrl}`);
      art.src = artworkUrl;
    }
    assessArt(stage, artworkUrl);
  } else if (!artworkUrl) {
    console.info(`[music] no artwork for "${title}"`);
  }

  /* Caption lines trade places with a small staggered rise. Unchanged
     text (the second snapshot of a skip) falls straight through. */
  swapText($('.np-kicker'), ['Apple Music', album].filter(Boolean).join(' · '), 0);
  swapText($('.np-title'), title ?? '', 40);
  swapText($('.np-artist-name'), artist ?? '', 100);
  swapText($('.np-album-name'), album ?? '', 140);
  /* No record name → no dangling dot in the ambient caption. */
  $('.np-artist')?.classList.toggle('no-album', !album);
}

/* ── Song-change choreography ─────────────────────────────── */

/** The old cover lifts away over the new one. The incoming image is
    decoded off-screen first, so the striped placeholder never flashes
    mid-song. */
function crossfadeArt(art, url) {
  const wrap = art.parentElement;
  if (!wrap) return;
  const incoming = new Image();
  incoming.onload = () => {
    if (!art.isConnected || art.dataset.src === url) return;
    const ghost = art.cloneNode();          // keeps the old src + .loaded
    ghost.classList.add('outgoing');
    wrap.appendChild(ghost);

    art.dataset.src = url;
    art.classList.remove('loaded');
    art.onload = null;
    art.src = url;                          // already decoded — instant

    requestAnimationFrame(() => {
      ghost.classList.add('gone');
      art.classList.add('loaded');
    });
    const drop = () => ghost.remove();
    ghost.addEventListener('transitionend', drop, { once: true });
    setTimeout(drop, 1100);                 // belt for a missed event
  };
  incoming.onerror = () => console.warn(`[music] now-playing artwork failed: ${url}`);
  incoming.src = url;
}

/** The album's light: sample the cover small, average it, and hand the
    colour to the warm glow and the art card's halo. Fire-and-forget; a
    cross-origin cover that taints the canvas keeps the reference hue. */
function assessArt(stage, url) {
  stage.dataset.trackArt = url;
  const probe = new Image();
  probe.crossOrigin = 'anonymous';
  probe.onload = () => {
    let r = 0, g = 0, b = 0;
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 8;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(probe, 0, 0, 8, 8);
      const px = ctx.getImageData(0, 0, 8, 8).data;
      for (let k = 0; k < px.length; k += 4) { r += px[k]; g += px[k + 1]; b += px[k + 2]; }
      const n = px.length / 4;
      r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
    } catch { return; }
    /* Only if this is still the cover on the wall — the lookup is a
       fetch away, and the room may have skipped on. */
    if (stage.isConnected && stage.dataset.trackArt === url) {
      stage.style.setProperty('--np-halo', `rgba(${r}, ${g}, ${b}, 0.12)`);
      swapGlow(stage, `rgba(${r}, ${g}, ${b}, 0.18)`);
    }
  };
  probe.src = url;
}

/** Alternate the two warm glow layers so a track change crossfades the
    room's light (~800ms, per the handoff) instead of hard-cutting —
    background-image itself cannot animate. */
function swapGlow(stage, color) {
  const layers = [...stage.querySelectorAll('.np-glow')];
  if (!layers.length) return;
  const glow = `radial-gradient(1100px 700px at 30% 40%, ${color}, transparent 60%)`;
  const current = layers.find((l) => l.classList.contains('current')) ?? null;
  if (current?.dataset.color === color) return;
  if (!current) {
    layers[0].style.backgroundImage = glow;
    layers[0].dataset.color = color;
    layers[0].classList.add('current');
    return;
  }
  const idle = layers.find((l) => l !== current) ?? current;
  idle.style.backgroundImage = glow;
  idle.dataset.color = color;
  idle.classList.add('current');
  current.classList.remove('current');
}

/**
 * Ease one line of text out, change it, ease it back in — skipped
 * entirely when the text is already right, and on first paint.
 * Shared with the mini pill.
 */
export function swapText(el, text, delay = 0) {
  if (!el || el.textContent === text) return;
  if (!el.textContent.trim()) { fill(el, text); return; }

  el.style.animationDelay = `${delay}ms`;
  el.classList.remove('swap-in', 'swap-out');
  void el.offsetWidth;                       // restart mid-swap cleanly
  el.classList.add('swap-out');

  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    fill(el, text);
    el.classList.remove('swap-out');
    void el.offsetWidth;
    el.classList.add('swap-in');
    el.addEventListener('animationend', () => el.classList.remove('swap-in'), { once: true });
  };
  el.addEventListener('animationend', commit, { once: true });
  /* Just past the out animation: a missed animationend (restarted swap,
     hidden tab) may only delay the retext by a frame or two, never let
     stale words sit. Reduced motion commits at ~1ms via the event. */
  setTimeout(commit, 240 + delay);
}

function paintTransport() {
  const playBtn = $('.np-play');
  if (playBtn) {
    fill(playBtn, icon(player.state === 'playing' ? 'pause' : 'play', { size: 44 }));
  }
  /* The 18b EQ only dances while music actually plays. */
  $('.np-stage')?.classList.toggle('is-playing', player.state === 'playing');
  $('.np-shuffle')?.classList.toggle('on', player.shuffle);
  const repeatBtn = $('.np-repeat');
  if (repeatBtn) {
    repeatBtn.classList.toggle('on', player.repeat !== 'off');
    repeatBtn.dataset.mode = player.repeat;
  }
  const miniPlay = $('.mini-play');
  if (miniPlay) {
    fill(miniPlay, icon(player.state === 'playing' ? 'pause' : 'play', { size: 26 }));
  }
}

/* The browse foot bar (17c), kept honest without rebuilding the tab.
   It lives in a stable host so it can appear the moment music starts
   anywhere and retreat when the queue empties — the mosaic keeps the
   room (the host simply collapses). */
function paintBrowseBar() {
  const host = $('.browse-now-host');
  if (!host) return;
  if (!hasTrack()) return fill(host);

  let bar = host.querySelector('.browse-now');
  if (!bar) {
    bar = h('div.browse-now.tappable', {
      onclick: () => setPanelTab('playing'),
      role: 'button',
      tabindex: 0,
      'aria-label': 'Open Now Playing',
    },
      h('div.browse-now-art'),
      h('div.browse-now-meta',
        h('span.browse-now-title'),
        h('span.browse-now-artist'),
      ),
      h('span.browse-now-time.num'),
      /* The one control that acts in place — everything else on the bar
         is a doorway to the full player. */
      h('button.browse-now-state.no-expand', {
        onclick: (event) => { event.stopPropagation(); togglePlay().catch(reportError); },
        'aria-label': 'Play or pause',
      }),
    );
    fill(host, bar);
  }

  const t = player.track;
  const art = bar.querySelector('.browse-now-art');
  if (art.dataset.src !== (t.artworkUrl ?? '')) {
    art.dataset.src = t.artworkUrl ?? '';
    fill(art, artOrNote(t.artworkUrl, 16, `"${t.title}"`));
  }
  swapText(bar.querySelector('.browse-now-title'), t.title ?? '');
  fill(bar.querySelector('.browse-now-artist'), t.artist ? ` — ${t.artist}` : '');
  fill(bar.querySelector('.browse-now-state'),
    icon(player.state === 'playing' ? 'pause' : 'play', { size: 16 }));
  const remaining = bar.querySelector('.browse-now-time');
  const duration = t.duration ?? 0;
  if (duration) fill(remaining, `−${formatTime(Math.max(0, duration - livePosition()))}`);

  /* The big Continue tile mirrors the deck while it is on screen. */
  const contSub = $('.mosaic-continue-sub');
  if (contSub?.dataset.live === '1') {
    fill(contSub, [t.artist, player.state === 'playing' ? 'Playing now' : 'Paused']
      .filter(Boolean).join(' · '));
  }
}

/** Advance the scrubber locally rather than polling the bridge. */
function startScrubLoop() {
  cancelAnimationFrame(rafId);

  /* Looked up once, not four times a frame. At 60fps that was 240
     querySelector calls a second for the lifetime of the screen, on a
     device that is meant to sit on a wall all day. */
  const bar = $('.np-track-fill');
  const knob = $('.np-track-knob');
  const edgeFill = $('.np-edge-fill');
  const elapsed = $('.np-elapsed');
  const remaining = $('.np-remaining');
  if (!bar) return;

  let lastSecond = -1;
  const step = () => {
    if (!bar.isConnected) return;   // panel closed
    const duration = player.track?.duration ?? 0;
    const at = livePosition();
    const pct = duration ? Math.min(100, (at / duration) * 100) : 0;

    /* A finger on the scrubber owns these pixels until it lets go. */
    if (!scrubbing) {
      bar.style.width = `${pct}%`;
      knob.style.left = `${pct}%`;

      // The clocks only change once a second; writing them every frame is
      // layout work for text that is identical 59 times out of 60.
      const second = Math.floor(at);
      if (second !== lastSecond) {
        lastSecond = second;
        elapsed.textContent = formatTime(at);
        remaining.textContent = `−${formatTime(Math.max(0, duration - at))}`;
        // The ambient wall clock only needs the minute boundary.
        if (new Date().getSeconds() === 0) paintNpClock();
      }
    }

    /* The 18b bottom-edge hairline rides the same loop. */
    if (edgeFill) edgeFill.style.width = `${pct}%`;

    /* The mini player drives its own hairline on a one-second timer, so
       there is nothing to do for it here — it has to keep moving while
       this panel is closed anyway. */

    rafId = requestAnimationFrame(step);
  };
  rafId = requestAnimationFrame(step);
}

/* Draggable, with the clocks running under the finger; the seek itself
   is committed on release — every move would otherwise be a bridge
   round-trip. A plain tap is just a zero-length drag. */
function armScrub(track) {
  if (!track) return;
  const paint = (clientX) => {
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const duration = player.track?.duration ?? 0;
    track.querySelector('.np-track-fill').style.width = `${ratio * 100}%`;
    track.querySelector('.np-track-knob').style.left = `${ratio * 100}%`;
    const at = ratio * duration;
    const el = $('.np-elapsed');
    const rem = $('.np-remaining');
    if (el) el.textContent = formatTime(at);
    if (rem) rem.textContent = `−${formatTime(Math.max(0, duration - at))}`;
    return ratio;
  };
  track.addEventListener('pointerdown', (event) => {
    scrubbing = true;
    try { track.setPointerCapture(event.pointerId); } catch { /* stale pointer id */ }
    let ratio = paint(event.clientX);
    const move = (ev) => { ratio = paint(ev.clientX); };
    const done = () => {
      track.removeEventListener('pointermove', move);
      track.removeEventListener('pointerup', done);
      track.removeEventListener('pointercancel', done);
      scrubbing = false;
      const duration = player.track?.duration ?? 0;
      if (duration) seek(ratio * duration).catch(reportError);
    };
    track.addEventListener('pointermove', move);
    track.addEventListener('pointerup', done);
    track.addEventListener('pointercancel', done);
  });
}

/**
 * The controls give way to the ambient screen when nobody has touched
 * the wall for FADE_AFTER — but only while music is actually playing
 * (18d): a paused player keeps its controls, and true idleness belongs
 * to the photo screensaver. Any pointer or key activity brings the
 * controls straight back.
 *
 * Listeners sit on the whole panel rather than the stage, because the
 * faded chrome stops taking pointer events and a tap up there has to
 * wake things up rather than land on nothing.
 */
const WAKE_EVENTS = ['pointerdown', 'pointermove', 'keydown'];

function armFade(root) {
  const rest = () => {
    if (hasTrack() && player.state === 'playing') root.classList.add('resting');
  };
  const wake = (event) => {
    /* Tapping the photo button must not wake the player it is about to
       leave, and tapping ☾ must not wake what it is dimming — either
       wake would fade the button out from under the finger before the
       tap lands. */
    if (event?.target?.closest?.('.np-saver-btn, .np-dim-btn')) return;
    /* Any other touch is also the lights back on. */
    if (nightDim.active) setNightDim(false);
    root.classList.remove('resting');
    clearTimeout(fadeTimer);
    /* Only a real touch cancels the music saver's fast settle — the
       initial arm (no event) may be the very render that saver opened,
       with its settle already ticking. */
    if (event) clearTimeout(settleTimer);
    fadeTimer = setTimeout(rest, FADE_AFTER);
  };
  wakeNow = wake;
  restNow = rest;
  for (const ev of WAKE_EVENTS) root.addEventListener(ev, wake, { passive: true });

  onTabClose(() => {
    for (const ev of WAKE_EVENTS) root.removeEventListener(ev, wake);
    // Leaving Now Playing must not leave the rest of the panel dimmed.
    root.classList.remove('resting');
    wakeNow = restNow = null;
  });
  wake();
}

function emptyState() {
  return h('div.np-empty',
    icon('music', { size: 64, stroke: 1.4 }),
    h('div.np-empty-title', 'Nothing playing'),
    h('div.np-empty-note', 'Find something in Browse, or start a song from any device on this account.'),
  );
}

/* ── Browse — the "Mosaic" (handoff 17c) & search (4b) ───────
   One body, three states. Home: a mosaic of tiles sized by relevance —
   Continue Listening big, four contextual picks small — over a library
   chip row and a pinned now-playing bar. Typing swaps the mosaic for
   the 4b results grid live; a library chip opens the full shelf in
   place. */

function renderBrowse(body) {
  const results = h('div.browse-body');

  const input = h('input.search-input', {
    type: 'search',
    placeholder: 'Search artists, songs, albums…',
    autocapitalize: 'off',
    // iPadOS otherwise floats an autocorrect bubble ("sun-kissed ×")
    // under the field, over the results. Artist names are not words.
    autocorrect: 'off',
    autocomplete: 'off',
    // Boolean, not the string 'false' — which is truthy, and quietly
    // turned spellchecking back on.
    spellcheck: false,
    oninput: () => runSearch(input.value, body, results),
  });
  const clear = h('button.search-clear.no-expand', {
    onclick: () => { input.value = ''; runSearch('', body, results); input.focus(); },
  }, '✕ clear');

  /* The flush body is the 17c canvas: its own inset, the faint blue
     glow, one column — search pill, mosaic, chips, now bar. */
  body.classList.add('music-browse');
  fill(body,
    h('label.search-pill',
      icon('search', { size: 20 }),
      input,
      clear,
    ),
    results,
    h('div.lib-chips',
      libChip('Your Library', () => showLibrary(results, 'playlists')),
      libChip('Recently Played', () => showLibrary(results, 'recent')),
    ),
    h('div.browse-now-host'),
  );

  loadMosaic(results);
  paintBrowseBar();
}

const libChip = (label, open) =>
  h('button.lib-chip.no-expand', { onclick: open }, label);

function connectionStatus() {
  const el = h('div.music-status',
    h('span.music-status-dot'),
    h('span.music-status-text', 'Apple Music'),
  );
  musicAuthStatus().then((status) => {
    const ok = status === 'granted';
    el.classList.toggle('ok', ok);
    fill(el.querySelector('.music-status-text'),
      ok ? 'Apple Music' : musicBlockedReason() || 'Apple Music');
  }).catch(() => {});
  return el;
}

/* ── 17c: the mosaic home ────────────────────────────────── */

/* TONIGHT pairs the next calendar event with a playlist by keyword,
   falling back to a time-of-day pick (the handoff blesses simple
   heuristics). */
const EVENT_MOODS = [
  [/dinner|lunch|brunch|cook|kitchen|bbq|grill/i, 'dinner jazz'],
  [/party|birthday|friends|game night/i, 'party classics'],
  [/homework|study|school|reading|quiet/i, 'focus instrumental'],
  [/gym|run|workout|practice|soccer|swim|bike/i, 'workout energy'],
  [/movie|film|night in/i, 'cozy evening'],
];

function suggestSlot() {
  const now = new Date();
  const hour = now.getHours();
  const daypart = hour < 11
    ? { kicker: 'This morning', term: 'morning coffee acoustic',
        title: 'Morning Coffee', sub: 'Ease into the day' }
    : hour < 17
      ? { kicker: 'This afternoon', term: 'afternoon acoustic',
          title: 'Afternoon Light', sub: 'A daytime backdrop' }
      : { kicker: 'Tonight', term: 'evening chill',
          title: 'Evening Chill', sub: 'Wind the day down' };

  const next = eventsOnDay(live.calendar?.events ?? [], now)
    .filter((ev) => !ev.allDay && ev.start > now)
    .sort((a, b) => a.start - b.start)[0];
  if (!next) return daypart;

  const term = EVENT_MOODS.find(([re]) => re.test(next.title))?.[1] ?? daypart.term;
  return {
    kicker: daypart.kicker,
    term,
    title: term.replace(/(^|\s)\S/g, (c) => c.toUpperCase()),
    sub: `${next.title} at ${clockTime(next.start)}`,
  };
}

async function loadMosaic(host) {
  fill(host, h('div.empty', 'Loading…'));

  /* allSettled, not all: these are independent requests, and one
     failure must not take the search box down with it. */
  const [recentR, mineR] = await Promise.allSettled([recentlyPlayed(), playlists()]);
  if (!host.isConnected) return;
  const recent = recentR.status === 'fulfilled' ? recentR.value : [];
  const mine = mineR.status === 'fulfilled' ? mineR.value : [];

  if (!recent.length && !mine.length && !hasTrack()) {
    const failed = [recentR, mineR].find((r) => r.status === 'rejected');
    /* Prefer the reason we understand. MusicKit reports a missing
       subscription and a missing permission the same way — as a bare
       MusicDataRequest error. */
    const known = musicBlockedReason();
    return fill(host, h('div.empty',
      icon('music', { size: 34 }),
      h('div', known || (failed ? failed.reason.message : 'Nothing to show yet')),
      h('div.empty-hint',
        known ? '' :
        failed ? 'Searching still works — try an artist or album above.'
               : 'Search for a song, album or playlist above.'),
    ));
  }

  /* Each tile claims something the earlier tiles have not. */
  const used = new Set();
  const claim = (pool, pred) => {
    const found = pool.find((x) => x && !used.has(x.id) && (!pred || pred(x)));
    if (found) used.add(found.id);
    return found;
  };

  tileHue = 1;
  const tiles = [];

  /* Continue Listening (2×2): the deck if it holds anything, else the
     most recent thing on the account. */
  if (hasTrack()) {
    const t = player.track;
    tiles.push(continueTile({
      title: t.album || t.title,
      sub: [t.artist, player.state === 'playing' ? 'Playing now' : 'Paused']
        .filter(Boolean).join(' · '),
      liveDeck: true,
      art: t.artworkUrl,
      label: t.album || t.title,
      resume: () => (player.state === 'playing' ? Promise.resolve() : togglePlay()),
      restart: async () => {
        await seek(0);
        if (player.state !== 'playing') await togglePlay();
      },
    }));
  } else {
    const item = claim([...recent, ...mine]);
    tiles.push(item ? continueTile({
      title: item.title,
      sub: item.subtitle ?? 'Pick up where you left off',
      art: item.artworkUrl,
      label: item.title,
      resume: () => playItem(item.type ?? 'album', item.id),
    }) : ghostTile('Continue listening', 'Play something and it will wait here'));
  }

  tiles.push(termTile(suggestSlot()));

  const made = claim(mine, (x) => /mix|for you|daily|weekly|station/i.test(x.title))
    ?? claim(mine);
  tiles.push(made ? itemTile('Made for you', made, made.subtitle ?? 'Apple Music')
                  : ghostTile('Made for you', 'Mixes land here as Apple Music learns'));

  const rec = claim(recent);
  tiles.push(rec ? itemTile('Recent', rec, rec.subtitle ?? 'Apple Music')
                 : ghostTile('Recent', 'Recently played lands here'));

  /* The habitual pick: a day-of-week name match first, then whatever
     the shelves still hold. */
  const day = new Date().getDay();
  const habit = claim(mine, (x) => /weekend|saturday|sunday|friday|chores|pancake/i.test(x.title))
    ?? claim([...mine, ...recent]);
  tiles.push(habit
    ? itemTile(day === 0 || day === 6 ? 'Weekend' : 'House favorite', habit,
               habit.subtitle ?? '')
    : ghostTile('Weekend', 'A habitual pick lands here'));

  fill(host, h('div.mosaic', ...tiles));
}

function continueTile({ title, sub, art, liveDeck, label, resume, restart }) {
  const subEl = h('div.mosaic-sub.mosaic-continue-sub', sub);
  if (liveDeck) subEl.dataset.live = '1';
  const tile = h('div.mosaic-tile.mosaic-continue.tappable', {
    role: 'button',
    tabindex: 0,
    onclick: () => runTile(tile, resume, label),
  },
    h('div.mosaic-kicker', 'Continue listening'),
    h('div.mosaic-hero', title),
    subEl,
    h('div.mosaic-actions',
      h('button.mosaic-pill.primary.no-expand', {
        onclick: (event) => { event.stopPropagation(); runTile(tile, resume, label); },
      }, icon('play', { size: 14 }), 'Resume'),
      restart ? h('button.mosaic-pill.no-expand', {
        onclick: (event) => { event.stopPropagation(); runTile(tile, restart, label); },
      }, 'Start over') : null,
    ),
  );
  tileGradient(tile, art, 0);
  return tile;
}

function itemTile(kicker, item, sub) {
  const tile = h('div.mosaic-tile.tappable', {
    role: 'button',
    tabindex: 0,
    onclick: () => runTile(tile, () => playItem(item.type ?? 'album', item.id), item.title),
  },
    h('div.mosaic-kicker', kicker),
    h('div.mosaic-title', item.title),
    h('div.mosaic-sub', sub),
  );
  tileGradient(tile, item.artworkUrl, tileHue++);
  return tile;
}

/* A tile that plays a search term rather than a known item — the
   TONIGHT suggestion. First playlist hit wins, then album, then song. */
function termTile({ kicker, title, sub, term }) {
  const tile = h('div.mosaic-tile.tappable', {
    role: 'button',
    tabindex: 0,
    onclick: () => runTile(tile, async () => {
      const found = await search(term);
      const item = found.playlists?.[0] ?? found.albums?.[0] ?? found.songs?.[0];
      if (!item) throw new Error(`Nothing found for “${term}”`);
      await playItem(item.type ?? 'playlist', item.id);
    }, title),
  },
    h('div.mosaic-kicker', kicker),
    h('div.mosaic-title', title),
    h('div.mosaic-sub', sub),
  );
  tileGradient(tile, null, tileHue++);
  return tile;
}

/* A slot with nothing to offer says what would fill it, quietly. */
function ghostTile(kicker, note) {
  return h('div.mosaic-tile.ghost',
    h('div.mosaic-kicker', kicker),
    h('div.mosaic-sub', note),
  );
}

/* Artwork-derived tile grounds: sample the cover small, average it, and
   run the handoff's 135° ramp into near-black. The reference hues paint
   first so a slow (or tainted, or absent) cover never leaves a hole. */
const REF_HUES = [
  ['#3c4a6e', '#1d2438'],   // navy
  ['#6e4a52', '#2a2438'],   // rose
  ['#54487a', '#241d38'],   // plum
  ['#4a6e5c', '#1d3028'],   // moss
  ['#7a6a4e', '#38301f'],   // sand
];
let tileHue = 1;

function tileGradient(tile, url, index) {
  const [a, b] = REF_HUES[index % REF_HUES.length];
  tile.style.background = `linear-gradient(135deg, ${a}, ${b})`;
  if (!url) return;
  const probe = new Image();
  probe.crossOrigin = 'anonymous';
  probe.onload = () => {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 8;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(probe, 0, 0, 8, 8);
      const px = ctx.getImageData(0, 0, 8, 8).data;
      let r = 0, g = 0, bl = 0;
      for (let k = 0; k < px.length; k += 4) { r += px[k]; g += px[k + 1]; bl += px[k + 2]; }
      const n = px.length / 4;
      if (tile.isConnected) {
        tile.style.background = `linear-gradient(135deg,
          rgba(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(bl / n)}, 0.6),
          rgba(11, 14, 24, 0.97)), #0b0e18`;
      }
    } catch { /* cross-origin canvas taint — the reference hue stays */ }
  };
  probe.src = url;
}

/* ── The library chips' shelf view ───────────────────────── */

async function showLibrary(host, kind) {
  fill(host, h('div.empty', 'Loading…'));
  try {
    const items = kind === 'recent' ? await recentlyPlayed() : await playlists();
    if (!host.isConnected) return;
    if (!items.length) return fill(host, h('div.empty', 'Nothing here yet'));
    fill(host,
      h('section.browse-section.grow',
        h('div.section-head',
          h('button.lib-back.no-expand', {
            onclick: () => loadMosaic(host),
            'aria-label': 'Back to browse',
          }, '‹ Browse'),
          h('div.label', kind === 'recent' ? 'Recently played' : 'Your playlists'),
          h('div.note', `${items.length} ${kind === 'recent' ? 'items' : 'playlists'}`),
        ),
        kind === 'recent'
          ? h('div.recent-grid', ...items.slice(0, 10).map((item) => recentTile(item, false)))
          : h('div.pl-grid', ...items.map(playlistCard)),
      ),
    );
  } catch (err) {
    if (host.isConnected) fill(host, h('div.empty', err.message));
  }
}

let searchTimer = null;
function runSearch(term, body, host, { immediate } = {}) {
  clearTimeout(searchTimer);
  body.classList.toggle('searching', !!term.trim());
  if (!term.trim()) return loadMosaic(host);
  searchTimer = setTimeout(async () => {
    try {
      const found = await search(term);
      if (body.isConnected) renderResults(host, term, found);
    } catch (err) {
      fill(host, h('div.empty', err.message));
    }
  }, immediate ? 0 : 250);
}

function recentTile(item, first) {
  return h('button.recent-tile.no-expand', {
    onclick: (event) => start(event.currentTarget, item.type ?? 'album', item),
  },
    h('div.recent-art.play-art',
      artOrNote(item.artworkUrl, 30, `${item.type} "${item.title}"`),
      first ? h('span.recent-fab', icon('play', { size: 16 })) : null,
    ),
    h('div.recent-title', item.title),
    h('div.recent-sub', item.subtitle ?? item.artist ?? ''),
  );
}

function playlistCard(item) {
  return h('button.pl-card.no-expand', {
    onclick: (event) => start(event.currentTarget, 'playlist', item),
  },
    h('div.pl-art.play-art', artOrNote(item.artworkUrl, 26, `playlist "${item.title}"`)),
    h('div.pl-meta',
      h('div.pl-name', item.title),
      item.subtitle ? h('div.pl-sub', item.subtitle) : null,
    ),
    h('span.pl-play', icon('play', { size: 16 })),
  );
}

/* ── 4b: results as you type ─────────────────────────────── */

function renderResults(host, term, { songs = [], albums = [], playlists: lists = [] }) {
  if (!songs.length && !albums.length && !lists.length) {
    return fill(host, h('div.empty', 'No matches'));
  }

  /* Top result: the artist, if the songs agree on one that matches the
     query; otherwise the first album or playlist. The bridge has no
     artist entity, so the card is assembled from what came back. */
  const artist = topArtist(term, songs);
  const topItem = artist ?? albums[0] ?? lists[0] ?? null;

  fill(host,
    h('div.search-cols',
      h('div.search-left',
        topItem ? h('section.browse-section',
          h('div.label', 'Top result'),
          topResultCard(topItem),
        ) : null,
        albums.length ? h('section.browse-section',
          h('div.label', 'Albums'),
          h('div.album-grid', ...albums.slice(0, 3).map(albumTile)),
        ) : null,
        lists.length ? h('section.browse-section',
          h('div.label', 'Playlists'),
          h('div.album-grid', ...lists.slice(0, 3).map(albumTile)),
        ) : null,
      ),
      h('div.search-right',
        h('div.section-head',
          h('div.label', 'Songs'),
          songs.length > 6 ? h('div.note', `${songs.length} results`) : null,
        ),
        songs.length
          ? h('div.song-list', ...songs.slice(0, 6).map(songRow))
          : h('div.empty', 'No songs'),
        /* No second now-playing bar here: the browse body already pins
           one at its foot, and it survives the switch into results. */
      ),
    ),
  );
}

function topArtist(term, songs) {
  const q = term.trim().toLowerCase();
  const match = songs.filter((s) => (s.artist ?? '').toLowerCase().includes(q));
  if (!match.length) return null;
  const name = match[0].artist;
  if (!match.every((s) => s.artist === name)) return null;
  return { type: 'song', id: match[0].id, title: name, subtitle: 'Artist',
           artworkUrl: match[0].artworkUrl, isArtist: true };
}

function topResultCard(item) {
  return h('div.top-result',
    h(`div.top-result-art.play-art${item.isArtist ? '.round' : ''}`,
      artOrNote(item.artworkUrl, 34, `"${item.title}"`)),
    h('div.top-result-main',
      h('div.top-result-name', item.title),
      h('div.top-result-sub', item.subtitle ?? ''),
      h('div.top-result-actions',
        h('button.tr-btn.primary.no-expand', {
          onclick: (event) => start(event.currentTarget.closest('.top-result'), item.type, item),
        }, icon('play', { size: 14 }), 'Play'),
      ),
    ),
  );
}

function albumTile(item) {
  return h('button.album-tile.no-expand', {
    onclick: (event) => start(event.currentTarget, item.type ?? 'album', item),
  },
    h('div.album-art.play-art', artOrNote(item.artworkUrl, 26, `${item.type} "${item.title}"`)),
    h('div.album-name', item.title),
    item.subtitle ? h('div.album-sub', item.subtitle) : null,
  );
}

function songRow(item) {
  const playing = player.track?.id === item.id;
  return h(`button.song-row.no-expand${playing ? '.playing' : ''}`, {
    onclick: (event) => start(event.currentTarget, 'song', item),
  },
    h('div.song-art.play-art',
      artOrNote(item.artworkUrl, 20, `song "${item.title}"`),
      playing ? h('span.song-playing-glyph', icon('play', { size: 12 })) : null,
    ),
    h('div.song-main',
      h('div.song-title', item.title),
      h('div.song-sub', [item.artist, item.album].filter(Boolean).join(' · ')),
    ),
    playing ? h('span.song-tag', 'Playing') : null,
  );
}

/**
 * Artwork, or a music note if there isn't any.
 *
 * The note also covers a URL that *looks* fine and then fails to load —
 * plenty of library items have artwork the web view can't fetch, and a
 * shelf of broken-image glyphs reads as a broken app rather than as an
 * album without a cover.
 */
function artOrNote(url, size, label = '') {
  /* Two very different failures look identical here — a cover the
     bridge never sent, and a cover it sent that the web view could not
     fetch — and telling them apart from a screenshot is impossible.
     Both say so now, so one look at the console settles which. */
  if (!url) {
    console.info(`[music] no artwork for ${label || 'item'}`);
    return icon('music', { size });
  }
  const img = h('img', { src: url, alt: '', loading: 'lazy' });
  img.addEventListener('error', () => {
    console.warn(`[music] artwork failed to load for ${label || 'item'}: ${url}`);
    if (img.parentNode) img.replaceWith(icon('music', { size }));
  });
  return img;
}

/**
 * Tapping something has to say so, immediately.
 *
 * Starting a playlist means a catalog lookup, loading its track list and
 * handing a queue to the system player — a second or two on a good day.
 * The tile used to do nothing at all for that whole stretch and then
 * raise a toast, which reads as a tap that missed. So: the tile marks
 * itself the moment it is pressed, and on success the panel switches to
 * Now Playing, where the cover fills the wall. That is the same answer
 * tapping a record in Music gives, and it is impossible to miss.
 * Shared by the mosaic tiles and the search results.
 */
async function runTile(tile, action, label = '') {
  if (tile.classList.contains('starting')) return;   // no double-taps
  tile.closest('.browse-body')?.querySelectorAll('.starting, .started')
    .forEach((el) => el.classList.remove('starting', 'started'));
  tile.classList.add('starting');

  try {
    await action();
    tile.classList.remove('starting');
    tile.classList.add('started');
    if (label) toast(`Playing ${label}`);
    /* Long enough to register as confirmation on the tile itself, short
       enough that the Now Playing screen still feels like a response to
       the tap rather than a separate event. */
    setTimeout(() => setPanelTab('playing'), 450);
  } catch (err) {
    tile.classList.remove('starting');
    reportError(err);
  }
}

const start = (tile, type, item) =>
  runTile(tile, () => playItem(type, item.id), item.title);

/* ── The music screensaver ────────────────────────────────────
   While something is playing, the idle timeout lands here instead of
   the photo slideshow: the full-screen player opens (or stays), then
   settles into the ambient screen. The moon in its corner is the way
   across to the photos. */

export function enterMusicSaver() {
  if (!hasTrack() || player.state !== 'playing') return false;
  /* Already on the wall: reopening would rebuild the stage and wake the
     controls — the opposite of a screensaver settling in. */
  if (!$('.panel .np-stage')) openMusicPanel({ tab: 'playing' });
  /* The idle timer has already decided the room is empty — settle into
     the ambient artwork after a beat, not another half a minute. Its
     own timer, because armFade's first wake() (the stage may only just
     have rendered) clears fadeTimer as it arms. */
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => restNow?.(), 2200);
  return true;
}

export async function ensureMusicAccess() {
  const status = await musicAuthStatus();
  if (status === 'granted') return true;
  if (status === 'unavailable') {
    toast('Apple Music needs the HomeHub app', 'warn');
    return false;
  }
  return (await requestMusicAccess()) === 'granted';
}

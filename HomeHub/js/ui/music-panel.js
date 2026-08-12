/* Full-screen Now Playing, and the browse/search view behind it.

   This is the one screen that should look like the room it's in: the
   album art is the composition, and everything else is laid over a
   blurred, darkened enlargement of the same image so the wall takes on
   the colour of whatever is playing.

   Controls fade out after a few quiet seconds and come back on the
   first touch — the point of a wall display is the art, not the
   buttons. */

import { h, fill, $, toast } from '../core/dom.js';
import { icon } from './icons.js';
import { openPanel, onPanelClose, onTabClose, setPanelTab } from '../core/panel.js';
import { on } from '../core/store.js';
import {
  player, livePosition, formatTime, hasTrack,
  togglePlay, next, previous, seek, setShuffle, setRepeat,
  search, playlists, recentlyPlayed, playItem,
  musicAuthStatus, requestMusicAccess, musicBlockedReason,
} from '../data/music.js';

/** How long the controls stay up after the last touch. */
const FADE_AFTER = 6000;

export function openMusicPanel({ source, tab = 'playing' } = {}) {
  openPanel({
    id: 'music',
    title: 'Music',
    source,
    tabs: [
      { id: 'playing', label: 'Now Playing', render: renderNowPlaying, flush: true },
      { id: 'browse', label: 'Browse', render: renderBrowse },
    ],
  }).then(() => {
    if (tab !== 'playing') setPanelTab(tab);

    const stop = on('music', () => {
      // Only the transport needs repainting on a state change; rebuilding
      // the whole tab would restart the artwork's fade-in every few
      // seconds and interrupt anyone scrolling the browse list.
      paintTransport();
      paintTrack();
    });
    onPanelClose(stop);
  });
}

/* ── Now Playing ──────────────────────────────────────────── */

let fadeTimer = null;
let rafId = null;

function renderNowPlaying(body, panel) {
  if (!hasTrack()) return fill(body, emptyState());

  const stage = h('div.np-stage',
    h('div.np-backdrop'),
    h('div.np-scrim'),
    h('div.np-content',
      h('div.np-art-wrap', h('img.np-art', { alt: '' })),
      h('div.np-meta',
        h('div.np-title'),
        h('div.np-artist'),
        h('div.np-album'),
      ),
    ),
    h('div.np-controls',
      h('div.np-transport',
      h('div.np-scrub',
        h('span.np-elapsed.num', '0:00'),
        h('div.np-track', { onclick: onScrub },
          h('div.np-track-fill'),
          h('div.np-track-knob'),
        ),
        h('span.np-remaining.num', '-0:00'),
      ),
      h('div.np-buttons',
        h('button.np-btn.np-shuffle', {
          onclick: () => setShuffle(!player.shuffle).catch(reportError),
          'aria-label': 'Shuffle',
        }, icon('shuffle', { size: 26 })),
        h('button.np-btn', {
          onclick: () => previous().catch(reportError),
          'aria-label': 'Previous track',
        }, icon('skipBack', { size: 34 })),
        h('button.np-btn.np-play', {
          onclick: () => togglePlay().catch(reportError),
          'aria-label': 'Play or pause',
        }),
        h('button.np-btn', {
          onclick: () => next().catch(reportError),
          'aria-label': 'Next track',
        }, icon('skipForward', { size: 34 })),
        h('button.np-btn.np-repeat', {
          onclick: () => setRepeat(nextRepeat(player.repeat)).catch(reportError),
          'aria-label': 'Repeat',
        }, icon('refresh', { size: 26 })),
      ),
      ),
    ),
  );

  fill(body, stage);
  paintTrack();
  paintTransport();
  startScrubLoop();
  armFade(panel ?? stage);

  onTabClose(() => {
    cancelAnimationFrame(rafId);
    clearTimeout(fadeTimer);
    rafId = null;
  });
}

const nextRepeat = (mode) => ({ off: 'all', all: 'one', one: 'off' }[mode] ?? 'off');

function reportError(err) {
  toast(err.message, 'warn');
}

/** Artwork and text only change between tracks, so they repaint separately. */
function paintTrack() {
  const art = $('.np-art');
  if (!art || !player.track) return;
  const { artworkUrl, title, artist, album } = player.track;

  if (artworkUrl && art.dataset.src !== artworkUrl) {
    art.dataset.src = artworkUrl;
    art.classList.remove('loaded');
    art.onload = () => art.classList.add('loaded');
    art.src = artworkUrl;
    // The backdrop is the same image, blown up and blurred, so the whole
    // wall takes the colour of the record.
    $('.np-backdrop').style.backgroundImage = `url("${artworkUrl}")`;
  }
  fill($('.np-title'), title ?? '');
  fill($('.np-artist'), artist ?? '');
  fill($('.np-album'), album ?? '');

  // Mini player too, if it's on screen.
  const miniArt = $('.mini-art');
  if (miniArt && artworkUrl && miniArt.dataset.src !== artworkUrl) {
    miniArt.dataset.src = artworkUrl;
    miniArt.src = artworkUrl;
  }
}

function paintTransport() {
  const playBtn = $('.np-play');
  if (playBtn) {
    fill(playBtn, icon(player.state === 'playing' ? 'pause' : 'play', { size: 44 }));
  }
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

/** Advance the scrubber locally rather than polling the bridge. */
function startScrubLoop() {
  cancelAnimationFrame(rafId);
  const step = () => {
    const fill_ = $('.np-track-fill');
    if (!fill_) return;   // panel closed
    const duration = player.track?.duration ?? 0;
    const at = livePosition();
    const pct = duration ? Math.min(100, (at / duration) * 100) : 0;

    fill_.style.width = `${pct}%`;
    $('.np-track-knob').style.left = `${pct}%`;
    $('.np-elapsed').textContent = formatTime(at);
    $('.np-remaining').textContent = `-${formatTime(Math.max(0, duration - at))}`;

    /* The mini player drives its own hairline on a one-second timer, so
       there is nothing to do for it here — it has to keep moving while
       this panel is closed anyway. */

    rafId = requestAnimationFrame(step);
  };
  rafId = requestAnimationFrame(step);
}

function onScrub(event) {
  const track = event.currentTarget;
  const rect = track.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  const duration = player.track?.duration ?? 0;
  if (duration) seek(ratio * duration).catch(reportError);
}

/**
 * Everything but the record dims away when nobody is touching the wall —
 * the header and tabs go too, so a full-screen player really is just the
 * album art. Any pointer or key activity brings it all straight back.
 *
 * Listeners sit on the whole panel rather than the stage, because the
 * faded chrome stops taking pointer events and a tap up there has to
 * wake things up rather than land on nothing.
 */
const WAKE_EVENTS = ['pointerdown', 'pointermove', 'keydown'];

function armFade(root) {
  const wake = () => {
    root.classList.remove('resting');
    clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => root.classList.add('resting'), FADE_AFTER);
  };
  for (const ev of WAKE_EVENTS) root.addEventListener(ev, wake, { passive: true });

  onTabClose(() => {
    for (const ev of WAKE_EVENTS) root.removeEventListener(ev, wake);
    // Leaving Now Playing must not leave the rest of the panel dimmed.
    root.classList.remove('resting');
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

/* ── Browse ───────────────────────────────────────────────── */

function renderBrowse(body) {
  const results = h('div.browse-results');
  const input = h('input.text-input', {
    type: 'search',
    placeholder: 'Search songs, albums, playlists…',
    autocapitalize: 'off',
    // iPadOS otherwise floats an autocorrect bubble ("sun-kissed ×")
    // under the field, over the results. Artist names are not words.
    autocorrect: 'off',
    autocomplete: 'off',
    // Boolean, not the string 'false' — which is truthy, and quietly
    // turned spellchecking back on.
    spellcheck: false,
    oninput: () => scheduleSearch(input.value, results),
  });

  fill(body,
    h('div.list-add.grow.browse-search', icon('search', { size: 22 }), input),
    results,
  );

  loadShelves(results);
}

let searchTimer = null;
function scheduleSearch(term, host) {
  clearTimeout(searchTimer);
  if (!term.trim()) return loadShelves(host);
  searchTimer = setTimeout(async () => {
    try {
      const { songs, albums, playlists: found } = await search(term);
      fill(host,
        shelf('Songs', songs, 'song'),
        shelf('Albums', albums, 'album'),
        shelf('Playlists', found, 'playlist'),
      );
      if (!songs?.length && !albums?.length && !found?.length) {
        fill(host, h('div.empty', 'No matches'));
      }
    } catch (err) {
      fill(host, h('div.empty', err.message));
    }
  }, 350);
}

async function loadShelves(host) {
  fill(host, h('div.empty', 'Loading…'));

  /* allSettled, not all: these are two independent requests, and with
     Promise.all a single failure replaced the entire tab — search box
     included — with one error line. Whatever came back should still be
     shown, and the search above keeps working regardless. */
  const [recent, mine] = await Promise.allSettled([recentlyPlayed(), playlists()]);

  const shelves = [];
  if (recent.status === 'fulfilled' && recent.value.length) {
    shelves.push(shelf('Recently played', recent.value, null));
  }
  if (mine.status === 'fulfilled' && mine.value.length) {
    shelves.push(shelf('Your playlists', mine.value, 'playlist'));
  }
  if (shelves.length) return fill(host, ...shelves);

  const failed = [recent, mine].find((r) => r.status === 'rejected');

  /* Prefer the reason we understand. MusicKit reports a missing
     subscription and a missing permission the same way — as a bare
     MusicDataRequest error — so the framework's own message is the least
     useful thing we could put on a wall. */
  const known = musicBlockedReason();

  fill(host, h('div.empty',
    icon('music', { size: 34 }),
    h('div', known || (failed ? failed.reason.message : 'Nothing to show yet')),
    h('div.empty-hint',
      known ? '' :
      failed ? 'Searching still works — try an artist or album above.'
             : 'Search for a song, album or playlist above.'),
  ));
}

/**
 * Artwork, or a music note if there isn't any.
 *
 * The note also covers a URL that *looks* fine and then fails to load —
 * plenty of library items have artwork the web view can't fetch, and a
 * shelf of broken-image glyphs reads as a broken app rather than as an
 * album without a cover.
 */
function artOrNote(url, size) {
  if (!url) return icon('music', { size });
  const img = h('img', { src: url, alt: '', loading: 'lazy' });
  img.addEventListener('error', () => {
    if (img.parentNode) img.replaceWith(icon('music', { size }));
  });
  return img;
}

function shelf(title, items, forcedType) {
  if (!items?.length) return null;
  return h('section.shelf',
    h('div.section-head', h('div.label', title)),
    h('div.shelf-row.hscroll',
      ...items.map((item) =>
        h('button.shelf-item', {
          onclick: () => playItem(forcedType ?? item.type, item.id)
            .then(() => toast(`Playing ${item.title}`))
            .catch(reportError),
        },
          h('div.shelf-art', artOrNote(item.artworkUrl, 32)),
          h('div.shelf-title', item.title),
          h('div.shelf-sub', item.subtitle ?? item.artist ?? ''),
        )),
    ),
  );
}

/* ── Authorisation prompt, used by Settings ───────────────── */

export async function ensureMusicAccess() {
  const status = await musicAuthStatus();
  if (status === 'granted') return true;
  if (status === 'unavailable') {
    toast('Apple Music needs the HomeHub app', 'warn');
    return false;
  }
  return (await requestMusicAccess()) === 'granted';
}

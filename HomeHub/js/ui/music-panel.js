/* Full-screen Now Playing, and the browse/search view behind it.

   This is the one screen that should look like the room it's in: the
   album art is the composition, and everything else is laid over a
   blurred, darkened enlargement of the same image so the wall takes on
   the colour of whatever is playing.

   Controls fade out after a few quiet seconds and come back on the
   first touch — the point of a wall display is the art, not the
   buttons. */

import { h, fill, $, toast } from '../core/dom.js';
import { clockParts, fullDate } from '../core/time.js';
import { temp } from '../core/format.js';
import { live } from '../data/hub.js';
import { icon, weatherIcon } from './icons.js';
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
      paintQueue();
      paintBrowseBar();
    });
    onPanelClose(stop);
  });
}

/* ── Now Playing ──────────────────────────────────────────── */

let fadeTimer = null;
let rafId = null;

function renderNowPlaying(body, panel) {
  if (!hasTrack()) return fill(body, emptyState());

  /* The 2b composition: album art left, everything else in a stack to
     its right, queue bar along the foot. The ground is the night
     palette with a bottom ambient glow rather than a blurred blow-up
     of the record — flatter, per the handoff. */
  const stage = h('div.np-stage',
    h('div.np-content',
      h('div.np-art-wrap', h('img.np-art', { alt: '' })),
      h('div.np-right',
        h('div.np-meta',
          h('div.np-title'),
          /* Artist and record as separate spans: one line with a dot in
             the player, a stacked caption in the resting gallery. */
          h('div.np-artist',
            h('span.np-artist-name'),
            h('span.np-artist-dot', '·'),
            h('span.np-album-name'),
          ),
        ),
        h('div.np-controls',
          h('div.np-scrub',
            h('div.np-track', { onclick: onScrub },
              h('div.np-track-fill'),
              h('div.np-track-knob'),
            ),
            h('div.np-times',
              h('span.np-elapsed.num', '0:00'),
              h('span.np-remaining.num', '-0:00'),
            ),
          ),
          h('div.np-buttons',
            h('button.np-btn.ghost-btn.np-shuffle', {
              onclick: () => setShuffle(!player.shuffle).catch(reportError),
              'aria-label': 'Shuffle',
            }, icon('shuffle', { size: 22 })),
            h('button.np-btn.ring-btn', {
              onclick: () => previous().catch(reportError),
              'aria-label': 'Previous track',
            }, icon('skipBack', { size: 26 })),
            h('button.np-btn.np-play', {
              onclick: () => togglePlay().catch(reportError),
              'aria-label': 'Play or pause',
            }),
            h('button.np-btn.ring-btn', {
              onclick: () => next().catch(reportError),
              'aria-label': 'Next track',
            }, icon('skipForward', { size: 26 })),
            h('button.np-btn.ghost-btn.np-repeat', {
              onclick: () => setRepeat(nextRepeat(player.repeat)).catch(reportError),
              'aria-label': 'Repeat',
            }, icon('refresh', { size: 22 })),
          ),
        ),
      ),
    ),
    /* A stable slot: the queue itself is repainted on every push, so
       track changes move the Up Next thumbs along. */
    h('div.np-queue-host'),
    /* Only lit while the controls are resting: the room's clock, so the
       full-art screen still answers the wall's first question. */
    h('div.np-clock',
      h('div.np-clock-time.num'),
      h('div.np-clock-date'),
      h('div.np-clock-temp'),
    ),
  );

  fill(body, stage);
  paintTrack();
  paintTransport();
  paintQueue();
  paintNpClock();
  startScrubLoop();
  armFade(panel ?? stage);

  onTabClose(() => {
    cancelAnimationFrame(rafId);
    clearTimeout(fadeTimer);
    rafId = null;
  });
}

const nextRepeat = (mode) => ({ off: 'all', all: 'one', one: 'off' }[mode] ?? 'off');

/* "UP NEXT · two thumbs · Queue · N tracks" (handoff 2b). Repainted on
   every push, so the thumbs move along when the track does. Only when
   the bridge actually reports a queue. */
function paintQueue() {
  const host = $('.np-queue-host');
  if (!host) return;
  const queue = player.queue ?? [];
  if (!queue.length) return fill(host);
  fill(host, h('div.np-queue',
    h('span.np-queue-label', 'Up next'),
    ...queue.slice(0, 2).flatMap((track) => [
      h('div.np-queue-art', artOrNote(track.artworkUrl, 18, `queued "${track.title}"`)),
      h('div.np-queue-meta',
        h('div.np-queue-title', track.title),
        h('div.np-queue-artist', track.subtitle ?? track.artist ?? ''),
      ),
    ]),
    queue.length > 2 ? h('span.np-queue-count', `Queue · ${queue.length} tracks`) : null,
  ));
}

/* The resting clock. Cheap to keep honest: the scrub loop already runs
   once a second and calls this when the minute turns. */
function paintNpClock() {
  const time = $('.np-clock-time');
  const date = $('.np-clock-date');
  if (!time) return;
  const { hour, minute, period } = clockParts(new Date());
  fill(time, `${hour}:${minute}${period ? ` ${period}` : ''}`);
  fill(date, fullDate(new Date()));

  const tempEl = $('.np-clock-temp');
  const now = live.weather?.current;
  if (tempEl && now) {
    fill(tempEl, weatherIcon(now.condition, { size: 20, night: now.night }), temp(now.temp));
  }
}

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
    // Say so rather than leaving an empty square: a cover that arrives
    // and fails to fetch looks exactly like one that never arrived.
    art.onerror = () => console.warn(`[music] now-playing artwork failed: ${artworkUrl}`);
    art.src = artworkUrl;
  } else if (!artworkUrl) {
    console.info(`[music] no artwork for "${title}"`);
  }
  fill($('.np-title'), title ?? '');
  fill($('.np-artist-name'), artist ?? '');
  fill($('.np-album-name'), album ?? '');
  /* No record name → no dangling dot. */
  $('.np-artist')?.classList.toggle('no-album', !album);

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

/* Keep the browse foot bar honest without rebuilding the tab. */
function paintBrowseBar() {
  const bar = $('.browse-now');
  if (!bar || !player.track) return;
  fill($('.browse-now-title'),
    [player.track.title, player.track.artist].filter(Boolean).join(' — '));
  fill($('.browse-now-state'), icon(player.state === 'playing' ? 'pause' : 'play', { size: 16 }));
  const remaining = $('.browse-now-time');
  const duration = player.track.duration ?? 0;
  if (remaining && duration) {
    fill(remaining, `-${formatTime(Math.max(0, duration - livePosition()))}`);
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
  const elapsed = $('.np-elapsed');
  const remaining = $('.np-remaining');
  if (!bar) return;

  let lastSecond = -1;
  const step = () => {
    if (!bar.isConnected) return;   // panel closed
    const duration = player.track?.duration ?? 0;
    const at = livePosition();
    const pct = duration ? Math.min(100, (at / duration) * 100) : 0;

    bar.style.width = `${pct}%`;
    knob.style.left = `${pct}%`;

    // The clocks only change once a second; writing them every frame is
    // layout work for text that is identical 59 times out of 60.
    const second = Math.floor(at);
    if (second !== lastSecond) {
      lastSecond = second;
      elapsed.textContent = formatTime(at);
      remaining.textContent = `-${formatTime(Math.max(0, duration - at))}`;
      // The resting wall clock only needs the minute boundary.
      if (new Date().getSeconds() === 0) paintNpClock();
    }

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

/* ── Browse (handoff 4a) & search results (4b) ───────────────
   One body, two states. Idle: search pill, mood chips, Recently
   played grid, Your playlists grid, now-playing bar. Typing: the
   4b results grid replaces the browse sections live. */

/* Each chip is a curated catalog search — the mood is the query. */
const MOODS = [
  ['For tonight', 'evening acoustic'],
  ['Dinner', 'dinner jazz'],
  ['Focus', 'focus instrumental'],
  ['Kids', 'kids songs'],
  ['Rainy day', 'rainy day'],
  ['Wind down', 'wind down sleep'],
];

function renderBrowse(body) {
  const results = h('div.browse-body');
  const chips = h('div.browse-chips',
    ...MOODS.map(([label, term]) =>
      h('button.chip.no-expand', {
        onclick: (e) => {
          const on = e.currentTarget.classList.contains('on');
          chips.querySelectorAll('.chip.on').forEach((c) => c.classList.remove('on'));
          input.value = '';
          if (on) return runSearch('', body, results);
          e.currentTarget.classList.add('on');
          runSearch(term, body, results, { immediate: true });
        },
      }, label)),
  );

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
    oninput: () => {
      chips.querySelectorAll('.chip.on').forEach((c) => c.classList.remove('on'));
      runSearch(input.value, body, results);
    },
  });
  const clear = h('button.search-clear.no-expand', {
    onclick: () => { input.value = ''; runSearch('', body, results); input.focus(); },
  }, '✕ clear');

  fill(body,
    h('div.browse-top',
      h('label.search-pill',
        icon('search', { size: 20 }),
        input,
        clear,
      ),
      connectionStatus(),
    ),
    chips,
    results,
    browseNowBar(),
  );

  loadHome(results);
}

function connectionStatus() {
  const el = h('div.music-status',
    h('span.music-status-dot'),
    h('span.music-status-text', 'Apple Music'),
  );
  musicAuthStatus().then((status) => {
    const ok = status === 'granted';
    el.classList.toggle('ok', ok);
    fill(el.querySelector('.music-status-text'),
      ok ? 'Apple Music connected' : musicBlockedReason() || 'Apple Music');
  }).catch(() => {});
  return el;
}

/* The pinned bar at the foot of browse: what's playing, one tap back
   to the full-screen player. */
function browseNowBar() {
  if (!hasTrack()) return null;
  const t = player.track;
  return h('button.browse-now.no-expand', {
    onclick: () => setPanelTab('playing'),
    'aria-label': 'Open Now Playing',
  },
    h('div.browse-now-art', artOrNote(t.artworkUrl, 16, `"${t.title}"`)),
    h('div.browse-now-title', [t.title, t.artist].filter(Boolean).join(' — ')),
    h('span.browse-now-time.num'),
    h('span.browse-now-state', icon(player.state === 'playing' ? 'pause' : 'play', { size: 16 })),
  );
}

let searchTimer = null;
function runSearch(term, body, host, { immediate } = {}) {
  clearTimeout(searchTimer);
  body.classList.toggle('searching', !!term.trim());
  if (!term.trim()) return loadHome(host);
  searchTimer = setTimeout(async () => {
    try {
      const found = await search(term);
      if (body.isConnected) renderResults(host, term, found);
    } catch (err) {
      fill(host, h('div.empty', err.message));
    }
  }, immediate ? 0 : 250);
}

/* ── 4a: browse home ─────────────────────────────────────── */

async function loadHome(host) {
  fill(host, h('div.empty', 'Loading…'));

  /* allSettled, not all: these are two independent requests, and with
     Promise.all a single failure replaced the entire tab — search box
     included — with one error line. */
  const [recent, mine] = await Promise.allSettled([recentlyPlayed(), playlists()]);

  const sections = [];
  if (recent.status === 'fulfilled' && recent.value.length) {
    sections.push(
      h('section.browse-section',
        h('div.section-head', h('div.label', 'Recently played')),
        h('div.recent-grid',
          ...recent.value.slice(0, 5).map((item, i) => recentTile(item, i === 0)),
        ),
      ),
    );
  }
  if (mine.status === 'fulfilled' && mine.value.length) {
    sections.push(
      h('section.browse-section.grow',
        h('div.section-head',
          h('div.label', 'Your playlists'),
          h('div.note', `${mine.value.length} playlists`),
        ),
        h('div.pl-grid', ...mine.value.slice(0, 6).map(playlistCard)),
      ),
    );
  }
  if (sections.length) return fill(host, ...sections);

  const failed = [recent, mine].find((r) => r.status === 'rejected');
  /* Prefer the reason we understand. MusicKit reports a missing
     subscription and a missing permission the same way — as a bare
     MusicDataRequest error. */
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
 */
async function start(tile, type, item) {
  if (tile.classList.contains('starting')) return;   // no double-taps
  tile.closest('.browse-body')?.querySelectorAll('.starting, .started')
    .forEach((el) => el.classList.remove('starting', 'started'));
  tile.classList.add('starting');

  try {
    await playItem(type, item.id);
    tile.classList.remove('starting');
    tile.classList.add('started');
    toast(`Playing ${item.title}`);
    /* Long enough to register as confirmation on the tile itself, short
       enough that the Now Playing screen still feels like a response to
       the tap rather than a separate event. */
    setTimeout(() => setPanelTab('playing'), 450);
  } catch (err) {
    tile.classList.remove('starting');
    reportError(err);
  }
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

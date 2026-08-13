/* The mini player.

   A pill centred in the top bar that only exists while something is
   playing. A dedicated tile would have to sit there empty most of the
   day, and on a wall the thing that's currently making noise deserves
   to be the one element that appears and disappears. It lives up in the
   band because that band already exists for the clock, so music costs
   the widget grid no height at all.

   Tap it to go full screen; the transport buttons work in place. */

import { h, fill, $ } from '../core/dom.js';
import { icon } from './icons.js';
import { on } from '../core/store.js';
import {
  player, hasTrack, togglePlay, next, formatTime, musicAvailable, livePosition,
} from '../data/music.js';
import { openMusicPanel } from './music-panel.js';

let tickTimer = null;

export function mountMiniPlayer() {
  if (!musicAvailable()) return;
  const bar = $('#mini-player');
  render(bar);
  on('music', () => render(bar));
}

/**
 * Walk the hairline and the countdown forwards.
 *
 * Once a second, not once a frame: the panel's scrubber runs on rAF
 * because it moves a knob across the width of the screen, but this bar
 * is three pixels tall and creeps about two pixels a second. A wall
 * display is on all day, and sixty wake-ups a second to redraw nothing
 * visible is the kind of thing that warms an iPad up for no reason.
 */
function startTicking(bar) {
  clearInterval(tickTimer);
  const step = () => {
    const track = player.track;
    const fillEl = bar.querySelector('.mini-progress-fill');
    if (!fillEl || !track) return;
    const at = livePosition();
    const duration = track.duration ?? 0;
    fillEl.style.width = duration ? `${Math.min(100, (at / duration) * 100)}%` : '0%';
    const time = bar.querySelector('.mini-time');
    if (time) time.textContent = `-${formatTime(Math.max(0, duration - at))}`;
  };
  step();
  tickTimer = setInterval(step, 1000);
}

function render(bar) {
  if (!bar) return;

  if (!hasTrack()) {
    bar.classList.remove('in');
    clearInterval(tickTimer);
    // Wait out the slide-down before emptying, or the bar snaps away.
    setTimeout(() => {
      if (hasTrack()) return;
      fill(bar);
      // Forget the track too: the same song resuming later must rebuild
      // the bar, not match the guard below and leave it empty.
      delete bar.dataset.trackId;
    }, 320);
    return;
  }

  const { title, artist, artworkUrl } = player.track;

  // Rebuild only when the track changes; otherwise just refresh state,
  // so the artwork doesn't flicker every time the position updates.
  if (bar.dataset.trackId !== player.track.id || !bar.firstChild) {
    bar.dataset.trackId = player.track.id;
    fill(bar,
      h('button.mini-open', {
        onclick: () => openMusicPanel({ source: bar }),
        'aria-label': `Now playing: ${title} by ${artist}. Open full screen.`,
      },
        h('div.mini-art-wrap',
          artworkUrl
            ? h('img.mini-art', { src: artworkUrl, alt: '', dataset: { src: artworkUrl } })
            : icon('music', { size: 26 }),
        ),
        h('div.mini-meta',
          h('div.mini-title', title),
          h('div.mini-artist', artist),
        ),
      ),

      h('div.mini-progress', h('div.mini-progress-fill')),

      h('div.mini-controls',
        h('button.icon-btn.mini-play.no-expand', {
          onclick: (e) => { e.stopPropagation(); togglePlay(); },
          'aria-label': 'Play or pause',
        }),
        h('button.icon-btn.ghost.no-expand', {
          onclick: (e) => { e.stopPropagation(); next(); },
          'aria-label': 'Next track',
        }, icon('skipForward', { size: 24 })),
        /* Time remaining rather than track length: the hairline below
           already says how far in we are, and what a passer-by actually
           wants to know is how long until this one is over. */
        h('span.mini-time.num'),
      ),
    );
  }

  /* The cover often lands a beat after the track does (the bridge looks
     it up in the catalog and pushes again). The rebuild guard above
     rightly skips same-track pushes — so patch the art in place, or the
     pill shows the fallback note for the whole song. */
  const wrap = bar.querySelector('.mini-art-wrap');
  if (artworkUrl && wrap) {
    const img = wrap.querySelector('img.mini-art');
    if (!img) {
      fill(wrap, h('img.mini-art', { src: artworkUrl, alt: '', dataset: { src: artworkUrl } }));
    } else if (img.dataset.src !== artworkUrl) {
      img.dataset.src = artworkUrl;
      img.src = artworkUrl;
    }
  }

  fill($('.mini-play'), icon(player.state === 'playing' ? 'pause' : 'play', { size: 26 }));
  bar.classList.toggle('paused', player.state !== 'playing');
  startTicking(bar);
  requestAnimationFrame(() => bar.classList.add('in'));
}

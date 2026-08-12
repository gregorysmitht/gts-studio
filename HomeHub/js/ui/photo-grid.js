/* The photo library, as a grid you can actually see and arrange.

   Adding photos used to be a file picker and a number: "14 photos
   stored on this iPad". You could not tell which fourteen, what order
   they would appear in, or get rid of the blurry one without wiping the
   lot. So: thumbnails, a number on each showing where it falls in the
   run, a delete on each, and hold-to-drag to reorder.

   Hold-to-drag rather than drag-on-touch because the grid lives inside a
   scrolling panel. A tile that claims the gesture the instant a finger
   lands on it is a tile you cannot scroll past — and holding to pick
   something up is the same thing the iPad's own home screen does. */

import { h, fill, $, onLongPress, toast } from '../core/dom.js';
import { photos } from '../core/store.js';
import { prepare, THUMB_EDGE, downscale } from '../core/imaging.js';
import { icon } from './icons.js';
import { onTabClose } from '../core/panel.js';

/* Object URLs are only reclaimed when we say so, and a grid of 300 of
   them left behind is 300 decoded images the tab keeps alive. Every URL
   this module mints goes in here and the whole set is released when the
   settings tab closes. */
let liveUrls = new Set();

function objectUrl(blob) {
  const url = URL.createObjectURL(blob);
  liveUrls.add(url);
  return url;
}

function releaseUrls() {
  for (const url of liveUrls) URL.revokeObjectURL(url);
  liveUrls = new Set();
}

/**
 * The grid element. Owns its own data loading and re-rendering, so the
 * settings tab just drops it in place.
 */
export function photoGrid() {
  const host = h('div.photo-manager');
  let rows = [];

  onTabClose(releaseUrls);

  async function reload() {
    rows = await photos.list();
    draw();
    backfillThumbs(rows, draw);
  }

  function draw() {
    if (!rows.length) {
      fill(host, h('div.empty',
        icon('photo', { size: 44, stroke: 1.6 }),
        'No photos yet',
      ));
      return;
    }

    const grid = h('div.photo-grid');
    rows.forEach((row, index) => grid.appendChild(tile(row, index)));
    fill(host,
      h('p.photo-hint.dim', 'Touch and hold a photo to move it. Photos play in this order.'),
      grid,
    );
    wireReorder(grid, () => rows, (next) => { rows = next; draw(); });
  }

  function tile(row, index) {
    const art = row.thumb
      ? h('img.photo-thumb', { src: objectUrl(row.thumb), alt: row.name || '', loading: 'lazy' })
      : h('div.photo-thumb.pending', icon('photo', { size: 24 }));

    return h('div.photo-tile.well', {
      dataset: { id: row.id },
      tabIndex: 0,
      role: 'listitem',
      'aria-label': `Photo ${index + 1} of ${rows.length}${row.name ? `, ${row.name}` : ''}`,
      /* Arrow keys move the focused tile. The drag is the way anyone
         will actually do this, but a gesture that can be missed should
         not be the only way in. */
      onkeydown: (e) => {
        const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!delta) return;
        e.preventDefault();
        const to = index + delta;
        if (to < 0 || to >= rows.length) return;
        const next = [...rows];
        next.splice(to, 0, next.splice(index, 1)[0]);
        rows = next;
        commit(rows);
        draw();
        $(`.photo-tile[data-id="${row.id}"]`)?.focus();
      },
    },
      art,
      h('span.photo-ordinal.num', String(index + 1)),
      h('button.photo-remove', {
        'aria-label': `Remove photo ${index + 1}`,
        onclick: async (e) => {
          e.stopPropagation();
          await photos.remove(row.id);
          rows = rows.filter((r) => r.id !== row.id);
          draw();
        },
      }, icon('close', { size: 18, stroke: 2.6 })),
    );
  }

  reload();
  return Object.assign(host, { reload });
}

const commit = (rows) => photos.reorder(rows.map((r) => r.id)).catch((err) => {
  console.warn('[photos] could not save the new order', err);
  toast('Could not save the new order', 'warn');
});

/**
 * Photos carried over from the old single-store database have no
 * thumbnail. Make them one at a time, in the background, writing each
 * back so it only ever happens once.
 */
async function backfillThumbs(rows, redraw) {
  const missing = rows.filter((r) => !r.thumb);
  if (!missing.length) return;
  for (const row of missing) {
    const full = await photos.blob(row.id);
    if (!full) continue;
    const { blob, w, h: height } = await downscale(full, THUMB_EDGE, 0.78);
    row.thumb = blob;
    row.w = row.w || w;
    row.h = row.h || height;
    await photos.setThumb(row.id, blob, row.w, row.h);
  }
  redraw();
}

/* ── Hold to pick up, drag to place ───────────────────────────
   The trick that makes a *wrapped* grid work is measuring every tile
   once at lift. The slot to the left of the first tile in a row is the
   last tile of the row above — no amount of arithmetic on an index will
   tell you where that is, but the rectangles already know. */

function wireReorder(grid, getRows, setRows) {
  const tiles = () => [...grid.children];

  for (const el of tiles()) {
    onLongPress(el, (event) => lift(el, event), { ms: 500, slop: 12 });
  }

  function lift(el, startEvent) {
    const all = tiles();
    const rects = all.map((t) => t.getBoundingClientRect());
    const from = all.indexOf(el);
    if (from < 0) return;

    let to = from;
    const origin = { x: startEvent.clientX, y: startEvent.clientY };

    grid.classList.add('reordering');
    el.classList.add('lifted');
    el.setPointerCapture?.(startEvent.pointerId);

    const move = (e) => {
      /* Ours now — without this the panel scrolls out from under the
         photo the moment the drag turns vertical. */
      e.preventDefault();
      el.style.transform =
        `translate(${e.clientX - origin.x}px, ${e.clientY - origin.y}px) scale(1.06)`;

      const over = rects.findIndex((r) =>
        e.clientX >= r.left && e.clientX <= r.right &&
        e.clientY >= r.top && e.clientY <= r.bottom);
      if (over < 0 || over === to) return;

      to = over;
      /* Everything between the tile's old slot and its new one shuffles
         along by exactly one place, and one place is the difference
         between two measured rectangles. */
      all.forEach((other, i) => {
        if (other === el) return;
        let shift = 0;
        if (from < to && i > from && i <= to) shift = -1;
        else if (from > to && i >= to && i < from) shift = 1;
        if (!shift) { other.style.transform = ''; return; }
        const target = rects[i + shift];
        other.style.transform =
          `translate(${target.left - rects[i].left}px, ${target.top - rects[i].top}px)`;
      });
    };

    const drop = (e) => {
      el.releasePointerCapture?.(e.pointerId);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', drop);
      window.removeEventListener('pointercancel', abort);

      grid.classList.remove('reordering');
      el.classList.remove('lifted');
      for (const other of all) other.style.transform = '';

      if (to === from) return;
      const next = [...getRows()];
      next.splice(to, 0, next.splice(from, 1)[0]);
      commit(next);
      setRows(next);
    };

    /* A cancelled pointer — a phone call, a second finger, the app
       going to the background — must put everything back and write
       nothing. Half a reorder saved is worse than none. */
    const abort = () => {
      to = from;
      drop({ pointerId: startEvent.pointerId });
    };

    // Park it where it already is, so the first move doesn't jump.
    el.style.transform = 'translate(0px, 0px) scale(1.06)';

    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', drop);
    window.addEventListener('pointercancel', abort);
  }
}

/* ── Adding ───────────────────────────────────────────────────
   Exported so the settings tab owns the button and this module owns
   what the button does. */

export async function addPhotos(files, onProgress) {
  let added = 0;
  /* One at a time. Resizing is canvas work on the main thread, and a
     dozen four-thousand-pixel photos decoded at once is how you make an
     iPad stop responding to touch. */
  for (const file of files) {
    try {
      const ready = await prepare(file);
      await photos.add(ready, file.name);
      added++;
      onProgress?.(added, files.length);
    } catch (err) {
      console.warn('[photos] could not add', file.name, err);
    }
  }
  const failed = files.length - added;
  if (failed) toast(`${failed} photo${failed > 1 ? 's' : ''} could not be added`, 'warn');
  return added;
}

/* Tiny DOM helpers. Everything in the hub is built with `h`. */

/**
 * h('div.card.tappable', { onclick, dataset:{}, style:{} }, ...children)
 * Children may be nodes, strings, numbers, or arrays; null/false/undefined
 * are skipped so `cond && h(...)` works inline.
 */
export function h(spec, props, ...children) {
  const [tag, ...classes] = String(spec).split('.');
  const el = document.createElement(tag || 'div');
  if (classes.length) el.className = classes.join(' ');

  if (props && (props.nodeType || typeof props !== 'object' || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }

  for (const key in props) {
    const val = props[key];
    if (val == null || val === false) continue;
    if (key === 'class') el.className += (el.className ? ' ' : '') + val;
    else if (key === 'style' && typeof val === 'object') applyStyle(el, val);
    else if (key === 'dataset') Object.assign(el.dataset, val);
    else if (key === 'html') el.innerHTML = val;
    else if (key.startsWith('on') && typeof val === 'function') {
      el.addEventListener(key.slice(2), val);
    } else if (key in el && key !== 'list' && typeof val !== 'boolean') {
      try { el[key] = val; } catch { el.setAttribute(key, val); }
    } else {
      el.setAttribute(key, val === true ? '' : val);
    }
  }

  append(el, children);
  return el;
}

/**
 * Assigning a `--custom-property` key onto element.style is silently
 * ignored — custom properties only go in through setProperty. Widgets
 * pass per-instance colours that way (--chip, --ring, --storm), so this
 * routes them correctly instead of dropping them.
 */
function applyStyle(el, styles) {
  for (const key in styles) {
    const value = styles[key];
    if (value == null) continue;
    if (key.startsWith('--')) el.style.setProperty(key, value);
    else el.style[key] = value;
  }
}

export function append(el, children) {
  for (const child of children.flat(4)) {
    if (child == null || child === false || child === true) continue;
    el.appendChild(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return el;
}

/** Replace an element's contents in one shot. */
export function fill(el, ...children) {
  el.textContent = '';
  return append(el, children);
}

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Inline SVG from a path string (all icons in icons.js use this). */
export function svg(paths, { size = 24, box = 24, stroke = 2, fill = 'none' } = {}) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute('viewBox', `0 0 ${box} ${box}`);
  node.setAttribute('width', size);
  node.setAttribute('height', size);
  node.setAttribute('fill', fill);
  node.setAttribute('stroke', 'currentColor');
  node.setAttribute('stroke-width', stroke);
  node.setAttribute('stroke-linecap', 'round');
  node.setAttribute('stroke-linejoin', 'round');
  node.innerHTML = paths;
  return node;
}

/** requestAnimationFrame as a promise, for reliable FLIP sequencing. */
export const nextFrame = () =>
  new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

/** Resolve once every transition on `el` has settled (with a safety timeout). */
export function transitionEnd(el, timeout = 1200) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.removeEventListener('transitionend', finish);
      resolve();
    };
    el.addEventListener('transitionend', finish);
    setTimeout(finish, timeout);
  });
}

let toastHost;
export function toast(message, kind = '') {
  toastHost ||= document.getElementById('toasts');
  if (!toastHost) return;
  const el = h(`div.toast${kind ? '.' + kind : ''}`, message);
  toastHost.appendChild(el);
  setTimeout(() => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 400);
  }, kind === 'error' ? 5200 : 3200);
}

/**
 * Long-press helper — used for "hold to delete" affordances so a wall
 * display doesn't need tiny X buttons everywhere.
 */
export function onLongPress(el, handler, ms = 550) {
  let timer = null;
  const cancel = () => { clearTimeout(timer); timer = null; el.classList.remove('holding'); };
  el.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    el.classList.add('holding');
    timer = setTimeout(() => { cancel(); handler(e); }, ms);
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave', 'pointermove']) {
    el.addEventListener(ev, cancel);
  }
}

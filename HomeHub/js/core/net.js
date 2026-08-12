/* Networking.

   A wall display is left running for weeks, so every fetch here is
   built to degrade rather than fail: timeouts, bounded retries, and a
   stale-while-error cache that keeps yesterday's forecast on screen
   instead of an error state when the Wi-Fi drops.

   Some upstreams (weather.gov wants a real User-Agent, nhc.noaa.gov and
   calendar feeds send no CORS headers) are routed through the bundled
   Netlify function. If the site is hosted somewhere without functions,
   the first proxy failure flips `proxyUp` and everything falls back to
   direct requests. */

import { nativeHas, nativeFetchText } from './native.js';

const PROXY = '/.netlify/functions/proxy';
const memory = new Map();     // url → { at, data }
let proxyUp = null;           // null = untested, true/false once known

export const online = () => navigator.onLine !== false;

/** Wrap a URL for the proxy function. */
export const viaProxy = (url) => `${PROXY}?url=${encodeURIComponent(url)}`;

class HttpError extends Error {
  constructor(status, url, body) {
    super(`HTTP ${status} for ${url}`);
    this.status = status;
    this.url = url;
    this.body = body;
  }
}
export { HttpError };

function withTimeout(ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DOMException('Timeout', 'TimeoutError')), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(timer) };
}

async function once(url, { timeout = 12000, headers, text = false } = {}) {
  const t = withTimeout(timeout);
  try {
    const res = await fetch(url, {
      signal: t.signal,
      headers: { Accept: text ? 'text/calendar, text/plain, */*' : 'application/json, */*', ...headers },
      cache: 'no-store',
      credentials: 'omit',
    });
    if (!res.ok) throw new HttpError(res.status, url, await res.text().catch(() => ''));
    return text ? res.text() : res.json();
  } finally {
    t.done();
  }
}

/**
 * Fetch with retry, caching, and optional proxying.
 *
 * @param {string} url
 * @param {object} opts
 * @param {number} opts.ttl      serve from cache for this many ms (default 5 min)
 * @param {boolean} opts.proxy   route via the Netlify function
 * @param {boolean} opts.text    resolve to text instead of JSON
 * @param {number} opts.retries  network-error retries (default 2)
 * @param {number} opts.staleFor how long a cached value may be served after an error
 */
export async function get(url, opts = {}) {
  const {
    ttl = 5 * 60e3,
    proxy = false,
    text = false,
    retries = 2,
    timeout = 12000,
    headers,
    staleFor = 6 * 3600e3,
  } = opts;

  const key = (proxy ? 'p:' : '') + url;
  const hit = memory.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttl) return hit.data;

  /* In the native app every request goes through Swift. Requests made
     there have no origin and therefore no CORS at all, which removes
     both the server-side proxy and any question about what a custom
     scheme is allowed to reach. Tiles still load directly as images —
     the map never reads their pixels, so they need no CORS either. */
  if (nativeHas('fetch')) {
    try {
      const body = await nativeFetchText(url);
      const data = text ? body : JSON.parse(body);
      memory.set(key, { at: now, data });
      return data;
    } catch (err) {
      if (hit && now - hit.at < staleFor) return hit.data;
      throw err;
    }
  }

  const target = proxy && proxyUp !== false ? viaProxy(url) : url;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const data = await once(target, { timeout, headers, text });
      memory.set(key, { at: now, data });
      if (proxy) proxyUp = true;
      return data;
    } catch (err) {
      lastErr = err;

      // The proxy isn't deployed here — remember, and retry direct.
      if (proxy && proxyUp === null && err instanceof HttpError && (err.status === 404 || err.status === 405)) {
        proxyUp = false;
        try {
          const data = await once(url, { timeout, headers, text });
          memory.set(key, { at: now, data });
          return data;
        } catch (directErr) {
          lastErr = directErr;
        }
      }

      // 4xx other than 408/429 won't fix themselves.
      if (err instanceof HttpError && err.status < 500 && err.status !== 408 && err.status !== 429) break;
      if (attempt < retries) await sleep(500 * 2 ** attempt + Math.random() * 250);
    }
  }

  // Better a slightly old forecast than an empty screen.
  if (hit && now - hit.at < staleFor) {
    console.warn(`[net] serving stale ${url}`, lastErr?.message);
    hit.stale = true;
    return hit.data;
  }
  throw lastErr;
}

export const getText = (url, opts = {}) => get(url, { ...opts, text: true });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Was the last value for this URL served from a stale cache? */
export const isStale = (url, proxy = false) => !!memory.get((proxy ? 'p:' : '') + url)?.stale;

export function clearCache(prefix) {
  if (!prefix) return memory.clear();
  for (const key of memory.keys()) if (key.includes(prefix)) memory.delete(key);
}

/**
 * Run an async producer on an interval, immediately and then repeatedly,
 * pausing while the tab is hidden and refreshing the moment it returns.
 * Every live data source in the hub is driven by one of these.
 */
export function poll(fn, intervalMs, { immediate = true } = {}) {
  let timer = null;
  let stopped = false;
  let running = false;

  async function tick() {
    if (stopped || running) return;
    running = true;
    try { await fn(); }
    catch (err) { console.warn('[poll] failed', err); }
    finally {
      running = false;
      if (!stopped) timer = setTimeout(tick, intervalMs);
    }
  }

  function onVisible() {
    if (document.visibilityState === 'visible' && !stopped) {
      clearTimeout(timer);
      tick();
    }
  }
  document.addEventListener('visibilitychange', onVisible);
  addEventListener('online', onVisible);

  if (immediate) tick();
  else timer = setTimeout(tick, intervalMs);

  return () => {
    stopped = true;
    clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisible);
    removeEventListener('online', onVisible);
  };
}

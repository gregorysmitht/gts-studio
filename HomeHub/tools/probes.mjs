#!/usr/bin/env node
/* Probe runner: concurrent, loud, and impossible to mistake for hung.
 *
 * The old way was `for t in …; do node $t.mjs; done` — fifteen probes in
 * sequence, several of them deliberate soak tests that sit and watch the
 * app for a minute or more, all of it silent until the end. It looked
 * frozen every single time, because for minutes at a stretch it was
 * indistinguishable from frozen.
 *
 *   node tools/probes.mjs                fast tier (default)
 *   node tools/probes.mjs --all          fast tier + the soaks
 *   node tools/probes.mjs wxcard music-smoke     just these
 *   node tools/probes.mjs --dir /path/to/probes
 *
 * Prints a line the moment each probe finishes, runs three at a time
 * (each launches its own Chromium — more just thrashes the CPU), and
 * kills anything that passes the per-probe timeout instead of waiting
 * on it forever. Exits nonzero if anything failed.
 */

import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';

/* Soaks watch the app do nothing on purpose (idle chatter, burn-in
   drift). They are minutes each by design — run them when the subsystem
   they soak has changed, not on every pass. */
const SOAK = new Set(['ambient-burnin', 'bridge-chatter', 'music-feedback']);
/* One-off debugging scripts that live beside the real probes. */
const SKIP = new Set(['dbg', 'alert-debug', 'fade-probe', 'ambient-shot',
  'device-tab', 'host-sim', 'iframe-sim', 'icon1024']);

const CONCURRENCY = 3;
const TIMEOUT_S = 150;

const args = process.argv.slice(2);
const all = args.includes('--all');
const dirIx = args.indexOf('--dir');
const dir = dirIx >= 0 ? args[dirIx + 1] : process.cwd();
const named = args.filter((a, i) =>
  !a.startsWith('--') && (dirIx < 0 || i !== dirIx + 1));

const available = readdirSync(dir)
  .filter((f) => f.endsWith('.mjs'))
  .map((f) => f.replace(/\.mjs$/, ''))
  .filter((n) => n !== 'probes' && !n.startsWith('lib'));

const chosen = named.length
  ? named
  : available.filter((n) => !SKIP.has(n) && (all || !SOAK.has(n)));

const missing = chosen.filter((n) => !available.includes(n));
if (missing.length) {
  console.error(`not found in ${dir}: ${missing.join(', ')}`);
  process.exit(2);
}

console.log(`${chosen.length} probes, ${CONCURRENCY} at a time, ${TIMEOUT_S}s cap each\n`);

const queue = [...chosen];
const results = [];
const t0 = Date.now();

function runOne(name) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('node', [path.join(dir, `${name}.mjs`)], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });

    const killer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_S * 1000);
    child.on('close', (code, signal) => {
      clearTimeout(killer);
      const secs = Math.round((Date.now() - started) / 1000);
      const verdict = signal === 'SIGKILL' ? 'TIMEOUT'
        : code === 0 ? 'ok' : 'FAIL';
      console.log(`  ${verdict.padEnd(7)} ${name} (${secs}s)`);
      resolve({ name, verdict, out });
    });
  });
}

async function worker() {
  while (queue.length) results.push(await runOne(queue.shift()));
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const bad = results.filter((r) => r.verdict !== 'ok');
console.log(`\n${results.length - bad.length}/${results.length} ok in ${Math.round((Date.now() - t0) / 1000)}s`);
for (const r of bad) {
  console.log(`\n── ${r.name} (${r.verdict}) ─ last output ──`);
  console.log(r.out.split('\n').slice(-15).join('\n'));
}
process.exit(bad.length ? 1 : 0);

#!/usr/bin/env node
/* Bundle the hub into a single self-contained HTML file.
 *
 * The app deliberately has no build step — it ships as plain ES modules
 * because that keeps it editable on any machine with a text editor. This
 * script exists only for contexts that can serve exactly one file: a
 * Claude Artifact preview, an email attachment, a USB stick.
 *
 * It is a real (if small) bundler rather than a concatenation, because
 * concatenating module bodies into one scope would collide on the dozen
 * local `draw` / `render` / `detail` helpers. Each module keeps its own
 * function scope and exchanges values through a tiny registry.
 *
 * Requires the import graph to be acyclic — `npm run check:cycles`
 * equivalent is built in below and the script refuses to run otherwise.
 *
 *   node tools/bundle.js [outfile]
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ENTRY = 'js/main.js';

/* ── Module graph ─────────────────────────────────────────── */

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const resolve = (fromRel, spec) =>
  path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));

/** Every `from '...'` specifier in a module, in source order. */
function depsOf(src, rel) {
  return [...src.matchAll(/(?:^|\n)\s*(?:import|export)[^'"\n]*?from\s*['"]([^'"]+)['"]/g)]
    .map((m) => resolve(rel, m[1]));
}

function collect(entry) {
  const seen = new Map();
  const order = [];
  const visiting = new Set();

  (function walk(rel) {
    if (seen.has(rel)) return;
    if (visiting.has(rel)) {
      throw new Error(`Import cycle through ${rel} — bundling needs an acyclic graph`);
    }
    visiting.add(rel);
    const src = read(rel);
    for (const dep of depsOf(src, rel)) walk(dep);
    visiting.delete(rel);
    seen.set(rel, src);
    order.push(rel);          // dependencies first
  })(entry);

  return order.map((rel) => [rel, seen.get(rel)]);
}

/* ── Module → registry factory ────────────────────────────── */

function transform(src, rel) {
  let out = src;

  // `export { A as B } from './x.js'` — re-export
  out = out.replace(
    /(?:^|\n)\s*export\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]\s*;?/g,
    (_, names, spec) => {
      const dep = resolve(rel, spec);
      const assigns = names.split(',').map((part) => {
        const [from, to = from] = part.split(/\s+as\s+/).map((s) => s.trim());
        return `__x.${to} = __req(${JSON.stringify(dep)}).${from};`;
      }).join(' ');
      return `\n${assigns}`;
    }
  );

  // `import { a, b as c } from './x.js'`
  out = out.replace(
    /(?:^|\n)\s*import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]\s*;?/g,
    (_, names, spec) => {
      const dep = resolve(rel, spec);
      const bindings = names.split(',').map((s) => s.trim()).filter(Boolean).join(', ');
      return `\nconst { ${bindings} } = __req(${JSON.stringify(dep)});`;
    }
  );

  // Bare `import './x.js'` — evaluate for side effects only
  out = out.replace(
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]\s*;?/g,
    (_, spec) => `\n__req(${JSON.stringify(resolve(rel, spec))});`
  );

  // `export const/let/function/async function/class NAME`
  const exported = [];
  out = out.replace(
    /(?:^|\n)(\s*)export\s+(const|let|var|async function|function|class)\s+([A-Za-z_$][\w$]*)/g,
    (_, indent, kind, name) => {
      exported.push(name);
      return `\n${indent}${kind} ${name}`;
    }
  );

  // `export { A, B as C }` (no `from`)
  out = out.replace(/(?:^|\n)\s*export\s*\{([^}]*)\}\s*;?/g, (_, names) => {
    const assigns = names.split(',').map((part) => {
      const [from, to = from] = part.split(/\s+as\s+/).map((s) => s.trim());
      if (!from) return '';
      return `__x.${to} = ${from};`;
    }).filter(Boolean).join(' ');
    return `\n${assigns}`;
  });

  // Publish the named declarations at the end, so hoisted functions and
  // late-initialised consts are both captured correctly.
  const tail = exported.map((n) => `__x.${n} = ${n};`).join('\n');
  return `${out}\n${tail}\n`;
}

/* ── Assemble ─────────────────────────────────────────────── */

function buildScript(modules) {
  const bodies = modules.map(([rel, src]) =>
    `__m[${JSON.stringify(rel)}] = function (__x, __req) {\n${transform(src, rel)}\n};`
  ).join('\n\n');

  return `
const __m = {};
const __c = {};
function __req(id) {
  if (id in __c) return __c[id];
  const __x = (__c[id] = {});
  __m[id](__x, __req);
  return __x;
}

${bodies}

__req(${JSON.stringify(ENTRY)});
`.trim();
}

/* The HTML tokenizer ends a <script> at the first `</script`, and it does
   not know about JavaScript comments or strings. mock-native.js documents
   its own usage with a literal script tag in its header comment, which
   silently truncated the bundle right there — everything after it was
   reparsed as HTML. Breaking the sequence is invisible to JS: in a string
   `<\/script` is just `</script`, and in a comment nothing reads it. */
const inlineable = (js) => js.replace(/<\/script/gi, () => '<\\/script');

function main() {
  const args = process.argv.slice(2);
  /* --fragment drops the document scaffolding, for hosts that supply
     their own <html>/<head>/<body> and inject this as page content. */
  const fragment = args.includes('--fragment');
  /* --mock bakes in the fake native bridge, so a single file can also
     demonstrate the parts that only exist inside the iPad app — today
     that means Apple Music. Never ship a --mock build to a real wall: it
     makes the hub believe it is running natively. */
  const mock = args.includes('--mock');
  const outPath = args.find((a) => !a.startsWith('--'))
    || path.join(ROOT, 'dist', 'homehub-single.html');
  let html = read('index.html');

  // Inline stylesheets in document order.
  html = html.replace(
    /[ \t]*<link rel="stylesheet" href="([^"]+)"\/?>\n?/g,
    (_, href) => `<style>\n/* ── ${href} ── */\n${read(href)}\n</style>\n`
  );

  // Drop everything that needs sibling files: manifest, icons, worker.
  html = html.replace(/[ \t]*<link rel="manifest"[^>]*>\n?/g, '');
  html = html.replace(/[ \t]*<link rel="(?:apple-touch-)?icon"[^>]*>\n?/g, '');
  html = html.replace(/[ \t]*<script type="module" src="[^"]+"><\/script>\n?/g, '');

  const modules = collect(ENTRY);
  const script = buildScript(modules)
    // A single-file build has no scope to register a worker from.
    .replace(/navigator\.serviceWorker\.register\('sw\.js'\)/,
             () => 'Promise.reject(new Error("single-file build"))');

  /* Function replacements throughout, never strings: a string replacement
     interprets `$$` as an escape for a literal `$`, which silently ate one
     dollar from every `$$` in the bundled source — including dom.js's
     querySelectorAll helper, which then collided with `$`. */
  /* The mock must be a classic script and must come first: it defines
     window.HomeHubNative, which core/native.js reads at module-eval time. */
  const bridge = mock ? `<script>\n${inlineable(read('tools/mock-native.js'))}\n</script>\n` : '';

  html = html.replace('</body>',
    () => `${bridge}<script type="module">\n${inlineable(script)}\n</script>\n</body>`);

  if (fragment) {
    /* A hub that asks for `height: 100%` needs a parent with a height.
       Embedding hosts commonly size their frame to the content instead,
       which makes that a fixed point: the frame stays at whatever height
       it started with, the hub fills exactly that, and the grid collapses.

       So state a real height, derived from the width the host *has*
       given us. 4:3 is the shape of the iPad this is designed for; the
       clamp keeps it sane in a narrow column and on a wide monitor. */
    html = html.replace('</body>', () => `<style>
html { height: clamp(520px, 75vw, 1040px); }
body { height: 100%; overflow: hidden; }
</style>\n</body>`);

    /* Keep <title> — hosts scan for it — but shed the scaffolding and the
       head-only metas, which do nothing once this is injected into a body. */
    html = html
      .replace(/<!DOCTYPE html>\s*/i, '')
      // \b matters: without it `head` also matches the front of `<header>`,
      // which silently deletes the top bar.
      .replace(/<\/?(?:html|head|body)\b[^>]*>\s*/gi, '')
      .replace(/[ \t]*<meta\b[^>]*>\n?/gi, '')
      .trim();
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html);

  const kb = (fs.statSync(outPath).size / 1024).toFixed(0);
  console.log(`${modules.length} modules → ${path.relative(ROOT, outPath)} (${kb} KB)`);
}

main();

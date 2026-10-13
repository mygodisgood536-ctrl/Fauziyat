/**
 * Portable visual-QA harness.
 *
 * Renders the built site in headless Chrome across a matrix of viewports and
 * writes screenshots plus an overflow / console report to qa/out/.
 *
 * Chrome clamps a headless window to roughly 500px wide, so anything narrower
 * is rendered inside a same-origin iframe (served in-memory at /__qa_frame)
 * rather than by resizing the browser window.
 *
 *   npm run qa              full matrix
 *   npm run qa -- --keep    keep previous output
 *   npm run qa -- --only=phone-hero,desktop-hero
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, stat, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
/* Point at the built artifact with QA_ROOT=dist to shoot what actually ships. */
const ROOT = process.env.QA_ROOT ? resolve(process.env.QA_ROOT) : dirname(HERE);
const OUT = join(HERE, 'out');
const PORT = Number(process.env.QA_PORT) || 4319;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

const CHROME = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!CHROME) {
  console.error('No Chrome/Chromium/Edge binary found. Set CHROME_PATH.');
  process.exit(1);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.woff2': 'font/woff2', '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/* The iframe harness: same-origin so the parent can measure the child. */
const FRAME = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>qa frame</title>
<style>html,body{margin:0;padding:0;background:#b9b2a8}</style></head>
<body><div id="stage"><iframe id="f" title="preview"></iframe></div>
<script>
(function () {
  var q = new URLSearchParams(location.search);
  var W = +(q.get('w') || 390), H = +(q.get('h') || 850);
  var stage = document.getElementById('stage'), f = document.getElementById('f');
  stage.style.cssText = 'width:' + W + 'px;height:' + H + 'px;overflow:hidden;background:#fff';
  f.style.cssText = 'display:block;width:100%;height:100%;border:0';
  f.src = q.get('src') || '/';
  var problems = [];
  function collect() {
    try {
      var w = f.contentWindow, d = f.contentDocument, de = d.documentElement;
      var vw = de.clientWidth, i, all = d.body.querySelectorAll('*');
      var out = ['VW=' + vw, 'SCROLLW=' + de.scrollWidth, 'DOC_H=' + de.scrollHeight];
      out.push('OVERFLOW=' + (de.scrollWidth > vw + 1 ? 'YES' : 'no'));
      var over = [];
      for (i = 0; i < all.length; i++) {
        var r = all[i].getBoundingClientRect();
        if (!r.width && !r.height) continue;
        if (r.right > vw + 1 || r.left < -1) {
          over.push(all[i].tagName + '.' + (all[i].getAttribute('class') || '-') +
            '[' + Math.round(r.left) + '..' + Math.round(r.right) + ']');
          if (over.length >= 8) break;
        }
      }
      if (over.length) out.push('BLEED=' + over.join(' '));
      var t = d.querySelector('[data-nav-toggle]');
      out.push('NAVBTN=' + (t ? (w.getComputedStyle(t).display) : 'absent'));
      // Touch-target audit for every interactive control.
      var tap = d.querySelectorAll('a,button,[role="button"]'), small = [];
      for (i = 0; i < tap.length; i++) {
        var b = tap[i].getBoundingClientRect();
        if (!b.width && !b.height) continue;
        if (b.height < 40) {
          small.push((tap[i].tagName + '.' + (tap[i].getAttribute('class') || '-'))
            .replace(/\\s+/g, '.') + '=' + Math.round(b.height) + 'px');
          if (small.length >= 10) break;
        }
      }
      if (small.length) out.push('SMALLTAP=' + small.join(' '));
      document.title = 'DIAG:: ' + out.join(' | ');
    } catch (e) { document.title = 'DIAG:: error ' + e.message; }
  }
  f.addEventListener('load', function () {
    setTimeout(function () {
      if (q.get('click')) {
        var t = f.contentDocument.querySelector('[data-nav-toggle]');
        if (t) t.click();
      }
      var sc = q.get('scroll');
      if (sc) {
        var d = f.contentDocument;
        if (/^[0-9]+$/.test(sc)) f.contentWindow.scrollTo(0, parseInt(sc, 10));
        else {
          var el = d.querySelector(sc);
          if (el) {
            var top = el.getBoundingClientRect().top + d.documentElement.scrollTop - 88;
            f.contentWindow.scrollTo(0, Math.max(0, top));
          }
        }
      }
    }, 200);
    setTimeout(collect, 1200);
  });
})();
</script></body></html>`;

/* Static server rooted at the repo (or at dist/, via QA_ROOT). The iframe
   harness is served from memory so no scratch file is written into the tree
   and the harness works whatever directory is being shot. */
const FRAME_ROUTE = '/__qa_frame';

const server = createServer(async (req, res) => {
  try {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel === FRAME_ROUTE) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(FRAME);
      return;
    }
    if (rel.endsWith('/')) rel += 'index.html';
    const path = join(ROOT, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!path.startsWith(ROOT)) throw new Error('escape');
    const info = await stat(path);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': TYPES[extname(path).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
  }
});

/* Chrome spawns helpers that inherit stdio, so 'close' can never fire. */
function chrome(args, timeoutMs = 90000) {
  return new Promise((resolve) => {
    const p = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => {
      try { p.kill('SIGKILL'); } catch { /* already gone */ }
      resolve({ code: -9, out: `${out} [TIMEOUT]` });
    }, timeoutMs);
    p.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out: String(e) }); });
    p.on('exit', (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}

const frameUrl = (w, h, extra = '') =>
  `http://127.0.0.1:${PORT}${FRAME_ROUTE}?src=${encodeURIComponent('/')}` +
  `&w=${w}&h=${h}${extra}`;

const MATRIX = [
  { n: 'phone-320', w: 320, h: 800 },
  { n: 'phone-360', w: 360, h: 800 },
  { n: 'phone-390', w: 390, h: 844 },
  { n: 'phone-430', w: 430, h: 932 },
  { n: 'phone-about', w: 390, h: 844, scroll: '#about' },
  { n: 'phone-experience', w: 390, h: 844, scroll: '#experience' },
  { n: 'phone-expertise', w: 390, h: 844, scroll: '#expertise' },
  { n: 'phone-visibility', w: 390, h: 844, scroll: '#visibility' },
  { n: 'phone-presence', w: 390, h: 844, scroll: '#presence' },
  { n: 'phone-contact', w: 390, h: 844, scroll: '#contact' },
  { n: 'phone-nav-open', w: 390, h: 760, extra: '&click=1' },
  { n: 'tablet-768', w: 768, h: 1024 },
  { n: 'tablet-about', w: 768, h: 1024, scroll: '#about' },
  { n: 'tablet-expertise', w: 768, h: 1024, scroll: '#expertise' },
  { n: 'tablet-visibility', w: 768, h: 1024, scroll: '#visibility' },
  { n: 'tablet-contact', w: 768, h: 1024, scroll: '#contact' },
  { n: 'laptop-1024', w: 1024, h: 768, dpr: 1 },
  { n: 'laptop-expertise', w: 1024, h: 768, dpr: 1, scroll: '#expertise' },
  { n: 'laptop-nav', w: 1024, h: 768, dpr: 1, extra: '&click=1' },
  { n: 'desktop-1440', w: 1440, h: 900, dpr: 1 },
  { n: 'desktop-1920', w: 1920, h: 1080, dpr: 1 },
  { n: 'desktop-about', w: 1440, h: 900, dpr: 1, scroll: '#about' },
  { n: 'desktop-experience', w: 1440, h: 900, dpr: 1, scroll: '#experience' },
  { n: 'desktop-expertise', w: 1440, h: 900, dpr: 1, scroll: '#expertise' },
  { n: 'desktop-visibility', w: 1440, h: 900, dpr: 1, scroll: '#visibility' },
  { n: 'desktop-presence', w: 1440, h: 900, dpr: 1, scroll: '#presence' },
  { n: 'desktop-contact', w: 1440, h: 900, dpr: 1, scroll: '#contact' },
  { n: 'desktop-footer', w: 1440, h: 900, dpr: 1, scroll: '99999' },
];

const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);
const fresh = !process.argv.includes('--keep');

await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
if (fresh) await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const BASE = [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-background-networking', '--force-prefers-reduced-motion',
  '--virtual-time-budget=2500',
];

async function run(entry, slot) {
  // Windows Chrome starves under heavy parallel load and times out with no
  // screenshot, which looks identical to a broken page. Retry once, serially,
  // before recording a failure.
  for (let attempt = 0; attempt < 2; attempt++) {
    const line = await attemptRun(entry, slot + attempt * 20);
    if (!line.includes('FAIL')) return line;
  }
  return `FAIL ${entry.n} after retry`;
}

async function attemptRun(entry, slot) {
  // Chrome keeps its profile locked for a moment after exit, so profiles live
  // in TEMP and cleanup is best-effort rather than fatal.
  const profile = join(tmpdir(), `fauziyat-qa-${slot}`);
  const dpr = entry.dpr || 2;
  // Always render inside the iframe: a direct hash navigation races Chrome's
  // virtual-time budget and yields blank screenshots, whereas scrolling the
  // child explicitly is deterministic at every width.
  const url = frameUrl(entry.w, entry.h, (entry.extra || '') +
    (entry.scroll ? `&scroll=${encodeURIComponent(entry.scroll)}` : ''));
  const winW = entry.w + 140;
  const flags = [...BASE, `--user-data-dir=${profile}`,
    `--force-device-scale-factor=${dpr}`, `--window-size=${winW},${entry.h}`];

  if (entry.measure) {
    const { out } = await chrome([...flags, '--dump-dom', url]);
    const m = out.match(/<title>DIAG::([\s\S]*?)<\/title>/);
    return `MEASURE ${String(entry.w).padStart(4)}px  ${m ? m[1].trim() : 'NO DIAG'}`;
  }

  const png = join(OUT, `${entry.n}.png`);
  const { out } = await chrome([...flags, `--screenshot=${png}`, url]);
  let bytes = 0;
  try { bytes = (await stat(png)).size; } catch { /* not produced */ }
  await rm(profile, { recursive: true, force: true }).catch(() => { /* still locked */ });
  const flag = bytes ? 'ok  ' : 'FAIL';
  return `${entry.n.padEnd(20)} ${String(entry.w).padStart(4)}x${entry.h} dpr${dpr}  ${flag} ${bytes}B` +
    (bytes ? '' : `  ${out.slice(0, 160)}`);
}

const queue = [
  ...MATRIX,
  { measure: true, w: 320 }, { measure: true, w: 360 }, { measure: true, w: 390 },
  { measure: true, w: 768 }, { measure: true, w: 1024 }, { measure: true, w: 1440 },
].filter((e) => !only || only.split(',').includes(e.n) || e.measure);

const CONCURRENCY = 3;
const lines = [];
for (let i = 0; i < queue.length; i += CONCURRENCY) {
  const chunk = queue.slice(i, i + CONCURRENCY);
  const done = await Promise.all(chunk.map((e, k) => run(e, i + k)));
  lines.push(...done);
  await writeFile(join(OUT, 'report.txt'), lines.join('\n'), 'utf8');
}

await writeFile(join(OUT, 'report.txt'), lines.join('\n'), 'utf8');
server.close();
console.log(lines.join('\n'));
console.log(`\n${lines.filter((l) => l.includes('FAIL')).length} failures. Output: ${OUT}`);
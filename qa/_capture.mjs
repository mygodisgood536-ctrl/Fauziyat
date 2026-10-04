// Temporary QA harness: renders the site inside a sized iframe so we can
// capture genuine narrow viewports (Chrome clamps headless windows to ~485px).
const HARNESS = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>frame</title>
<style>html,body{margin:0;padding:0;background:#cfc9c0;}</style></head>
<body>
<div id="stage"><iframe id="f" title="preview"></iframe></div>
<script>
(function () {
  var q = new URLSearchParams(location.search);
  var W = +(q.get('w') || 390), H = +(q.get('h') || 850);
  var stage = document.getElementById('stage'), f = document.getElementById('f');
  stage.style.cssText = 'width:' + W + 'px;height:' + H + 'px;overflow:hidden;background:#fff';
  f.style.cssText = 'display:block;width:100%;height:100%;border:0';
  f.src = q.get('src') || '/';

  function report() {
    try {
      var w = f.contentWindow, d = w.document, de = d.documentElement;
      var vw = de.clientWidth, out = [];
      out.push('VW=' + vw, 'SCROLLW=' + de.scrollWidth, 'DOC_H=' + de.scrollHeight);
      out.push('MQ400=' + w.matchMedia('(max-width:400px)').matches);
      out.push('MQ899=' + w.matchMedia('(max-width:899px)').matches);
      var t = d.querySelector('[data-nav-toggle]');
      out.push('TOGGLE=' + (t ? w.getComputedStyle(t).display : 'absent'));
      var all = d.body.querySelectorAll('*'), n = 0;
      for (var i = 0; i < all.length; i++) {
        var r = all[i].getBoundingClientRect();
        if (!r.width && !r.height) continue;
        if (r.right > vw + 1 || r.left < -1) {
          out.push('OVF ' + all[i].tagName + '.' + (all[i].getAttribute('class') || '') +
            ' L=' + Math.round(r.left) + ' R=' + Math.round(r.right));
          if (++n > 15) break;
        }
      }
      out.push('OVFCOUNT=' + n);
      document.title = 'DIAG:: ' + out.join(' | ');
    } catch (e) { document.title = 'DIAG:: error ' + e.message; }
  }

  f.addEventListener('load', function () {
    if (q.get('click')) {
      setTimeout(function () {
        var t = f.contentDocument.querySelector('[data-nav-toggle]');
        if (t) t.click();
      }, 150);
    }
    // Scroll explicitly rather than trusting in-iframe anchor timing.
    var sc = q.get('scroll');
    if (sc) {
      setTimeout(function () {
        var d = f.contentDocument;
        if (/^[0-9]+$/.test(sc)) {
          f.contentWindow.scrollTo(0, parseInt(sc, 10));
        } else {
          var el = d.querySelector(sc);
          if (el) {
            var top = el.getBoundingClientRect().top + d.documentElement.scrollTop - 88;
            f.contentWindow.scrollTo(0, Math.max(0, top));
          }
        }
      }, 450);
    }
    setTimeout(report, 1400);
  });
})();
</script>
</body></html>`;
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, stat, rm, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const SITE = 'C:\\Users\\adede\\.cline\\data\\workspaces\\chat\\fauziyat-folashade-site';
const SHOTS = 'C:\\Users\\adede\\.cline\\data\\workspaces\\chat\\shots';
const LOG = 'C:\\Users\\adede\\.cline\\data\\workspaces\\chat\\_shots_log.txt';
const DUMP = 'C:\\Users\\adede\\.cline\\data\\workspaces\\chat\\_diag_dump.txt';
const PROFILE = join(process.env.TEMP || 'C:\\Temp', 'cline-shot-profile');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.woff2': 'font/woff2', '.xml': 'application/xml; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const path = join(SITE, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!path.startsWith(SITE)) throw new Error('escape');
    const info = await stat(path);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': TYPES[extname(path).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

await new Promise((r) => server.listen(4173, '127.0.0.1', r));
await writeFile(join(SITE, '_frame.html'), HARNESS, 'utf8');
// Only wipe on a full run; a trimmed queue must not delete shots it won't regenerate.
if (process.env.FRESH !== '0') await rm(SHOTS, { recursive: true, force: true });
await mkdir(SHOTS, { recursive: true });
await rm(PROFILE, { recursive: true, force: true });
for (let i = 0; i < 24; i++) await rm(`${PROFILE}-${i}`, { recursive: true, force: true });

// Chrome spawns helper processes that inherit stdout/stderr, so the 'close'
// event can hang forever. Resolve on 'exit' with a hard timeout instead.
function runChrome(args, timeoutMs = 40000) {
  return new Promise((resolve) => {
    const p = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => {
      try { p.kill('SIGKILL'); } catch { /* gone */ }
      resolve({ code: -9, out: out + ' [TIMEOUT]' });
    }, timeoutMs);
    p.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out: String(e) }); });
    p.on('exit', (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}

// Chrome clamps headless windows to ~485px, so the 390px phone width is rendered
// inside a same-origin iframe via _frame.html. window-size is in CSS pixels.
const frame = (src, w, h, extra = '') =>
  `http://127.0.0.1:4173/_frame.html?src=${encodeURIComponent(src || '/')}&w=${w}&h=${h}${extra || ''}`;

const SHOTS_LIST = [
  { n: 'phone-hero', w: 390, h: 850, src: '/' },
  { n: 'phone-portrait', w: 390, h: 850, src: '/', scroll: '.hero__figure' },
  { n: 'phone-about', w: 390, h: 850, src: '/', scroll: '#about' },
  { n: 'phone-experience', w: 390, h: 850, src: '/', scroll: '#experience' },
  { n: 'phone-expertise', w: 390, h: 900, src: '/', scroll: '#expertise' },
  { n: 'phone-visibility', w: 390, h: 1000, src: '/', scroll: '#visibility' },
  { n: 'phone-presence', w: 390, h: 850, src: '/', scroll: '#presence' },
  { n: 'phone-contact', w: 390, h: 850, src: '/', scroll: '#contact' },
  { n: 'phone-navopen', w: 390, h: 760, src: '/', extra: '&click=1' },
  { n: 'tablet-hero', w: 820, h: 900, mode: 'direct', src: '/' },
  { n: 'tablet-about', w: 820, h: 900, mode: 'direct', src: '/#about' },
  { n: 'tablet-expertise', w: 820, h: 900, mode: 'direct', src: '/#expertise' },
  { n: 'tablet-presence', w: 820, h: 900, mode: 'direct', src: '/#presence' },
  { n: 'desktop-hero', w: 1440, h: 900, mode: 'direct', src: '/', dpr: 1 },
  { n: 'desktop-about', w: 1440, h: 1000, mode: 'direct', src: '/#about', dpr: 1 },
];

const base = ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-background-networking',
  // Force the reduced-motion path so .reveal elements are fully rendered
  // (and transitions are instant) instead of catching them mid-fade.
  '--force-prefers-reduced-motion',
  '--virtual-time-budget=3000'];
const lines = [];
// Write incrementally so partial progress survives an interrupted run.
const flush = () => writeFile(LOG, lines.join('\n'), 'utf8');

/** Capture one entry. `slot` gives each parallel Chrome its own profile dir. */
async function capture(s, slot) {
  const dpr = s.dpr || 2;
  const viaFrame = s.mode !== 'direct';
  // Outer window must clear Chrome's ~485px minimum width.
  const winW = viaFrame ? s.w + 130 : s.w;
  const url = viaFrame
    ? frame(s.src, s.w, s.h, (s.extra || '') +
        (s.scroll ? '&scroll=' + encodeURIComponent(s.scroll) : ''))
    : `http://127.0.0.1:4173${s.src}`;
  const flags = [...base, `--user-data-dir=${PROFILE}-${slot}`,
    `--force-device-scale-factor=${dpr}`, `--window-size=${winW},${s.h}`];

  if (s.measure) {
    const { out } = await runChrome([...flags, '--dump-dom', url]);
    const m = out.match(/<title>DIAG::([\s\S]*?)<\/title>/);
    return `MEASURE @${s.w}: ${m ? decodeEntities(m[1].trim()) : 'no diag title'}`;
  }

  const png = join(SHOTS, `${s.n}.png`);
  const { out } = await runChrome([...flags, `--screenshot=${png}`, url]);
  let bytes = 0;
  try { bytes = (await stat(png)).size; } catch { /* missing */ }
  return `${s.n.padEnd(18)} css=${s.w}x${s.h} dpr${dpr}  ${bytes ? 'OK' : 'FAIL'}  ${bytes}B  ${bytes ? '' : out.slice(0, 120)}`;
}

function decodeEntities(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
}

// Run in parallel chunks so the whole pass finishes in one command window.
const QUEUE = [
  ...SHOTS_LIST,
  { measure: true, w: 390, h: 900 },
  { measure: true, w: 360, h: 900 },
  { measure: true, w: 820, h: 900 },
];
// Run in small parallel chunks (5 is about what this box sustains without
// starving Chrome) and log each result as it resolves, so a partial run still
// leaves usable output on disk.
const CONCURRENCY = 5;

for (let i = 0; i < QUEUE.length; i += CONCURRENCY) {
  const chunk = QUEUE.slice(i, i + CONCURRENCY);
  await Promise.all(chunk.map((s, k) => capture(s, i + k).then(async (line) => {
    lines.push(line);
    await flush();
  })));
}

await writeFile(LOG, lines.join('\n'), 'utf8');
server.close();
console.log(lines.join('\n'));
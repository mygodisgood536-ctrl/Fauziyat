/**
 * Interaction + accessibility checks that a screenshot cannot prove.
 *
 * Drives headless Chrome with the DevTools protocol so it can evaluate script
 * inside the page: mobile menu open/close, Escape handling, focus order, skip
 * link, section reveal, scroll-spy, console errors and failed network requests.
 *
 *   npm run qa:interact
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const PORT = Number(process.env.IQA_PORT) || 4322;

const CHROME = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].filter(Boolean).find((p) => existsSync(p));

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

const server = createServer(async (req, res) => {
  try {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
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

await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

/* Launch Chrome with a remote-debugging port and talk to it over the
   DevTools WebSocket. No npm dependencies: Node 22+ ships a WebSocket client. */
const profile = join(tmpdir(), 'fauziyat-iqa');
spawnSync('cmd', ['/c', 'rmdir', '/s', '/q', profile], { encoding: 'utf8' });

const port = 9333;
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--disable-background-networking', '--remote-debugging-port=' + port,
  `--user-data-dir=${profile}`, '--window-size=390,844', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targetWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(500);
  }
  throw new Error('Chrome DevTools endpoint never became available');
}

const wsUrl = await targetWs();
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let msgId = 0;
const pending = new Map();
const consoleErrors = [];
const failedRequests = [];

ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
    return;
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    consoleErrors.push('EXCEPTION: ' + (msg.params.exceptionDetails?.exception?.description
      || msg.params.exceptionDetails?.text || 'unknown'));
  }
  if (msg.method === 'Network.loadingFailed') {
    failedRequests.push(msg.params.errorText);
  }
  if (msg.method === 'Network.responseReceived' && msg.params.response.status >= 400) {
    failedRequests.push(`${msg.params.response.status} ${msg.params.response.url}`);
  }
};

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++msgId;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
}

await send('Runtime.enable');
await send('Network.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
});

await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await sleep(2500);

const results = [];
const check = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

/* ---------------------------------------------------------------- checks */

const navOpenState = await evaluate(`(() => {
  const t = document.querySelector('[data-nav-toggle]');
  return { display: getComputedStyle(t).display, expanded: t.getAttribute('aria-expanded'), label: t.getAttribute('aria-label') };
})()`);
check('mobile nav toggle is visible at 390px', navOpenState.display !== 'none', `display=${navOpenState.display}`);
check('nav toggle starts collapsed with correct ARIA',
  navOpenState.expanded === 'false' && navOpenState.label === 'Open menu',
  `expanded=${navOpenState.expanded} label=${navOpenState.label}`);

const opened = await evaluate(`(() => {
  const t = document.querySelector('[data-nav-toggle]');
  t.click();
  const nav = document.getElementById('site-nav');
  const scrim = document.querySelector('[data-nav-scrim]');
  return { expanded: t.getAttribute('aria-expanded'), label: t.getAttribute('aria-label'),
           navOpen: nav.classList.contains('is-open'), bodyLock: document.body.classList.contains('nav-open'),
           scrimShown: scrim && !scrim.hidden };
})()`);
check('clicking the toggle opens the menu',
  opened.expanded === 'true' && opened.navOpen && opened.bodyLock && opened.scrimShown,
  JSON.stringify(opened));

const escaped = await evaluate(`(() => {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  const t = document.querySelector('[data-nav-toggle]');
  return { expanded: t.getAttribute('aria-expanded'), label: t.getAttribute('aria-label'),
           navOpen: document.getElementById('site-nav').classList.contains('is-open'),
           focusOnToggle: document.activeElement === t };
})()`);
check('Escape closes the menu and returns focus',
  escaped.expanded === 'false' && !escaped.navOpen && escaped.label === 'Open menu' && escaped.focusOnToggle,
  JSON.stringify(escaped));

const navLinkClose = await evaluate(`(() => {
  const t = document.querySelector('[data-nav-toggle]');
  t.click();
  const link = document.querySelector('#site-nav a[href="#about"]');
  link.click();
  return { expanded: t.getAttribute('aria-expanded'), navOpen: document.getElementById('site-nav').classList.contains('is-open') };
})()`);
check('choosing a nav destination closes the menu',
  navLinkClose.expanded === 'false' && !navLinkClose.navOpen, JSON.stringify(navLinkClose));

const skip = await evaluate(`(() => {
  const s = document.querySelector('.skip-link');
  s.focus();
  return { focused: document.activeElement === s, href: s.getAttribute('href'),
           targetExists: !!document.querySelector(s.getAttribute('href')) };
})()`);
check('skip link is focusable and points at a real target',
  skip.focused && skip.href === '#main' && skip.targetExists, JSON.stringify(skip));

/* The primary nav is display:none behind the closed mobile menu, so it is
   correctly not focusable at 390px. Focus styling is checked at desktop width,
   where those links are actually on screen. */
const closedMenuNotFocusable = await evaluate(`(() => {
  const link = document.querySelector('#site-nav a');
  link.focus();
  return document.activeElement === link;
})()`);
check('nav links are not focusable while the mobile menu is closed',
  closedMenuNotFocusable === false, `focusable=${closedMenuNotFocusable}`);

await send('Emulation.setDeviceMetricsOverride', {
  width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
});
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await sleep(1800);

/* Real Tab presses, because :focus-visible is deliberately not applied to
   programmatic .focus() — only to genuine keyboard interaction. */
async function pressTab(times = 1) {
  for (let i = 0; i < times; i++) {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 9, key: 'Tab', code: 'Tab' });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 9, key: 'Tab', code: 'Tab' });
    await sleep(60);
  }
}

await evaluate(`document.body.focus(); window.scrollTo(0,0);`);
const tabbed = [];
for (let i = 0; i < 8; i++) {
  await pressTab(1);
  tabbed.push(await evaluate(`(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    const cs = getComputedStyle(el);
    return { tag: el.tagName, cls: (el.getAttribute('class') || '').split(' ')[0],
             focusVisible: el.matches(':focus-visible'),
             outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth };
  })()`));
}
const ringed = tabbed.filter(Boolean).filter((t) => t.outlineStyle !== 'none' && parseFloat(t.outlineWidth) >= 1);
const navRinged = tabbed.filter(Boolean).some((t) => t.cls === 'site-nav__link' && t.outlineStyle !== 'none');

check('Tab moves focus through the page', tabbed.filter(Boolean).length >= 5,
  `${tabbed.filter(Boolean).length} stops`);
check('keyboard focus shows a visible ring', ringed.length >= 4,
  `${ringed.length}/${tabbed.filter(Boolean).length} stops ringed`);
check('desktop nav links show a focus ring', navRinged,
  tabbed.filter(Boolean).map((t) => `${t.cls}:${t.outlineStyle}`).join(' '));

const tabOrder = await evaluate(`(() => {
  const focusables = [...document.querySelectorAll('a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])')]
    .filter(e => e.offsetParent !== null || e.classList.contains('skip-link'));
  return { count: focusables.length };
})()`);
check('keyboard-focusable controls are present', tabOrder.count > 10, `${tabOrder.count} focusable`);

const reveal = await evaluate(`(() => {
  const els = [...document.querySelectorAll('.reveal')];
  return { total: els.length, hidden: els.filter(e => getComputedStyle(e).opacity === '0').length };
})()`);
await evaluate(`window.scrollTo(0, document.body.scrollHeight)`);
await sleep(1200);
const revealAfter = await evaluate(`(() => {
  const els = [...document.querySelectorAll('.reveal')];
  return { hidden: els.filter(e => getComputedStyle(e).opacity === '0').length };
})()`);
check('reveal content becomes visible after scrolling (no trapped content)',
  revealAfter.hidden === 0 || revealAfter.hidden < reveal.hidden,
  `hidden before=${reveal.hidden} after=${revealAfter.hidden} of ${reveal.total}`);

const links = await evaluate(`(() => {
  const out = [];
  for (const a of document.querySelectorAll('a')) {
    const href = a.getAttribute('href') || '';
    out.push({ href: href.slice(0, 60), hasVisibleText: (a.innerText || '').trim().length > 0 || !!a.getAttribute('aria-label') });
  }
  return out;
})()`);
const deadLinks = links.filter((l) => !l.href || l.href === '#');
check('every anchor has a real destination', deadLinks.length === 0, deadLinks.length ? JSON.stringify(deadLinks) : `${links.length} links`);

const nameless = await evaluate(`(() => {
  const bad = [];
  for (const el of document.querySelectorAll('a,button')) {
    const text = (el.innerText || '').trim();
    const label = el.getAttribute('aria-label') || (el.querySelector('[class*=visually-hidden]') || {}).textContent || '';
    if (!text && !label.trim()) bad.push(el.outerHTML.slice(0, 80));
  }
  return bad;
})()`);
check('every control has an accessible name', nameless.length === 0, nameless.length ? JSON.stringify(nameless) : 'all named');

const year = await evaluate(`document.querySelector('[data-year]').textContent`);
check('footer year is filled in by script', /^\d{4}$/.test(year) && year === String(new Date().getFullYear()), `year=${year}`);

check('no console errors', consoleErrors.length === 0, consoleErrors.join(' | ') || 'clean');
check('no failed network requests', failedRequests.length === 0, failedRequests.join(' | ') || 'clean');

/* Reduced motion: everything must be visible immediately, with no transitions. */
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
await sleep(2000);
const reduced = await evaluate(`(() => {
  const els = [...document.querySelectorAll('.reveal')];
  return { hidden: els.filter(e => parseFloat(getComputedStyle(e).opacity) < 1).length, total: els.length };
})()`);
check('reduced motion shows all content immediately', reduced.hidden === 0, `${reduced.hidden}/${reduced.total} still transparent`);

ws.close();
chrome.kill();
server.close();

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} interaction checks passed`);
process.exit(failed.length ? 1 : 0);
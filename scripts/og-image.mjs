/**
 * Renders scripts/og-card.html in headless Chrome and writes a compact
 * assets/img/og-image.jpg for Open Graph / Twitter cards.
 *
 * The card is generated rather than hand-drawn so it always uses the site's
 * real fonts and palette, and regenerating after a design change is one command.
 *
 * Chrome only emits PNG screenshots, so the capture is re-encoded to JPEG here
 * to keep the payload small enough for a social crawler to fetch quickly.
 *
 *   npm run og
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, stat, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
const OUT_DIR = join(ROOT, 'assets', 'img');
const OUT_FILE = join(OUT_DIR, 'og-image.jpg');
const PORT = Number(process.env.OG_PORT) || 4321;

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
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  try {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
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

/** Chrome's helper processes keep stdio open, so wait on 'exit' with a cap. */
function chrome(args, timeoutMs = 90000) {
  return new Promise((resolve) => {
    const p = spawn(CHROME, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => {
      try { p.kill('SIGKILL'); } catch { /* gone */ }
      resolve({ code: -9, out: `${out} [TIMEOUT]` });
    }, timeoutMs);
    p.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out: String(e) }); });
    p.on('exit', (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}

await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
await mkdir(OUT_DIR, { recursive: true });

const shot = join(tmpdir(), 'fauziyat-og.png');
const profile = join(tmpdir(), 'fauziyat-og-profile');
await rm(shot, { force: true });

const { out } = await chrome([
  '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--force-device-scale-factor=1', '--virtual-time-budget=6000',
  `--user-data-dir=${profile}`,
  '--window-size=1200,630',
  `--screenshot=${shot}`,
  `http://127.0.0.1:${PORT}/scripts/og-card.html`,
]);

server.close();

let captured = 0;
try { captured = (await stat(shot)).size; } catch { /* not produced */ }
if (!captured) {
  console.error(`Failed to render the OG card.\n${out.slice(0, 600)}`);
  process.exit(1);
}
await rm(profile, { recursive: true, force: true }).catch(() => { /* still locked */ });

/**
 * Re-encode the PNG capture to JPEG. Uses the optional `sharp` dependency when
 * it is installed and falls back to a documented PowerShell/System.Drawing
 * path otherwise, so this stays runnable on a clean zero-dependency clone.
 */
const sharp = await import('sharp').catch(() => null);

if (sharp) {
  await sharp.default(shot).flatten({ background: '#fbf8f3' }).jpeg({ quality: 86, mozjpeg: true }).toFile(OUT_FILE);
} else {
  const ps = [
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName System.Drawing',
    `$src = [System.Drawing.Image]::FromFile('${shot}')`,
    `$bmp = New-Object System.Drawing.Bitmap($src)`,
    "$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }",
    "$ps = New-Object System.Drawing.Imaging.EncoderParameters(1)",
    "$ps.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, 86)",
    `$bmp.Save('${OUT_FILE}', $enc, $ps)`,
    '$src.Dispose(); $bmp.Dispose()',
  ].join('; ');
  const res = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8' });
  if (res.status !== 0) {
    console.error(`JPEG encode failed:\n${res.stderr || res.stdout}`);
    process.exit(1);
  }
}

await rm(shot, { force: true });
const final = await stat(OUT_FILE);
console.log(`built assets/img/og-image.jpg  1200x630  ${(final.size / 1024).toFixed(1)} kB`);
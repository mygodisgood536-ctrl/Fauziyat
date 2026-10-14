/**
 * Deployment-readiness regression tests.
 *
 * These guard the things that silently rot when a static site is assembled from
 * hand-edited parts: an unexpanded build token, a canonical URL that disagrees
 * with itself, a rewritten sitemap namespace, or a stale social card.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat, access } from 'node:fs/promises';
import { join } from 'node:path';
import { html, css, root, read, SITE } from './helpers.mjs';

/* ------------------------------------------------------------ build tokens */

test('no {{SITE_URL}} token survives into the built output', () => {
  assert.ok(!/\{\{SITE_URL\}\}/.test(html), 'index.html still contains a build token');
  assert.ok(!/\{\{[A-Z_]+\}\}/.test(css), 'styles.css still contains a build token');
});

test('page parts never hard-code the site origin, only the token', async () => {
  const { readdir } = await import('node:fs/promises');
  const host = new URL(SITE).host;
  const parts = (await readdir(root)).filter((f) => /^part-\d+.*\.html$/.test(f));
  assert.ok(parts.length > 0, 'expected page parts');

  for (const part of parts) {
    const text = await readFile(join(root, part), 'utf8');
    // Any absolute URL pointing at this site's own host must come from the
    // token. Third-party URLs (schema.org, the confirmed social profiles) are
    // expected and legitimate.
    for (const [url] of text.matchAll(/https?:\/\/[^\s"'<>]+/g)) {
      const hostOf = new URL(url).host;
      assert.notEqual(hostOf, host,
        `${part} hard-codes ${url} — reference {{SITE_URL}} instead`);
    }
  }
});

/* ------------------------------------------------------------ canonical URL */

test('the canonical origin is declared identically everywhere', async () => {
  assert.match(html, new RegExp(`<link rel="canonical" href="${SITE.replace(/[/.]/g, '\\$&')}">`));
  assert.match(html, new RegExp(`property="og:url" content="${SITE.replace(/[/.]/g, '\\$&')}"`));

  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(ld.url, SITE, 'JSON-LD url disagrees with the canonical');

  const sitemap = await read('sitemap.xml');
  assert.ok(sitemap.includes(`<loc>${SITE}</loc>`), 'sitemap loc disagrees with the canonical');

  const robots = await read('robots.txt');
  assert.ok(robots.includes(`Sitemap: ${SITE}sitemap.xml`), 'robots Sitemap disagrees with the canonical');
});

test('sitemap keeps its schema namespace verbatim', async () => {
  const sitemap = await read('sitemap.xml');
  assert.ok(sitemap.includes('http://www.sitemaps.org/schemas/sitemap/0.9'),
    'sitemap.xml namespace was rewritten — search engines will reject the file');
  assert.ok(!sitemap.includes(`${SITE}schemas/`), 'a URL rewrite leaked into the sitemap namespace');
});

/* -------------------------------------------------------------- social card */

test('the social card exists and is the size Open Graph expects', async () => {
  const card = join(root, 'assets/img/og-image.jpg');
  const info = await stat(card);
  assert.ok(info.size > 5000, 'og-image.jpg looks empty');

  assert.match(html, /property="og:image" content="[^"]*og-image\.jpg"/);
  assert.match(html, /property="og:image:width" content="1200"/);
  assert.match(html, /property="og:image:height" content="630"/);
  assert.match(html, /name="twitter:image" content="[^"]*og-image\.jpg"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  for (const tag of [...html.matchAll(/property="og:image" content="([^"]+)"/g)].map((m) => m[1])) {
    assert.ok(tag.startsWith(SITE), `og:image must be absolute, got ${tag}`);
  }
});

test('social images have descriptive alt text', () => {
  for (const prop of ['og:image:alt', 'twitter:image:alt']) {
    const m = html.match(new RegExp(`property="${prop}" content="([^"]+)"|name="${prop}" content="([^"]+)"`));
    const value = m && (m[1] || m[2]);
    assert.ok(value && value.length > 20, `${prop} must be a meaningful description`);
  }
});

/* ------------------------------------------------------------ repo hygiene */

test('no debug or QA scratch files are published', async () => {
  const scratch = ['_diag.html', '_frame.html', '_navopen.html', 'qa/_capture.mjs'];
  for (const f of scratch) {
    assert.ok(!html.includes(f), `built page must not reference ${f}`);
  }
  // These must not be tracked; .gitignore keeps them out.
  const ignored = await read('.gitignore');
  assert.ok(ignored.includes('qa/out/'), 'qa output must be gitignored');
});

test('the repository documents the build, test and deploy workflow', async () => {
  const readme = await read('README.md');
  for (const section of ['npm run build', 'npm test', 'Vercel', 'fauziyatfolashade.com']) {
    assert.ok(readme.includes(section), `README.md should document "${section}"`);
  }
});

/* ------------------------------------------------- Vercel / static output */

test('vercel.json publishes dist and nothing else', async () => {
  const cfg = JSON.parse(await read('vercel.json'));
  assert.equal(cfg.outputDirectory, 'dist', 'Vercel must publish the built directory');
  assert.equal(cfg.buildCommand, 'npm run build', 'Vercel must run the real build');
  assert.equal(cfg.framework, null, 'this project has no framework preset');
  // An install step that assumes a lockfile or registry deps would break here.
  assert.match(cfg.installCommand || 'npm install', /^npm install/);
});

test('dist/ exists after a build and contains the whole site', async () => {
  const dist = join(root, 'dist');
  const required = [
    'index.html', 'robots.txt', 'sitemap.xml', 'site.webmanifest',
    'assets/css/styles.css', 'assets/js/main.js', 'assets/favicon.svg',
    'assets/fonts/fonts.css', 'assets/fonts/inter-latin-var.woff2',
    'assets/fonts/fraunces-latin-var.woff2',
    'assets/img/fauziyat-folashade-portrait.jpg',
    'assets/img/og-image.jpg',
  ];
  for (const file of required) {
    await access(join(dist, file));
  }
});

test('dist/ never leaks source, scripts, tests or docs', async () => {
  const { readdir } = await import('node:fs/promises');
  const dist = join(root, 'dist');
  const entries = await readdir(dist, { recursive: true });
  const forbidden = [
    /^part-\d+.*\.html$/, /^parts\//, /^scripts\//, /^tests\//, /^qa\//,
    /^node_modules\//, /^package(-lock)?\.json$/, /^README\.md$/, /^\.git/,
    /\.md$/i, /\.mjs$/, /^vercel\.json$/,
  ];
  for (const entry of entries) {
    const norm = entry.replace(/\\/g, '/');
    for (const pattern of forbidden) {
      assert.ok(!pattern.test(norm), `dist/ must not publish ${norm}`);
    }
  }
});

test('every asset the built page references exists inside dist/', async () => {
  const dist = join(root, 'dist');
  const distHtml = await readFile(join(dist, 'index.html'), 'utf8');
  const refs = [...distHtml.matchAll(/(?:href|src)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((r) => !/^(https?:|mailto:|tel:|#|data:|\/\/)/.test(r));
  assert.ok(refs.length > 0, 'expected local asset references');
  for (const ref of refs) {
    const clean = decodeURIComponent(ref.split('#')[0].split('?')[0]);
    if (!clean) continue;
    await access(join(dist, clean));
  }
});

test('dist asset paths stay relative so they work under the deploy root', async () => {
  const distHtml = await readFile(join(root, 'dist', 'index.html'), 'utf8');
  const bad = [...distHtml.matchAll(/(?:href|src)="(\/[^/"][^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(bad, [], 'root-absolute asset paths break a sub-path deploy');
});

test('sitemap and robots survive into dist with the right origin', async () => {
  const sitemap = await readFile(join(root, 'dist', 'sitemap.xml'), 'utf8');
  assert.ok(sitemap.includes(`<loc>${SITE}</loc>`));
  assert.ok(sitemap.includes('http://www.sitemaps.org/schemas/sitemap/0.9'),
    'dist sitemap lost its namespace');
  const robots = await readFile(join(root, 'dist', 'robots.txt'), 'utf8');
  assert.ok(robots.includes(`Sitemap: ${SITE}sitemap.xml`));
});
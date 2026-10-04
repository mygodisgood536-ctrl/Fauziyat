/** SEO, structured-data, accessibility and stylesheet regression tests. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { html, css, root, read, SITE, SOCIALS } from './helpers.mjs';

/* ------------------------------------------------------- structured data */

test('Person structured data is valid and factual', () => {
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(match, 'no JSON-LD block found');

  const data = JSON.parse(match[1]);
  assert.equal(data['@type'], 'Person');
  assert.equal(data.name, 'Fauziyat Folashade');
  assert.equal(data.jobTitle, 'Search Engine Marketing Specialist');
  assert.equal(data.email, 'mailto:folashadefauziyat54@gmail.com');
  assert.equal(data.address.addressCountry, 'NG');
  assert.deepEqual(data.sameAs, SOCIALS);
  assert.ok(Array.isArray(data.knowsAbout) && data.knowsAbout.length > 0);
});

test('structured data invents no credentials, awards or ratings', () => {
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  const data = JSON.parse(match[1]);
  const forbidden = ['award', 'aggregateRating', 'review', 'reviews',
    'alumniOf', 'hasCredential', 'numberOfEmployees', 'foundingDate', 'honorificPrefix'];
  for (const key of forbidden) {
    assert.equal(data[key], undefined, `structured data must not contain "${key}"`);
  }
  // Education was deliberately omitted rather than guessed.
  assert.equal(data.alumniOf, undefined);
});

test('no Knowledge Panel guarantee is claimed anywhere', () => {
  const copy = html.replace(/<script[\s\S]*?<\/script>/g, '').toLowerCase();
  const promises = ['guaranteed knowledge panel', 'knowledge panel guaranteed',
    'guarantee a knowledge panel', 'will get a knowledge panel'];
  for (const phrase of promises) {
    assert.ok(!copy.includes(phrase), `forbidden claim present: "${phrase}"`);
  }
});

/* --------------------------------------------------------------- SEO files */

test('page metadata is complete', () => {
  assert.match(html, /<title>[^<]{10,}<\/title>/);
  assert.match(html, /<meta name="description" content="[^"]{80,}">/);
  assert.match(html, /rel="canonical" href="https:\/\/fauziyatfolashade\.com\/"/);
  assert.match(html, /property="og:image"/);
  assert.match(html, /name="twitter:card"/);
  assert.match(html, /<meta name="robots" content="index, follow/);
});

test('sitemap and robots agree with the canonical URL', async () => {
  const robots = await read('robots.txt');
  assert.match(robots, /User-agent: \*/);
  assert.ok(robots.includes(`${SITE}sitemap.xml`), 'robots.txt must advertise the sitemap');

  const sitemap = await read('sitemap.xml');
  assert.ok(sitemap.includes(`<loc>${SITE}</loc>`), 'sitemap must list the home page');
  assert.ok(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.test(sitemap), 'lastmod required');
});

test('web manifest is valid JSON with a theme colour', async () => {
  const manifest = JSON.parse(await readFile(join(root, 'site.webmanifest'), 'utf8'));
  assert.ok(manifest.name.includes('Fauziyat Folashade'));
  assert.equal(manifest.theme_color, '#101820');
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0);
});

/* --------------------------------------------------------- accessibility */

test('accessibility affordances are present', () => {
  assert.match(html, /class="skip-link" href="#main"/);
  assert.match(html, /<main id="main">/);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /nav class="site-nav" id="site-nav" aria-label="Primary"/);
  assert.match(html, /aria-expanded="false"[\s\S]{0,90}aria-controls="site-nav"/);
  assert.ok(css.includes(':focus-visible'), 'visible focus styles required');
  assert.ok(css.includes('prefers-reduced-motion'), 'reduced-motion support required');
  // Motion must be opt-in so content is never hidden when JavaScript is off.
  assert.ok(css.includes('.js .reveal'), 'reveal styles must be gated behind a JS class');
});

test('webfonts are self-hosted with no third-party requests', async () => {
  assert.ok(!/<link[^>]+fonts\.(googleapis|gstatic)\.com/.test(html),
    'page must not depend on Google Fonts at runtime');
  const fontsCss = await read('assets/fonts/fonts.css');
  for (const m of fontsCss.matchAll(/url\(\.\/([^)]+)\)/g)) {
    await readFile(join(root, 'assets/fonts', m[1]));
  }
});

/* ------------------------------------------------------------ stylesheet */

test('stylesheet is well formed and avoids horizontal-overflow traps', () => {
  const open = (css.match(/{/g) || []).length;
  const close = (css.match(/}/g) || []).length;
  assert.equal(open, close, 'unbalanced braces in styles.css');
  assert.ok(css.includes('clamp('), 'fluid type/spacing expected');
  assert.ok(!/width:\s*100vw/.test(css), '100vw commonly causes horizontal overflow');
  assert.ok(css.includes('overflow-x: clip'), 'horizontal overflow guard expected');
});

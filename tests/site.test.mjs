/** Structural, link and image regression tests for the built site. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { html, root, WHATSAPP, EMAIL, SOCIALS } from './helpers.mjs';

/* ---------------------------------------------------------------- document */

test('document has a valid shell', () => {
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<meta charset="utf-8">/i);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(html, /<\/html>\s*$/);
});

test('has exactly one h1 and no skipped heading levels', () => {
  const levels = [...html.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
  assert.equal(levels.filter((l) => l === 1).length, 1, 'expected exactly one <h1>');
  let previous = levels[0];
  for (const level of levels.slice(1)) {
    assert.ok(level <= previous + 1, `heading jumped from h${previous} to h${level}`);
    previous = level;
  }
});

test('every major section carries an id and a labelled heading', () => {
  for (const id of ['about', 'experience', 'expertise', 'presence', 'contact']) {
    assert.match(html, new RegExp(`<section[^>]*id="${id}"`), `missing section #${id}`);
  }
});

/* ------------------------------------------------------------------- links */

test('every in-page anchor resolves to an existing id', () => {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const anchors = [...html.matchAll(/href="#([^"]*)"/g)].map((m) => m[1]);
  assert.ok(anchors.length > 0, 'expected in-page anchor links');
  for (const id of anchors) {
    assert.ok(ids.has(id), `anchor #${id} has no matching element id`);
  }
});

test('there are no placeholder or dead links', () => {
  const bad = [...html.matchAll(/href="([^"]*)"/g)]
    .map((m) => m[1])
    .filter((h) => h === '#' || h === '' || h.startsWith('javascript:'));
  assert.deepEqual(bad, [], 'placeholder links found');
});

test('every local asset reference exists on disk', async () => {
  const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((r) => !/^(https?:|mailto:|tel:|#|data:)/.test(r));
  assert.ok(refs.length > 0);
  for (const ref of refs) {
    await access(join(root, ref));
  }
});

test('links opening a new tab are safe', () => {
  for (const tag of [...html.matchAll(/<a\b[^>]*>/g)].map((m) => m[0])) {
    if (!/target="_blank"/.test(tag)) continue;
    assert.match(tag, /rel="[^"]*noopener/, `missing noopener: ${tag}`);
  }
});

/* ------------------------------------------------------------------ images */

test('images declare alt, dimensions and loading hints', () => {
  const imgs = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  assert.ok(imgs.length >= 2, 'expected both supplied photographs to be used');
  for (const tag of imgs) {
    assert.match(tag, /alt="[^"]+"/, `missing alt: ${tag}`);
    assert.match(tag, /width="\d+"/, `missing width: ${tag}`);
    assert.match(tag, /height="\d+"/, `missing height: ${tag}`);
    assert.match(tag, /loading="lazy"|fetchpriority="high"/, `missing loading hint: ${tag}`);
  }
});

/* ------------------------------------------------------- contact + presence */

test('supplied contact details are present and usable', () => {
  assert.ok(html.includes(WHATSAPP), 'WhatsApp deep link missing');
  assert.ok(html.includes(EMAIL), 'email link missing');
  assert.ok(html.includes('+234 906 722 4840'), 'human-readable phone number missing');
  assert.ok(html.includes('Nigeria'), 'country should be stated');
  for (const link of SOCIALS) {
    assert.ok(html.includes(link), `social profile missing: ${link}`);
  }
});

test('WhatsApp deep link uses E.164 without spaces or symbols', () => {
  const bad = [...html.matchAll(/https:\/\/wa\.me\/[^"\s]+/g)].map((m) => m[0]);
  assert.ok(bad.length > 0);
  for (const link of bad) {
    assert.equal(link, WHATSAPP, `unexpected WhatsApp link: ${link}`);
  }
});

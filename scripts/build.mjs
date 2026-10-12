/**
 * Zero-dependency static build.
 *
 * Concatenates the ordered page parts (part-NN-*.html) into index.html and the
 * ordered stylesheet parts (parts/css-NN-*.css) into assets/css/styles.css.
 * Running this is how you publish an edit: change the part, re-run `npm run build`.
 *
 * Every {{SITE_URL}} token in the page parts is replaced with the canonical
 * origin from scripts/site-config.mjs, and sitemap.xml / robots.txt are
 * reconciled against that same value so the declared domain can never drift.
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_URL } from './site-config.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

/** Expand {{SITE_URL}} in a chunk of page source. */
const expand = (text) => text.replace(/\{\{SITE_URL\}\}/g, SITE_URL);

async function joinParts(dir, pattern, target, { expandTokens = false } = {}) {
  const files = (await readdir(dir)).filter((f) => pattern.test(f)).sort();
  if (!files.length) {
    throw new Error(`No parts matched ${pattern} in ${dir}`);
  }
  const chunks = [];
  for (const file of files) {
    let text = await readFile(join(dir, file), 'utf8');
    if (!text.trim()) throw new Error(`Part is empty: ${file}`);
    text = text.trim();
    if (expandTokens) text = expand(text);
    chunks.push(text);
  }
  const out = chunks.join('\n') + '\n';
  const dest = join(root, target);
  // The output directory can hold no tracked file of its own (assets/css/
  // contains only this generated bundle), and git does not track empty
  // directories — so create it instead of failing on a fresh clone.
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, out, 'utf8');
  return { target, files, bytes: Buffer.byteLength(out) };
}

/**
 * Rewrite a declared-domain URL onto SITE_URL.
 *
 * Deliberately narrow: a blanket "replace every origin" also rewrites the
 * sitemap's own XML namespace (http://www.sitemaps.org/schemas/sitemap/0.9),
 * which search engines reject. Only <loc> values and the robots.txt Sitemap:
 * directive are touched.
 */
function retarget(text) {
  return text
    .replace(/(<loc>)(https?:\/\/[^<\s]+)(<\/loc>)/g, (_m, open, _url, close) => `${open}${SITE_URL}${close}`)
    .replace(/(Sitemap:\s*)(https?:\/\/\S+)/g, (_m, label) => `${label}${SITE_URL}sitemap.xml`);
}

const html = await joinParts(root, /^part-\d+.*\.html$/, 'index.html', { expandTokens: true });
const css = await joinParts(join(root, 'parts'), /^css-\d+.*\.css$/, 'assets/css/styles.css');

/* Keep the declared-domain files honest. Only the origin is rewritten, so a
   hand-edited <lastmod> or relative path survives untouched. */
const sitemap = await readFile(join(root, 'sitemap.xml'), 'utf8');
const robots = await readFile(join(root, 'robots.txt'), 'utf8');

const nextSitemap = retarget(sitemap);
const nextRobots = retarget(robots);

// The namespace must survive verbatim; a rewritten one silently breaks the file.
const NS = 'http://www.sitemaps.org/schemas/sitemap/0.9';
if (nextSitemap.includes(SITE_URL) && !nextSitemap.includes(NS)) {
  throw new Error('sitemap.xml lost its schema namespace — refusing to write');
}

if (nextSitemap !== sitemap) await writeFile(join(root, 'sitemap.xml'), nextSitemap, 'utf8');
if (nextRobots !== robots) await writeFile(join(root, 'robots.txt'), nextRobots, 'utf8');

const drifted = [
  nextSitemap !== sitemap ? 'sitemap.xml' : null,
  nextRobots !== robots ? 'robots.txt' : null,
].filter(Boolean);

console.log(`built ${html.target}  from ${html.files.length} parts  (${html.bytes} bytes)`);
console.log(`built ${css.target}  from ${css.files.length} parts  (${css.bytes} bytes)`);
console.log(`canonical ${SITE_URL}${drifted.length ? `  (retargeted ${drifted.join(', ')})` : ''}`);
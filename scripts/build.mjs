/**
 * Zero-dependency static build.
 *
 * Concatenates the ordered page parts (part-NN-*.html) into index.html and the
 * ordered stylesheet parts (parts/css-NN-*.css) into assets/css/styles.css.
 * Running this is how you publish an edit: change the part, re-run `npm run build`.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

async function joinParts(dir, pattern, target) {
  const files = (await readdir(dir)).filter((f) => pattern.test(f)).sort();
  if (!files.length) {
    throw new Error(`No parts matched ${pattern} in ${dir}`);
  }
  const chunks = [];
  for (const file of files) {
    const text = await readFile(join(dir, file), 'utf8');
    if (!text.trim()) throw new Error(`Part is empty: ${file}`);
    chunks.push(text.trim());
  }
  const out = chunks.join('\n') + '\n';
  await writeFile(join(root, target), out, 'utf8');
  return { target, files, bytes: Buffer.byteLength(out) };
}

const html = await joinParts(root, /^part-\d+.*\.html$/, 'index.html');
const css = await joinParts(join(root, 'parts'), /^css-\d+.*\.css$/, 'assets/css/styles.css');

console.log(`built ${html.target}  from ${html.files.length} parts  (${html.bytes} bytes)`);
console.log(`built ${css.target}  from ${css.files.length} parts  (${css.bytes} bytes)`);

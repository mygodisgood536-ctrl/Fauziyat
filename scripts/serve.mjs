/**
 * Minimal static file server for local preview. Node built-ins only.
 * Usage: npm run serve  ->  http://localhost:4173
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.PORT) || 4173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    let rel = decodeURIComponent(url.pathname);
    if (rel.endsWith('/')) rel += 'index.html';

    // Contain the request inside the project directory.
    const path = join(root, normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!path.startsWith(root)) {
      res.writeHead(403).end('Forbidden');
      return;
    }

    const info = await stat(path);
    if (!info.isFile()) throw new Error('not a file');

    const body = await readFile(path);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(path).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
}).listen(port, () => {
  console.log(`Serving ${root}`);
  console.log(`http://localhost:${port}`);
});

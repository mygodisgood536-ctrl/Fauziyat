/** Shared fixtures for the test suite. */
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE_URL } from '../scripts/site-config.mjs';

export const root = dirname(dirname(fileURLToPath(import.meta.url)));
export const read = (p) => readFile(join(root, p), 'utf8');

export const html = await read('index.html');
export const css = await read('assets/css/styles.css');

/* Read from the build config rather than restating it, so a domain change
   cannot leave the tests asserting a stale value. */
export const SITE = SITE_URL;
export const WHATSAPP = 'https://wa.me/2349067224840';
export const EMAIL = 'mailto:folashadefauziyat54@gmail.com';

/** The four confirmed profiles supplied with the brief. */
export const SOCIALS = [
  'https://www.facebook.com/p/Muftaudeen-Fauziyat-Folashade-61578715251194/',
  'https://www.instagram.com/fauziyat.folashade/',
  'https://x.com/Fauziyat35082',
  'https://www.linkedin.com/in/fauziyat-folashade-8234b5323/',
];

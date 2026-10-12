/**
 * Single source of truth for the canonical origin.
 *
 * Change the site domain in exactly one place — here. `npm run build` writes
 * the value into index.html and reconciles sitemap.xml and robots.txt against
 * it, so the canonical URL, Open Graph URL, JSON-LD `url`, sitemap and
 * robots.txt can never drift apart.
 *
 * Must be an absolute origin with a trailing slash and no path.
 */
export const SITE_URL = 'https://fauziyatfolashade.com/';

if (!/^https:\/\/[a-z0-9.-]+\/$/.test(SITE_URL)) {
  throw new Error(`SITE_URL must be an https origin ending in "/", got: ${SITE_URL}`);
}
# Fauziyat Folashade — personal professional website

The professional website of **Fauziyat Folashade**, Search Engine Marketing
Specialist working in entity SEO, digital identity and search visibility.

This is a **personal brand site**, not a product or a sales funnel. It is a
static, zero-dependency site: no framework, no build tooling beyond a
concatenation script, no runtime services, no database, no API keys.

---

## Quick start

```bash
npm run build     # regenerate index.html + assets/css/styles.css from the parts
npm test          # structural, SEO, accessibility and deployment regression tests
npm run serve     # preview at http://localhost:4173
npm run qa        # headless-Chrome screenshots across 28 viewports -> qa/out/
npm run og        # regenerate the 1200x630 social card
npm run check     # build + test (what CI should run)
```

Node 18 or newer. There is nothing to install — `node_modules` is not used.

---

## How the site is assembled

The page is authored as small ordered **parts**; `npm run build` concatenates
them into the two files a browser actually loads.

```
part-00-head.html            ─┐
part-01-header-hero.html      │
part-02-about-experience.html │── build ──▶ index.html   (committed)
part-03-expertise-visibility  │
part-04-presence.html         │
part-05-contact-footer.html  ─┘

parts/css-01-tokens.css      ─┐
parts/css-02-header.css       │
parts/css-03-hero.css         │
parts/css-04-about.css        ├── build ──▶ assets/css/styles.css (committed)
parts/css-05-expertise.css    │
parts/css-06-presence.css     │
parts/css-07-motion.css      ─┘
```

**Edit a part, never `index.html` or `styles.css` directly** — both are
generated and a hand edit is silently lost on the next build.

`index.html` and `assets/css/styles.css` are committed on purpose so the site
can be opened without running a build. They are reproducible:
`npm run build` regenerates them byte-identically.

`npm run build` then assembles **`dist/`** — the deployable directory — from an
explicit allow-list (`index.html`, `robots.txt`, `sitemap.xml`,
`site.webmanifest`, `assets/`). `vercel.json` publishes that directory. Serving
the repository root instead would expose `part-*.html`, `parts/`, `scripts/`,
`tests/` and `qa/` publicly.

### The canonical domain lives in one place

`scripts/site-config.mjs` holds `SITE_URL`. Page parts reference `{{SITE_URL}}`,
which the build expands, and the build also reconciles `sitemap.xml` and
`robots.txt` against it. Change the domain there and rebuild — never edit the
canonical, Open Graph URL, JSON-LD `url`, sitemap or `robots.txt` by hand.
`tests/deploy.test.mjs` fails the build if any of them disagree.

---

## Deploying to Vercel

The build publishes a dedicated **`dist/`** directory, and `vercel.json`
declares that as the output directory so the configuration is version-controlled
rather than living in dashboard settings.

| Setting | Value | Source |
| --- | --- | --- |
| Framework Preset | None (`null`) | `vercel.json` |
| Build Command | `npm run build` | `vercel.json` |
| Output Directory | `dist` | `vercel.json` |
| Install Command | `npm install --no-audit --no-fund` | `vercel.json` |
| Environment variables | **none** | — |

1. **Import the repository**
   Vercel dashboard → *Add New… → Project* → import `mygodisgood536-ctrl/Fauziyat`.

2. **Accept the defaults from `vercel.json`** — it supplies the build command,
   install command and output directory, so there is nothing to set by hand.

3. **Deploy.** The build assembles `dist/` from an explicit allow-list:

   ```
   dist/index.html      dist/robots.txt     dist/sitemap.xml
   dist/site.webmanifest
   dist/assets/css/     dist/assets/fonts/  dist/assets/img/
   dist/assets/js/      dist/assets/favicon.svg
   ```

   Nothing else is copied, so `part-*.html`, `parts/`, `scripts/`, `tests/`,
   `qa/`, `package.json` and this README are never published. `tests/deploy.test.mjs`
   enforces that allow-list, so a regression fails CI rather than leaking.

4. **Attach the custom domain**
   *Project → Settings → Domains → Add* → `fauziyatfolashade.com`.
   Vercel issues the DNS record; add it at your registrar and wait for the
   certificate. `www.fauziyatfolashade.com` can redirect to the apex.

5. **Verify after deploy**

   ```bash
   curl -sI https://fauziyatfolashade.com/               # 200, text/html
   curl -sI https://fauziyatfolashade.com/assets/css/styles.css
   curl -s  https://fauziyatfolashade.com/robots.txt
   curl -s  https://fauziyatfolashade.com/sitemap.xml    # namespace intact
   curl -sI https://fauziyatfolashade.com/scripts/build.mjs   # must 404
   ```

   Then submit `https://fauziyatfolashade.com/sitemap.xml` in Google Search
   Console and add the domain as an additional verification method.

### Deploying without Vercel

`dist/` is a plain static folder — drop it on Netlify, Cloudflare Pages, GitHub
Pages or any web server. `npm run build` produces it and nothing else is needed.

### Previewing the built output locally

```bash
npm run build
npx serve dist          # or any static file server pointed at dist/
```

---

## Testing

`npm test` runs Node's built-in runner — no test framework to install.

| File | Covers |
| --- | --- |
| `tests/site.test.mjs` | document shell, heading order, anchors resolve, no dead links, asset existence, `target="_blank"` safety, image attributes, contact details |
| `tests/seo.test.mjs` | Person JSON-LD validity, no fabricated credentials, no Knowledge Panel guarantee, metadata, sitemap/robots agreement, manifest, a11y affordances, self-hosted fonts, CSS overflow guards |
| `tests/deploy.test.mjs` | build tokens expanded, canonical URL consistent everywhere, sitemap namespace intact, social card size, no debug files published, README completeness |

`npm run qa` is the visual counterpart: it drives headless Chrome across
320–1920 px, writes screenshots to `qa/out/`, and reports horizontal overflow,
nav-toggle visibility, and any interactive control under 40 px tall. It needs
Chrome, Edge or Chromium on `PATH`, or `CHROME_PATH` set.

Both suites assert against `tests/helpers.mjs`, which imports the canonical URL
from the build config so the tests can never assert a stale domain.

---

## Deliberate omissions

These are decisions, not gaps:

- **No Education section.** The source brief required one but supplied no
  school, course or qualification data, and also forbade inventing any. It was
  omitted rather than fabricated.
- **No portfolio / case studies.** No real projects were supplied. Fabricating
  them was explicitly out of scope.
- **No Knowledge Panel claim.** The site states plainly that a Knowledge Panel
  is Google-controlled and cannot be guaranteed.
- **No fabricated reviews, ratings, awards or credentials** anywhere, including
  in structured data.
- **No database and no AI provider.** This is a brochure site; neither is
  required by any feature in the brief.

---

## Content editing

All copy lives in the `part-*.html` files. Facts that must stay factual:

| Fact | Value |
| --- | --- |
| WhatsApp | `+234 906 722 4840` → `https://wa.me/2349067224840` |
| Email | `folashadefauziyat54@gmail.com` |
| Country | Nigeria |
| Role | Search Engine Marketing Specialist |
| Employer | Local SEO Ranking Services |
| Period | February 2021 — Present |

Changing a contact detail means updating it in the hero, the contact section,
the footer, the JSON-LD and `tests/helpers.mjs`, which assert them.

## Assets

- `assets/fonts/` — Fraunces + Inter, latin subset, self-hosted. No third-party
  requests at runtime.
- `assets/img/fauziyat-folashade-portrait.jpg` (442×452) — hero.
- `assets/img/fauziyat-folashade-portrait-02.jpg` (236×432) — About.
- `assets/img/og-image.jpg` (1200×630) — generated by `npm run og`.

The two portraits are supplied photographs at modest resolution. They are
adequate at 1× but will soften on high-density displays; re-exporting them at
1200 px or wider would improve the hero without any code change.
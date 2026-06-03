# Instant Context Website Style Guide

**Version:** 1.0  
**Last Updated:** June 2, 2026  
**Purpose:** Single source of truth for the public website (`website/`). Read this before editing any HTML or CSS in that folder.

---

## Design intent

The public site is dark, tech-forward, and minimal. The landing page ([`index.html`](index.html)) and shared stylesheet ([`css/site.css`](css/site.css)) are canonical. Every page that uses the site chrome (nav, footer, grid background) must link to `css/site.css` and use CSS variables — never hardcode hex colors in page-specific styles.

---

## Relationship to the mobile app

The React Native app has its own design system in [`_docs/reference/docs/DESIGN_SYSTEM.md`](../_docs/reference/docs/DESIGN_SYSTEM.md) and [`styles/theme.js`](../styles/theme.js). The website uses a related but separate palette:

| Token | Website | Mobile app |
|---|---|---|
| Accent cyan | `#00d4ff` | `#00bcd4` |
| Background | `#060810` | `#0a0e1a` |
| Body font | Inter (Google Fonts) | System default |

Do not copy app tokens into website CSS without checking this guide first.

---

## Color tokens

All colors are defined as CSS custom properties in `:root` inside [`css/site.css`](css/site.css).

| Variable | Value | Usage |
|---|---|---|
| `--black` | `#060810` | Page background |
| `--surface` | `#0c1120` | Cards, elevated panels |
| `--surface-2` | `#111827` | Hover states, nested panels |
| `--border` | `rgba(255,255,255,0.07)` | Default borders |
| `--border-hi` | `rgba(0,212,255,0.25)` | Accent borders, secondary buttons |
| `--cyan` | `#00d4ff` | Primary accent, links, headings |
| `--cyan-dim` | `rgba(0,212,255,0.15)` | Button hover backgrounds |
| `--cyan-glow` | `rgba(0,212,255,0.08)` | Subtle accent fills |
| `--red` | `#ff3b5c` | Error / price-drop badges (index only) |
| `--text-hi` | `#f0f4ff` | Headings, primary text |
| `--text-mid` | `#8892a4` | Body text, descriptions |
| `--text-lo` | `#4a5568` | Footer links, metadata |
| `--radius` | `10px` | Buttons, nav CTA |
| `--radius-lg` | `16px` | Cards, legal panels |

Set `<meta name="theme-color" content="#060810">` on every page.

---

## Typography

**Body:** Inter, weights 300–800  
**Labels / metadata / code:** JetBrains Mono, weights 400–600

Include these in every page `<head>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="./css/site.css">
```

| Element | Font | Weight | Color |
|---|---|---|---|
| Page title (`.section-title`) | Inter | 800 | `--text-hi` |
| Section label (`.section-label`) | JetBrains Mono | 500 | `--cyan` |
| Body / legal prose | Inter | 400 | `--text-mid` |
| Legal h2 | Inter | 700 | `--cyan` |
| Legal h3 | Inter | 600 | `--text-hi` |
| Footer meta / dates (`.legal-meta`, `.footer-meta`) | JetBrains Mono | 400–500 | `--text-mid` / `--text-lo` |

---

## Layout

| Property | Value |
|---|---|
| Page max-width | 1080px (`.wrap`) |
| Sticky nav height | 60px |
| Horizontal padding | 24px (16px on small screens for legal pages) |
| Legal content | Full width inside `.wrap`; cards use `--surface` panels |

---

## Shared components

All defined in [`css/site.css`](css/site.css):

- **`.grid-bg`** — fixed cyan grid overlay on every page
- **`nav` / `.nav-inner`** — sticky top bar with logo, brand name, version pill, optional CTA
- **`footer` / `.footer-inner`** — brand, link row, version meta
- **`.btn-primary` / `.btn-secondary`** — call-to-action buttons
- **`.section-label` / `.section-title`** — page and section headings
- **`.legal-page` / `.legal-card`** — privacy policy and other legal prose pages

### Nav pattern

Copy the nav block from [`index.html`](index.html) or [`privacy-policy.html`](privacy-policy.html). The version pill (`#nav-version`) is populated at runtime from [`version.json`](version.json).

### Footer pattern

Copy the footer block from either synced page. The version line (`#footer-version`) uses the same `version.json` fetch script.

---

## Adding a new page

1. Copy the `<head>` font and stylesheet links from an existing synced page.
2. Add `<meta name="theme-color" content="#060810">`.
3. Copy the `<style>` block from an existing synced page into your new page's `<head>`, after the `site.css` link. Every page carries the shared styles inline so it works correctly regardless of whether `site.css` loads (file://, offline, Vercel cold start, etc.). Add only page-specific styles at the end of that block.
4. Structure the body:
   ```html
   <div class="grid-bg"></div>
   <nav>...</nav>
   <main class="wrap">...</main>
   <footer>...</footer>
   ```
5. Use CSS variables only in your page-specific additions — no hardcoded hex colors.
6. For legal/prose content, wrap sections in `.legal-card` inside `.legal-page`.
7. Include the `version.json` fetch script if the page has nav/footer version elements.
8. Open the page locally alongside `index.html` to confirm fonts, colors, and chrome match.

---

## Files that must stay in sync

| File | Role |
|---|---|
| [`css/site.css`](css/site.css) | Canonical shared token/style reference |
| [`index.html`](index.html) | Landing page — shared styles inline + page-specific inline |
| [`privacy-policy.html`](privacy-policy.html) | Privacy policy — shared styles inline + legal-page inline |
| [`version.json`](version.json) | Runtime version for nav/footer |

When you change a shared style (a color, the nav, the footer, etc.), update **all three**: `site.css`, the inline block in `index.html`, and the inline block in `privacy-policy.html`.

Pages not yet migrated to this system: `beta.html`, `delete-account.html`. When updating those, follow the checklist above.

---

## Stale copies (do not edit)

- [`_docs/reference/docs/privacy-policy.html`](../_docs/reference/docs/privacy-policy.html) — old light-theme copy, not deployed. The live page is [`privacy-policy.html`](privacy-policy.html).

Policy **content** is also maintained in [`_docs/reference/docs/privacy-policy.md`](../_docs/reference/docs/privacy-policy.md). Update that markdown when policy text changes, then sync the HTML.

---

## Deploy

No build step. [`deploy-website.ps1`](../_dev_tools/scripts/deploy-website.ps1) copies the entire `website/` folder (including `css/site.css`) to the Vercel GitHub repo. After editing styles, deploy as usual.

---
name: LaVega Content Site
description: The reading surface at lavega.dev. Same "Midnight" world as the app, set for long-form answers: one column, 720px measure, Libron at reading size.
colors:
  midnight: "#02070a"
  surface: "#0d171d"
  surface-2: "#16222a"
  white: "#ffffff"
  mist: "#a9b4bb"
  hairline: "rgba(255, 255, 255, 0.12)"
  signal-blue: "#0297de"
  signal-blue-soft: "rgba(2, 151, 222, 0.12)"
  warn: "#fc734d"
typography:
  h1:
    fontFamily: "Libron, Georgia, serif"
    fontSize: "clamp(2.5rem, 7vw, 3.75rem)"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  h2:
    fontFamily: "Libron, Georgia, serif"
    fontSize: "2rem"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  h3:
    fontFamily: "Libron, Georgia, serif"
    fontSize: "1.5rem"
    fontWeight: 400
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Libron, Georgia, serif"
    fontSize: "1.25rem"
    fontWeight: 400
    lineHeight: 1.55
  meta:
    fontFamily: "Libron, Georgia, serif"
    fontSize: "1rem"
    fontWeight: 400
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.9em"
rounded:
  control: "12px"
spacing:
  measure: "720px"
  page-inline: "16px"
---

# LaVega Content Site

Static pages built by `apps/site` from `content/`: answers, guides, comparisons and the about page. It is a reading surface, so it shares the app's palette and typeface but not its density. `src/site.css` is the source of truth.

**Key characteristics**

- One column, 720px measure, 16px page padding. Nothing else competes with the text.
- Libron at reading size (1.25rem / 1.55), 400 everywhere. Headings differ by size, not weight.
- Dark only. There is no light theme on the content site.
- Blue for links and blockquote accents; amber `#fc734d` only for the draft banner.

## Type

- **H1** `clamp(2.5rem, 7vw, 3.75rem)`, 400, line-height 1.1, `-0.01em`. One per page.
- **H2** 2rem, **H3** 1.5rem, both 400 with generous top margin (1.8em / 1.5em) so sections breathe.
- **Body** 1.25rem, line-height 1.55, `overflow-wrap: break-word`.
- **Meta** (author, date) 1rem in mist, directly under the H1.
- **Code** is the one exception to the single typeface: `ui-monospace` on surface-2, 0.9em.

Libron ships four styles (400, 700, both italics) and real tabular figures. Bold is available for emphasis inside running text; headings stay 400. It has no arrows or checks (`→ ← ↑ ↓ ✓`), so the stack ends in `Georgia, serif` and those glyphs fall back per glyph.

Fonts are served from `/fonts/` as four WOFF2 with the OFL license beside them in `assets/fonts/`. Same files as `apps/web`; do not subset them per page.

## Blocks

- **Breadcrumbs** — 0.875rem mist, `/` separators, wrap instead of truncating.
- **Locale switch** — one 0.875rem mist text link in the header to the other locale. No button, no flag, no menu.
- **On this page** — text-only anchor list, 0.95rem, shown when an article has 3+ section headings. Headings carry `id`s.
- **Body** — paragraphs 1em apart; lists indented 1.4em with 0.3em between items; blockquote is a 3px blue left rule on `--accent-soft` with a 12px right radius.
- **Tables** — hairline borders, 8px 12px cells, header on surface-2. A `.table-scroll` wrapper owns `overflow-x: auto` and `tabindex="0"`, so the table keeps its semantics and keyboard users can scroll it. Below 760px a 0.9rem mist hint says the columns scroll horizontally.
- **Disclaimer** — surface fill, hairline, 12px radius, 0.95rem: the "this is information, not advice" note. Emitted once by `render.ts`; never written into content markdown.
- **Sources** — 0.9rem mist with a 1.15rem heading; every claim links out.
- **Related** — hairline top rule, then a plain list of sibling pages. Emitted once by `render.ts`; no `## Gerelateerd` / `## Related` section in content markdown.
- **Hub list** — 14px rows separated by hairlines, each with a mist summary line.
- **Draft banner** — full-bleed amber strip with midnight text, uppercase-leaning tracking. Only pages with `status: draft` get the banner and `noindex`. Drafts never ship to production (`build.ts` filters them).

## Rules

- **Do** keep one column. A sidebar or a second measure is a redesign.
- **Do** keep headings at 400 and let size do the work.
- **Do** write links as text, coloured blue; no buttons in body copy.
- **Do** keep the disclaimer and related list in the renderer. Content markdown ends at the last section, with no trailing boilerplate.
- **Don't** add a light theme or a colour outside the token list.
- **Don't** set body copy in the monospace face; it is for code only.
- **Don't** hand-write an OG card. `scripts/make-images.mjs` renders them from `og-card.html` with Libron, shrinking the headline to fit one line after the webfont loads.

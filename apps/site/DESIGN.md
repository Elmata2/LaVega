---
name: LaVega Content Site
description: The reading surface at lavega.dev. Same "Midnight" world as the app, set for long-form answers: one column, 720px measure, Geist at reading size under an Instrument Serif headline.
colors:
  midnight: "#02070a"
  surface: "#0d171d"
  surface-2: "#16222a"
  white: "#ffffff"
  ink-body: "#e9eef1"
  mist: "#a9b4bb"
  hairline: "rgba(255, 255, 255, 0.12)"
  signal-blue: "#0297de"
  signal-blue-soft: "rgba(2, 151, 222, 0.12)"
  warn: "#fc734d"
typography:
  h1:
    fontFamily: "Instrument Serif, Georgia, serif"
    fontSize: "clamp(2.25rem, 1.6rem + 2.4vw, 3.25rem)"
    fontWeight: 400
    lineHeight: 1.08
    letterSpacing: "0"
  h2:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "clamp(1.375rem, 1.25rem + 0.6vw, 1.625rem)"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  h3:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "clamp(1.1875rem, 1.1rem + 0.5vw, 1.375rem)"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: 1.65
  body-mobile:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.62
  meta:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
  small:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "0.9em"
rounded:
  control: "12px"
  inline: "4px"
spacing:
  measure: "720px"
  page-inline: "16px"
---

# LaVega Content Site

Static pages built by `apps/site` from `content/`: answers, guides, comparisons and the about page. It is a reading surface, so it shares the app's palette and typeface but not its density. `src/site.css` is the source of truth.

**Key characteristics**

- One column, 720px measure, 16px page padding. Nothing else competes with the text.
- Geist at reading size (1.125rem / 1.65). The H1 is Instrument Serif 400; H2 and smaller are Geist 600, so rank shows in weight as well as size.
- Dark only. There is no light theme on the content site.
- Blue for links and blockquote accents; amber `#fc734d` only for the draft banner.
- Running text is `--ink-body` (`#e9eef1`), a hair under paper white, to stop the glare that pure white on midnight produces at 19px. Headings stay `#fff`.

## Type

- **H1** Instrument Serif `clamp(2.25rem, 1.6rem + 2.4vw, 3.25rem)`, 400 with `font-synthesis: none`, line-height 1.08, tracking 0, `text-wrap: balance`. One per page. The condensed face needs the extra size to read; never tighten it.
- **H2** `clamp(1.375rem, 1.25rem + 0.6vw, 1.625rem)`, **H3** `clamp(1.1875rem, 1.1rem + 0.5vw, 1.375rem)`, both Geist 600, `-0.015em`, with 1.6em top margin so sections breathe. Both balance. Anchors clear the sticky header through `scroll-padding-top` on `html`, not per-heading `scroll-margin-top`.
- **Body** Geist 1.125rem, line-height 1.65, `overflow-wrap: break-word`, `text-wrap: pretty` on paragraphs and lists so the last line never leaves one orphan word.
- **Meta** (author, date) 0.9375rem in mist, directly under the H1, flex-wrapped so the date never splits; the `·` separator hides below 760px.
- **Code** is the one exception to the two faces: `ui-monospace` on surface-2, 0.9em.

The scale is deliberately flat at the top: the H1 used to run to 60px and shout over the text it introduces. 44px on desktop, 32px on a phone, keeps the hierarchy (52 / 26 / 22 / 18) without the page opening like a hero.

Instrument Serif has one drawn weight and no tabular figures, so it is only the H1 (and the OG card headline). Geist is variable (100–900) with real `tnum`. Neither latin subset has arrows or checks (`→ ← ✓`), so both stacks end in a system face and those glyphs fall back per glyph. `* Fallback` faces scale Times New Roman and Arial to the webfont metrics, so the swap does not reflow.

Fonts are served from `/fonts/` as four WOFF2 (Instrument Serif regular + italic, Geist variable upright + italic) with the OFL licenses beside them in `assets/fonts/`. Same files as `apps/web`. The head preloads Instrument Serif regular and Geist upright: without it, on 3G the headline sat in the fallback serif for ~1s.

On touch (`pointer: coarse`) the header language link, breadcrumbs and table of contents get a 44px or taller hit area without moving the text.

## Blocks

- **Header** — sticky at the top of the viewport, solid `--bg`, wordmark left and locale link right. It carries the reading-progress rule: a 2px `--accent` line at its bottom edge, scaled from the scroll position with `animation-timeline: scroll(root block)`. No JavaScript. Hidden when the browser has no scroll timelines or the reader asks for reduced motion.
- **Breadcrumbs** — 0.875rem mist, `/` separators, wrap instead of truncating. No underline; ink and underline appear only on hover.
- **Locale switch** — one 0.875rem mist text link in the header to the other locale. No button, no flag, no menu.
- **On this page** — text-only anchor list, 0.875rem, shown when an article has 3+ section headings. Headings carry `id`s. Links are mist with no underline, going to ink on hover: the list is orientation, not body copy, and seven blue underlines out-shouted the article title.
- **Body** — paragraphs 1em apart; lists indented 1.4em with 0.3em between items; blockquote is a 3px blue left rule on `--accent-soft` with a 12px right radius.
- **Tables** — hairline borders, 8px 12px cells (8px 10px below 760px), 0.9375rem type, header on surface-2. A `.table-scroll` wrapper owns `overflow-x: auto` and `tabindex="0"`, so the table keeps its semantics and keyboard users can scroll it. Below 760px a 0.9rem mist hint says the columns scroll horizontally, and the wrapper draws a thin scrollbar.
- **Disclaimer** — surface fill, hairline, 12px radius, 0.9375rem mist: the "this is information, not advice" note. Emitted once by `render.ts`; never written into content markdown.
- **Sources** — 0.875rem mist with a 1rem heading; every claim links out.
- **Related** — hairline top rule, then a plain list of sibling pages at a 1rem heading. Emitted once by `render.ts`; no `## Gerelateerd` / `## Related` section in content markdown.
- **Hub list** — 14px rows separated by hairlines, each with a 0.9375rem mist summary line.
- **Draft banner** — full-bleed amber strip with midnight text, uppercase-leaning tracking. Only pages with `status: draft` get the banner and `noindex`. Drafts never ship to production (`build.ts` filters them).

## Motion

One authored moment, and it earns its place: the reading-progress rule in the header. It answers "how much is left" on articles that run seven thousand pixels, it is CSS-only (`animation-timeline: scroll(root block)`), it runs off the main thread, and it is absent under `prefers-reduced-motion`.

Everything else is micro-feedback at interaction speed: `scroll-behavior: smooth` with `scroll-padding-top: 72px` so an anchor lands 16px under the 56px header rather than behind it, 140ms `--ease-out` on link colour and underline thickness, and hover states gated to `@media (hover: hover)` where they change layout. No entrance animations, no fades on scroll, no parallax — a reader who comes back to a paragraph must find it where they left it.

## Rules

- **Do** keep one column. A sidebar or a second measure is a redesign.
- **Do** keep headings at 400 and let size do the work.
- **Do** write links as text, coloured blue; no buttons in body copy.
- **Do** keep the disclaimer and related list in the renderer. Content markdown ends at the last section, with no trailing boilerplate.
- **Do** theme the browser surfaces that ship with the design: selection, focus ring, scrollbars, caret. They are part of the page.
- **Don't** animate text on entry. Motion here is orientation, never decoration.
- **Don't** add a light theme or a colour outside the token list.
- **Don't** set body copy in the monospace face; it is for code only.
- **Don't** hand-write an OG card. `scripts/make-images.mjs` renders them from `og-card.html` with Instrument Serif (headline) and Geist (footer), shrinking the headline to fit one line after the webfont loads.

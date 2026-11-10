---
name: LaVega App
description: The product surface at app.lavega.dev. The lavega.dev "Midnight" world as a working dashboard: near-black ground, one serif voice, honest tabular figures, cantaloupe for the one primary action.
colors:
  midnight: "#02070a"
  surface: "#0d171d"
  surface-2: "#16222a"
  white: "#ffffff"
  mist: "#a9b4bb"
  hairline: "rgba(255, 255, 255, 0.12)"
  cantaloupe: "#fc734d"
  signal-blue: "#0297de"
  gain-green: "#5fd38d"
  loss-rose: "#ff8f8f"
  caution-amber: "#f2b84b"
  chart-blue: "#4db4f0"
  chart-purple: "#a99bff"
  chart-teal: "#4fd1c0"
typography:
  display:
    fontFamily: "Libron, Georgia, Times New Roman, serif"
    fontSize: "2.6rem"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Libron, Georgia, Times New Roman, serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Libron, Georgia, Times New Roman, serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Libron, Georgia, Times New Roman, serif"
    fontSize: "0.85rem"
    fontWeight: 400
    lineHeight: 1.4
  figure:
    fontFamily: "Libron, Georgia, Times New Roman, serif"
    fontSize: "2.1rem"
    fontWeight: 700
    letterSpacing: "-0.02em"
    fontFeature: "tnum"
  eyebrow:
    fontFamily: "Libron, Georgia, Times New Roman, serif"
    fontSize: "0.75rem"
    fontWeight: 400
    letterSpacing: "0.02em"
rounded:
  frame: "32px"
  card: "28px"
  panel: "20px"
  control: "14px"
  pill: "999px"
spacing:
  base: "4px"
  s1: "4px"
  s2: "8px"
  s3: "12px"
  s4: "16px"
  s5: "24px"
  s6: "32px"
components:
  button-primary:
    backgroundColor: "{colors.cantaloupe}"
    textColor: "{colors.midnight}"
    rounded: "{rounded.pill}"
    padding: "8px 18px"
  button-default:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.white}"
    borderColor: "{colors.hairline}"
    rounded: "{rounded.pill}"
    padding: "8px 18px"
  card:
    backgroundColor: "{colors.surface}"
    borderColor: "{colors.hairline}"
    rounded: "{rounded.control}"
    padding: "24px"
  input:
    backgroundColor: "{colors.surface-2}"
    borderColor: "{colors.hairline}"
    rounded: "{rounded.control}"
    padding: "6px 10px"
---

# LaVega App

The working product behind app.lavega.dev, and the reference the content site and the investing app copy. Everything here comes from `src/styles/tokens.css`; that file is the source of truth and this document explains why the values are what they are. Change a token, change this file in the same commit.

**Key characteristics**

- One typeface: Libron, self-hosted from `src/assets/fonts/` (four styles, OFL, license shipped next to the files).
- Dark by default with an opt-in light theme; radius, type, spacing and motion are shared between the two.
- The app is a single floating frame on the gutter, not a full-bleed page. Only the content inside scrolls.
- Depth is tone plus a 12% hairline. Only floating layers (dialogs, menus) cast a shadow.
- Cantaloupe is the one filled call to action; signal blue carries links, active state and focus.

## Colors

`color-scheme: dark` on `:root`. The light theme is `:root[data-theme="light"]` and changes colour only.

- **Midnight `#02070a`** — gutter and app surface. The app frame and its ground are the same value, so the frame reads as a cut-out, not a card.
- **Surface `#0d171d` / Surface-2 `#16222a`** — raised panels, then nested rows and inputs.
- **Ink `#ffffff`, Ink-soft `#e3e9ec`, Muted `#a9b4bb`** — primary text, the hover state of the active nav pill, secondary text.
- **Hairline `rgba(255,255,255,0.12)`** — every border. Never a second grey.
- **Signal blue `#0297de`** — links, active state, focus ring. Soft variant `rgba(2,151,222,0.16)` fills active pills.
- **Cantaloupe `#fc734d`** — the primary button and nothing else. Hover brightens the fill by 8%, it does not change the colour.
- **Gain `#5fd38d`, loss `#ff8f8f`, caution `#f2b84b`** — money in, money out, attention. Each is at least 4.5:1 on midnight, surface and surface-2; `scripts/check-midnight-contrast.mjs` measures both themes and exits non-zero on failure.
- **Chart blue / purple / teal** — data-viz accents and category dots. The spending pie adds five more slices but never green or red: those mean money in and out everywhere else, so a green slice would read as income.

Delta pills use `--pos-tint` / `--neg-tint`, built with `color-mix` in srgb. Do not replace them with Tailwind's `bg-pos/12`: the `@theme inline` indirection makes that modifier emit full opacity silently.

## Typography

**One family.** `--font-display`, `--font-body` and `--font-mono` are all Libron. There is no second face; hierarchy comes from size and weight, and small labels are the same face at a smaller size.

**Libron has four real styles** (400, 700, and both italics), so `font-weight: 600` resolves to the drawn Bold. Do not declare the face over a synthetic `100 900` range: that was the workaround for the single-weight face this replaced, and it makes bold look like a smear.

**Tabular figures.** Libron carries a real `tnum` feature and the app sets `font-variant-numeric: tabular-nums` on numeric cells, so columns align by digit width. Keep it on anything that can change while the user watches.

**Missing glyphs.** Libron has no arrows or checks (`→ ← ↑ ↓ ✓`). Every stack ends in `Georgia, "Times New Roman", serif`, so those glyphs fall back per glyph. Do not set them in a decorative face.

**Scale.** `html` is 17px. The page title (`.topbar-title`) is 2.6rem at 600, 1.05 line-height and `-0.02em`; the base `h1` rule is 1.75rem, `h2` 1.25rem, `h3` 1rem in mist. Body is 1rem at line-height 1.5. A module figure is 2.1rem at 700 with `-0.02em` and tabular figures. Eyebrows are 0.75rem at 400 with `0.02em` tracking; the uppercase ones are per-component, not a global rule.

## Layout

- **Frame.** `.shell` is `calc(100vh - 2 * 20px)` tall, max 1680px, 32px radius, `--shadow-float`. The app bar, greeting and content stack inside it; only `.content` scrolls.
- **App bar.** Brand, then the owner's chosen modules as text tabs, then lock/actions. Tabs scroll horizontally instead of wrapping, because a selection can be long.
- **Module grid.** `--grid-gap: 24px`, modules 200px (short) or 360px (tall), placed by `span` (1/2/3 columns). Adding a module is one `<Module span=…>` line, never a layout rewrite.
- **Spacing** is a 4px scale (`--sp-1` … `--sp-6`). Panels use 24px padding; the frame uses 20px gutter.
- **Breakpoints.** The grid collapses 3 → 2 → 1 columns; the nav rail keeps scrolling rather than wrapping at any width.

## Components

- **Button (`components/ui/Button.tsx`).** Pill, 8px 18px, medium weight. `default` is surface-2 with a hairline; `primary` is cantaloupe with midnight text and `filter: brightness(1.08)` on hover. Disabled states rely on the bare `button:disabled` rule, so hover and pointer utilities are scoped to `enabled:`.
- **Pill (`components/ui/Pill.tsx`).** Toggle chip, 0.85rem, transparent with a hairline. Active is accent-soft fill, ink text, blue border.
- **Card.** Surface, 14px radius (`--r-sm`), hairline, no shadow, 24px padding (16px on phones). Modules on the homescreen grid add the height tokens (200px short, 360px tall).
- **Input.** Surface-2 fill, hairline, 14px radius, 6px 10px padding, 0.9rem. Focus is the blue ring, never a colour change of the border.
- **Nav item.** Text tab, muted; active is the white pill with midnight text — the same treatment as the marketing site.
- **Dialog.** Scrim `rgba(2,7,10,0.72)`, surface panel, `--shadow-float`. The only place a shadow is allowed.

## Motion

`--ease-emphasized: cubic-bezier(0.23, 1, 0.32, 1)` — fast out, gentle settle. Transitions are 120–250ms and touch colour, opacity and transform only. Respect `prefers-reduced-motion`: a reduced-motion user gets the end state, not a faster animation.

## Rules

- **Do** keep one typeface. A second face is a design change, not a component decision.
- **Do** put every number in tabular figures, and keep the `tnum` feature on.
- **Do** separate panels with tone and the hairline.
- **Do** keep cantaloupe for the one primary action per screen.
- **Don't** use cantaloupe as a selected state, a link, or a chart series.
- **Don't** use green or rose outside gain, loss and problem.
- **Don't** add a shadow to a resting panel.
- **Don't** introduce a grey outside the token list; use the hairline or a surface step.
- **Don't** hard-code a font stack that omits the Georgia fallback, or `→` and `✓` disappear.

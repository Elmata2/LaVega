---
name: LaVega App
description: The product surface at app.lavega.dev. The lavega.dev "Midnight" world as a working dashboard: near-black ground, a display serif over Geist, honest tabular figures, cantaloupe for the one primary action.
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
    fontFamily: "Instrument Serif, Georgia, Times New Roman, serif"
    fontSize: "2.6rem"
    fontWeight: 400
    lineHeight: 1.08
    letterSpacing: "0"
  headline:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "0.85rem"
    fontWeight: 400
    lineHeight: 1.4
  figure:
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "2.1rem"
    fontWeight: 700
    letterSpacing: "-0.02em"
    fontFeature: "tnum"
  eyebrow:
    fontFamily: "Geist, system-ui, sans-serif"
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

- Two faces, each with one job: Instrument Serif for display (28px and up, 400 only), Geist for everything else. Self-hosted from `src/assets/fonts/` with the OFL licenses.
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

**Two families, one job each** (2026-11-11, replacing Libron). `--font-display` is Instrument Serif; `--font-body` and `--font-mono` are Geist.

**The size floor.** Instrument Serif is a condensed face with thin strokes and ONE drawn weight. It reads at 28px and up and nowhere else: the page title (`.topbar-title`, 2.6rem), base `h1` (1.75rem), the `.brand` wordmark, and on the landing page `h1`/`h2`, the scroll-lit sentence, the chat question and the quote. Every heading under that (base `h2`/`h3`, module titles, dialog and chat titles, the `font-body` section titles in the views) is Geist 600. The last time this serif ran the whole app it was faux-bolded and set at label sizes, and headings were hard to read; the floor is what prevents that.

**No faux bold.** The serif is declared at 400 only and every display role sets `font-synthesis: none` and `font-weight: 400`. Tracking stays at 0 or above, never negative: the face is already condensed.

**Figures are Geist.** Instrument Serif has no `tnum`. Geist does, and the app sets `font-variant-numeric: tabular-nums` on numeric cells and big figures (`Valuta`, `Punten`, `Belasting` amounts carry `tabular-nums` on the element).

**Missing glyphs.** Neither latin subset has arrows or checks (`→ ← ✓`). The stacks end in a system face, so those glyphs fall back per glyph.

**Loading.** `* Fallback` `@font-face` rules scale Times New Roman / Arial to the webfont metrics, so the swap does not reflow (CLS 0 measured on throttled 3G). `vite.config.ts` preloads the three hero faces (serif upright + italic, Geist upright) and fails the build if their hashed names are not found.

**Scale.** `html` is 17px. The page title is 2.6rem serif at 400, line-height 1.08. Base `h1` 1.75rem serif; `h2` 1.25rem and `h3` 1rem are Geist 600 (`h3` in mist). Body is Geist 1rem at 1.5. A module figure is Geist 2.1rem at 700, `-0.02em`, tabular. Eyebrows are 0.75rem at 400 with `0.02em` tracking.

**Landing page.** Body is Geist 18px / 1.55. Headlines are Instrument Serif: `h1` clamp(3.3rem, 8.4vw, 6.8rem) at line-height 1.02 and `-0.005em`, `h2` at 1.06 and 0. `h3`, the quote's `cite` and the small `.acts h2` are Geist.

**Landing responsive and slow-network rules.**

- The full bar (links, sign-in, CTA) needs ~800px, so the burger takes over at 860px. Below 520px the header CTA moves into the menu panel; the hero keeps its own. Buttons never wrap (`white-space: nowrap`).
- Touch targets are 44px or more: burger 44×44, FAQ summaries `min-height: 44px`, footer links get a padded hit area under `pointer: coarse`.
- The prerendered page paints in ~1.8s on 3G, but the bundle lands at ~6s. `public/lp-early.js` (same-origin, the CSP forbids inline script) records a sign-in/sign-up tap in that gap and marks the button `aria-busy`; `Landing.tsx` replays it on mount. Buttons that open the dialog carry `data-lp-tap`.

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

The marketing landing page (`src/styles/landing.css`) shares this curve as `--ease-out`. It adds three deliberate exceptions:

- **Press feedback.** Every real control gets `scale(0.98)` on `:active` — 120ms on `.btn`, 140ms on the rest, 0.96 on the sign-in dialog's close. The hover rule is scoped with `:not(:active)` so the later, equal-specificity declaration cannot override the press.
- **FAQ accordion.** `::details-content` animates `block-size` at 240ms — height is the one layout property an accordion may animate, since there is no transform equivalent. `allow-discrete` keeps the answer painted through the exit. Browsers without `::details-content` keep the instant behaviour.
- **Scroll reveal.** Content is visible by default; `.lp-reveal` is added at render time only when an `IntersectionObserver` can restore it. A failed bundle therefore cannot leave the prerendered page blank. When the mobile menu closes, the panel leaves in 160ms and its items in 140ms with no stagger; opening takes 300ms on the panel and 400ms on its items, 60ms apart. Out is faster than in, and nothing on the way out waits for its turn.

Reduced motion removes all three and shows the end state. Unlit words in the scroll-lit sentence sit at `opacity: 0.4` (~3.7:1 on midnight), not `0.3` (2.5:1), so the sentence meets WCAG AA for large text before its turn.

## Rules

- **Do** keep the two faces to their jobs: serif only at 28px and up at 400, Geist for everything else. A third face is a design change, not a component decision.
- **Do** put every number in tabular figures, and keep the `tnum` feature on.
- **Do** separate panels with tone and the hairline.
- **Do** keep cantaloupe for the one primary action per screen.
- **Don't** use cantaloupe as a selected state, a link, or a chart series.
- **Don't** use green or rose outside gain, loss and problem.
- **Don't** add a shadow to a resting panel.
- **Don't** introduce a grey outside the token list; use the hairline or a surface step.
- **Don't** hard-code a font stack; use `--font-display` / `--font-body`, which carry the metric fallbacks and the system tail for `→` and `✓`.
- **Don't** put the serif on a number, a label, or anything under 28px.

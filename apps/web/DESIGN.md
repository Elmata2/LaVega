---
name: LaVega App
description: The product surface at app.lavega.dev. The lavega.dev "Midnight" world as a working dashboard: near-black ground, Geist throughout (the landing keeps a display serif), honest tabular figures, cantaloupe for the one primary action.
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
    fontFamily: "Geist, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
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
  frame: "0px"
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

- One face in the app: Geist, page titles included. Only the landing page keeps Instrument Serif (its own `--serif` under `.lp`). Self-hosted from `src/assets/fonts/` with the OFL licenses.
- Two themes: midnight (dark, default) and mono (black and white, chosen in Profiel). Radius, type, spacing and motion are shared. See "Monochrome theme".
- The app is a full-viewport frame (`100dvh`): icon rail, account sidebar, main. No margin, radius or shadow. Only main scrolls.
- Depth is tone plus a 12% hairline. Only floating layers (dialogs, menus) cast a shadow.
- Cantaloupe is the one filled call to action; signal blue carries links, active state and focus.

## Colors

`color-scheme: dark` on `:root`. The light theme is `:root[data-theme="light"]` and changes colour only.

- **Midnight `#02070a`** — app surface. The frame fills the viewport, so there is no separate gutter ground.
- **Surface `#0d171d` / Surface-2 `#16222a`** — raised panels, then nested rows and inputs.
- **Ink `#ffffff`, Ink-soft `#e3e9ec`, Muted `#a9b4bb`** — primary text, the hover state of the active nav pill, secondary text.
- **Hairline `rgba(255,255,255,0.12)`** — every border. Never a second grey.
- **Signal blue `#0297de`** — links, active state, focus ring. Soft variant `rgba(2,151,222,0.16)` fills active pills.
- **Cantaloupe `#fc734d`** — the primary button and nothing else. Hover brightens the fill by 8%, it does not change the colour.
- **Gain `#5fd38d`, loss `#ff8f8f`, caution `#f2b84b`** — money in, money out, attention. Each is at least 4.5:1 on midnight, surface and surface-2; `scripts/check-midnight-contrast.mjs` measures both themes and exits non-zero on failure.
- **Chart blue / purple / teal** — data-viz accents and category dots. The spending pie adds five more slices but never green or red: those mean money in and out everywhere else, so a green slice would read as income.

Delta pills use `--pos-tint` / `--neg-tint`, built with `color-mix` in srgb. Do not replace them with Tailwind's `bg-pos/12`: the `@theme inline` indirection makes that modifier emit full opacity silently.

## Typography

**One family in the app** (2026-11-13; was two families, 2026-11-11). `--font-body` and `--font-mono` are Geist, and every app heading is Geist too. `--font-display` is gone. Instrument Serif is declared in `tokens.css` only for the landing page, which sets it through its own `--serif` under `.lp`; nothing in the app references it.

**Page title.** `.shell2-title` and base `h1`: Geist 600, 1.5rem, line-height 1.2, `-0.01em`. One line, truncates. A sans at the old 1.75rem / 400 serif size reads too loud.

**Figures are Geist.** Geist has real `tnum`, and the app sets `font-variant-numeric: tabular-nums` on numeric cells and big figures (`Valuta`, `Punten`, `Belasting` amounts carry `tabular-nums` on the element).

**Missing glyphs.** Neither latin subset has arrows or checks (`→ ← ✓`). The stacks end in a system face, so those glyphs fall back per glyph.

**Loading.** `* Fallback` `@font-face` rules scale Times New Roman / Arial to the webfont metrics, so the swap does not reflow (CLS 0 measured on throttled 3G). `vite.config.ts` preloads the three hero faces (serif upright + italic for the landing, Geist upright) and fails the build if their hashed names are not found.

**Scale.** `html` is 17px. The page title and base `h1` are 1.5rem Geist 600; `h2` 1.25rem and `h3` 1rem are Geist 600 (`h3` in mist). Body is Geist 1rem at 1.5. A module figure is Geist 2.1rem at 700, `-0.02em`, tabular. Eyebrows are 0.75rem at 400 with `0.02em` tracking.

**Landing page.** Body is Geist 18px / 1.55. Headlines are Instrument Serif: `h1` clamp(3.3rem, 8.4vw, 6.8rem) at line-height 1.02 and `-0.005em`, `h2` at 1.06 and 0. `h3`, the quote's `cite` and the small `.acts h2` are Geist.

**Landing responsive and slow-network rules.**

- The full bar (links, sign-in, CTA) needs ~800px, so the burger takes over at 860px. Below 520px the header CTA moves into the menu panel; the hero keeps its own. Buttons never wrap (`white-space: nowrap`).
- Touch targets are 44px or more: burger 44×44, FAQ summaries `min-height: 44px`, footer links get a padded hit area under `pointer: coarse`.
- The prerendered page paints in ~1.8s on 3G, but the bundle lands at ~6s. `public/lp-early.js` (same-origin, the CSP forbids inline script) records a sign-in/sign-up tap in that gap and marks the button `aria-busy`; `Landing.tsx` replays it on mount. Buttons that open the dialog carry `data-lp-tap`.

## Layout

- **Frame.** `.shell2` is `100dvh`, full width, no margin, radius or shadow. Rail (84px), account sidebar (296px, 240-440, collapsible), then main; only main scrolls, with a sticky 56px top bar. Below 1024px the rail and sidebar give way to a phone top bar, bottom bar and drawer.
- **Navigation.** The 84px rail (>= 1024px) or the phone bottom bar carries the owner's chosen modules; the rail and bar are described in the Personal app shell section below. The sticky 56px main top bar holds the sidebar toggle, title and actions.
- **Module grid.** `--grid-gap: 24px`, modules 200px (short) or 360px (tall), placed by `span` (1/2/3 columns). Adding a module is one `<Module span=…>` line, never a layout rewrite.
- **Spacing** is a 4px scale (`--sp-1` … `--sp-6`). Panels use 24px padding; main uses 32 / 24 / 16px side gutters at >= 1280 / 1024-1279 / < 1024.
- **Breakpoints.** The grid collapses 3 → 2 → 1 columns. At 1024px the rail and sidebar give way to the phone top bar, bottom bar and drawer.

## Personal app shell

Scope: the personal app (`apps/web`, `/app`). Code: `components/Shell.tsx`, `Rail.tsx`, `BottomBar.tsx`, `ShellDrawer.tsx`, `AccountSidebar.tsx`, `styles/shell.css`, `lib/sidebar.ts`. The class prefix is `shell2-*`. It stayed from the migration; the old shell is deleted, so there is no clash.

| Part                      | Value                                                                                | Rule                                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frame                     | `100dvh`, flex, no margin, radius or shadow, `--bg`                                  | Only main scrolls                                                                                                                                                                |
| Rail (>= 1024)            | 84px, `--surface`, 1px `--line` right                                                | Icon over a 12px label, 56px tall, 44px min hit area. Active: `--surface-2` fill, 3x20 `--ink` bar on the left edge, `aria-current="page"`. 84px (not 72) so no label truncates  |
| Account sidebar (>= 1024) | 296px default, 240-440, collapsible to 0                                             | Drag handle on the right edge. Double-click or Enter resets. Main keeps >= 480px, so the width clamps to `viewport - 84 - 480`. One 200ms width transition (`--ease-emphasized`) |
| First visit               | Sidebar open from 1280px, closed at 1024-1279                                        | A stored choice wins                                                                                                                                                             |
| Main                      | Fluid, no max-width. Sticky 56px top bar: toggle, title, actions                     | Gutters 32 / 24 / 16px at >= 1280 / 1024-1279 / < 1024. Vertical padding 24px                                                                                                    |
| Module grid               | Container queries on `.content-container`, 1200 and 900px                            | Measured on main, not the viewport, so the rail and sidebar do not make 3 columns appear too early                                                                               |
| Phone (< 1024)            | 48px top bar (menu, brand, Profiel), fixed bottom bar 56px + safe-area inset, drawer | No rail, no inline sidebar. The 48px bar is the only sticky bar                                                                                                                  |
| Bottom bar                | Overzicht, Optimalisatie, Rekeningen, then "Meer" when other modules are on         | "Meer" opens the drawer for the remaining modules                                                                                                                                |
| Drawer                    | `min(88vw, 360px)`, left sheet, scrim `--scrim`                                      | Lists all modules, then the account sidebar body. Closes on scrim, Escape and navigation                                                                                         |

**Brand and Jouw plan.** The rail brand is a text "LV" monogram (`.shell2-rail-brand`, Geist 600, 15px, `--ink`, `aria-label="LaVega"`); the phone bar keeps the "LaVega" wordmark. Jouw plan is in no nav list (registry `nav: false`: rail, bottom bar, drawer, module picker): it is reached from the "Jouw plan" card at the top of Profiel, and Profiel is the current item while `/app/plan` is open. "Widget toevoegen" shows on Overzicht only.

Storage: `localStorage["lavega.sidebar"]` = `{"open": boolean, "width": number}`. Read in try/catch, width clamped, defaults on anything invalid. Written on pointer-up, not while dragging.

**Accessibility.** One `<nav>` in the DOM at a time (`useMediaQuery("(min-width: 1024px)")`, not CSS `display`): rail `nav.shell2-rail` or bottom bar `nav.shell2-bottombar`. Phone handles: `.shell2-phonebar-menu`, `.shell2-drawer`. Skip link "Naar inhoud" is first and moves focus to `#main`. Sidebar is `<aside aria-label>`; the collapsed sidebar is `inert` and `visibility: hidden`. Resize handle is `role="separator"` with ArrowLeft/Right 16px, Shift 64px, Home/End to min/max. Drawer is a modal dialog: focus moves in and returns to the opener, Escape closes, the page behind is `inert`.

**Motion budget.** Everything else is static.

| Element                                           | Motion                                                |
| ------------------------------------------------- | ----------------------------------------------------- |
| Rail, bar, drawer and sidebar row hover or active | 120ms ease-out, background and colour                 |
| Sidebar open or close                             | 200ms width, `--ease-emphasized`. None while dragging |
| Drawer                                            | `transform` 220ms in, 180ms out, `--ease-emphasized`  |
| Scrim                                             | `opacity` 150ms                                       |
| `prefers-reduced-motion: reduce`                  | All of the above are instant                          |

## Monochrome theme

Scope: the personal app. Selector `:root[data-theme="mono"]` in `styles/tokens.css`, after the light block. Scheme is light (white ground, black ink), `color-scheme: light`. Every `#rrggbb` token in `:root` is redefined there; `scripts/check-midnight-contrast.mjs` fails otherwise, and `src/contrast-script.test.ts` runs it.

| Token                                | Mono                                         | Use                                                   |
| ------------------------------------ | -------------------------------------------- | ----------------------------------------------------- |
| `--bg` / `--surface` / `--surface-2` | #ffffff / #f5f5f5 / #ebebeb                  | Ground, cards and rail, inset fills and active nav    |
| `--ink` / `--ink-soft` / `--on-ink`  | #000000 / #262626 / #ffffff                  | Text, hover, text on ink                              |
| `--muted`                            | #595959                                      | Secondary text, 5.88:1 or better on all three grounds |
| `--line`                             | rgba(0,0,0,.12)                              | Hairline                                              |
| `--accent` / `--accent-soft`         | #000000 / rgba(0,0,0,.06)                    | Links (underlined), active, focus ring                |
| `--cta` / `--on-cta`                 | #000000 / #ffffff                            | The one filled action: black pill                     |
| `--pos` / `--neg` / `--warn`         | #000000 / #404040 / #262626                  | Never the only signal, see below                      |
| `--chart-blue` / `-purple` / `-teal` | #000000 / #4d4d4d / #737373                  | 3:1 on bg, surface and surface-2                      |
| `--slice-1..8`, `--slice-rest`       | #1a1a1a to #a0a0a0, rest #b0b0b0             | Informational in the script; labels carry meaning     |
| `--card-face-1..4`, `--card-text`    | #1f1f1f, #2b2b2b, #383838, #454545; #ffffff  | Bank card faces                                       |
| `--scrim` / `--shadow-float`         | rgba(0,0,0,.4) / 0 24px 80px rgba(0,0,0,.14) | Floating layers only                                  |

Behaviour rules (they also hold in midnight, because they help colour-blind users):

| Rule                                                                                                                                       | Where                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Signed amounts: sign first, real minus U+2212, zero unsigned ("−€ 5,00", "+€5,00")                                                         | `formatSignedEuroIn`, `formatSignedCurrencyIn`, `formatSignedPercentIn` in `format.ts` |
| Status never by tint alone: warning is a dashed border plus triangle, problem a solid border plus cross, success a solid border plus check | `components/ui/StatusLine.tsx`; `Badge` takes `tone`                                   |
| Dot shapes: positive filled circle, warning hollow ring, negative diamond                                                                  | `.dot-pos`, `.dot-warn`, `.dot-neg` in `base.css`                                      |
| Charts with more than 3 series carry a legend with figures or direct labels. Adjacent segments are parted by a 2px `--bg` line             | `SpendPie` legend and arc gap, `.proportion-bar span + span` in `base.css`             |
| Bank logos are greyscale                                                                                                                   | `:root[data-theme="mono"] .bank-logo` in `base.css`                                    |
| Focus ring 2px `--accent` (black in mono, Signal Blue in midnight). Shell controls draw it inset (offset -2px); the resize handle uses a grip colour change and a `forced-colors` outline | `base.css`; `styles/shell.css`                                                                         |
| Selected segmented option and the primary button: black pill, white label                                                                  | `--cta`, `--on-cta`                                                                    |
| The landing page stays midnight in both themes                                                                                             | `MidnightScope` in `Root.tsx`; `theme-init.js` applies mono on `/app` paths only       |

Persistence: `localStorage["lavega.theme"]` is `"midnight"` or `"mono"`; anything else is midnight. `public/theme-init.js` runs before first paint (the CSP blocks inline script) and sets `data-theme` and `color-scheme`. A `storage` event keeps tabs in step. The switch is the "Weergave" card in Profiel and is instant, with no colour transition. Known gap: input borders at the 12% line are below 3:1 in all themes.

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

- **Do** keep the app on Geist. The serif belongs to the landing page. A second face in the app is a design change, not a component decision.
- **Do** put every number in tabular figures, and keep the `tnum` feature on.
- **Do** separate panels with tone and the hairline.
- **Do** keep cantaloupe for the one primary action per screen.
- **Don't** use cantaloupe as a selected state, a link, or a chart series.
- **Don't** use green or rose outside gain, loss and problem.
- **Don't** add a shadow to a resting panel.
- **Don't** introduce a grey outside the token list; use the hairline or a surface step.
- **Don't** hard-code a font stack; use `--font-body`, which carry the metric fallbacks and the system tail for `→` and `✓`.
- **Don't** put the serif anywhere in the app.

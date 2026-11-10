---
name: LaVega Investing
description: The lavega.dev "Midnight" world applied to investing: dark, serif voice, honest tabular numbers.
colors:
  midnight: "#02070a"
  surface: "#0d171d"
  surface-2: "#16222a"
  white: "#ffffff"
  mist: "#a9b4bb"
  hairline: "rgba(255, 255, 255, 0.12)"
  coral: "#fc734d"
  signal-blue: "#0297de"
  gain-green: "#5fd38d"
  loss-rose: "#ff8f8f"
  caution-amber: "#f2b84b"
  chart-blue: "#4db4f0"
  chart-purple: "#a99bff"
  chart-teal: "#4fd1c0"
  chart-amber: "#ffc247"
  chart-pink: "#ff7fb0"
typography:
  display:
    fontFamily: "Instrument Serif, Georgia, serif"
    fontSize: "3.75rem"
    fontWeight: 400
    lineHeight: 1.18
    letterSpacing: "0.01em"
  headline:
    fontFamily: "Instrument Serif, Georgia, serif"
    fontSize: "1.875rem"
    fontWeight: 400
    lineHeight: 1.18
    letterSpacing: "0.01em"
  title:
    fontFamily: "Instrument Serif, Georgia, serif"
    fontSize: "1.5rem"
    fontWeight: 400
    lineHeight: 1.18
    letterSpacing: "0.01em"
  figure:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "3rem"
    fontWeight: 600
    fontFeature: "tnum"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    fontFeature: "tnum"
  caption:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
rounded:
  chip: "10px"
  tile: "14px"
  lg: "20px"
  card: "20px"
  frame: "32px"
  pill: "999px"
spacing:
  card-pad: "20px"
  card-pad-sm: "24px"
components:
  button-primary:
    backgroundColor: "{colors.coral}"
    textColor: "{colors.midnight}"
    rounded: "{rounded.pill}"
    padding: "10px 16px"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.white}"
    rounded: "{rounded.pill}"
    padding: "10px 16px"
  button-ghost:
    textColor: "{colors.mist}"
    rounded: "{rounded.pill}"
    padding: "8px 12px"
  button-destructive:
    textColor: "{colors.loss-rose}"
    rounded: "{rounded.pill}"
    padding: "10px 16px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.white}"
    rounded: "{rounded.card}"
    padding: "20px"
  input:
    backgroundColor: "{colors.midnight}"
    textColor: "{colors.white}"
    rounded: "{rounded.tile}"
    padding: "10px 12px"
---

# Design System: LaVega Investing

## Overview

**Creative North Star: "Midnight Ledger"**

The shared lavega.dev "Midnight" world, applied to investing: a near-black canvas, a serif voice for headings, and plain tabular figures. Investing-web and apps/web use the same palette; `apps/web/src/styles/tokens.css` is the palette source and `apps/investing-web/src/styles/tokens.css` re-expresses it as HSL triplets so Tailwind alpha modifiers (`bg-primary/10`) keep working. Do not switch investing to raw hex or var-to-var `@theme` values: alpha modifiers would then silently emit full opacity.

Density is calm and moderate. Panels are separated by tone (midnight, surface, surface-2) and a 12% white hairline, never by shadow. Color is rare and meaningful: coral means act, blue means link, active or focus, green and rose mean gain and loss, amber means caution. Numbers are the content: Inter, tabular, aligned, never decorated.

Visual anti-references: neon crypto-trading dashboards (glow, gradient numbers, gamified color); a small uppercase kicker above a heading; coral used as a selected or active state.

**Key Characteristics:**

- Dark only (`color-scheme: dark`); there is no light theme.
- Instrument Serif for the wordmark and headings, Inter with tabular numerals for everything else.
- Tone-plus-hairline depth; only floating layers cast a shadow.
- Coral is the one filled call to action; blue carries links, active state and focus.
- Radii follow the lavega.dev scale: pill buttons, 20px cards, 14px tiles.

## Colors

A blue-black canvas with two steps of lift, one warm coral for action, one cool blue for orientation, and muted-light semantic tones that hold 4.5:1 on every surface.

### Primary

- **Coral** (#fc734d): the only primary action. Filled CTA buttons, with Midnight text (7.41:1 on the background, 5.94:1 on surface-2).
- **Signal Blue** (#0297de): links, active and selected state, focus ring (`accent` and `ring` roles). Text on it is Midnight.

### Neutral

- **Midnight** (#02070a): page background, input fill, text on coral and blue.
- **Surface** (#0d171d): cards and popovers.
- **Surface 2** (#16222a): secondary and muted fills, nav track, hover on ghost and outline.
- **White** (#ffffff): body and heading text.
- **Mist** (#a9b4bb): muted and secondary text.
- **Hairline** (rgba(255,255,255,0.12)): every border and input stroke. Stored as `0 0% 100% / 0.12` so `border-border` works.

### Semantic

- **Gain Green** (#5fd38d): positive returns and gain figures.
- **Loss Rose** (#ff8f8f): negative returns, destructive actions, problem status.
- **Caution Amber** (#f2b84b): warnings, partial, stale or estimated data.

### Chart series

Blue (#4db4f0), purple (#a99bff), teal (#4fd1c0), amber (#ffc247), pink (#ff7fb0, stored as `chart-coral` so the token name is stable; it is deliberately not the CTA hue). Teal also drives the hatched fill for estimated net-worth regions.

### Named Rules

**The One Action Rule.** Coral is the only filled call to action. It is never a selected, active or hover state, a link, or a data series.
**The Blue Orientation Rule.** Blue (#0297de) marks links, the active item and keyboard focus. It is never a fill for a primary action.
**The Gain/Loss Rule.** Green and rose carry meaning only for gain, loss and problem. Chart series never use green, rose, or the coral hue.
**The Contrast Rule.** Every text and semantic token must reach 4.5:1 on midnight, surface and surface-2; `apps/investing-web/scripts/check-contrast.mjs` proves it. Lowest measured: signal blue on surface-2 at 5.00:1; foreground on midnight is 20.23:1, mist on surface-2 is 7.67:1, gain 8.65:1 and rose 7.39:1 on surface-2.

## Typography

**Display Font:** Instrument Serif (Georgia, serif), one weight (400), roman and italic
**Body Font:** Inter (system-ui, sans-serif), weights 400 to 700

**Character:** A condensed literary serif over a plain grotesque. The serif gives the product its voice; Inter keeps every figure, control and small label honest.

### Hierarchy

- **Display** (400, 3.75rem at lg, 2.25rem on phones): the sign-in headline.
- **Headline** (400, 1.875rem): card titles (`CardTitle` default), the wordmark at 1.875rem.
- **Title** (400, 1.5rem): compact card titles (`size="md"`), sub-headings at 1.25rem.
- **Figure** (Inter 600, tabular, 3rem at md for portfolio value, 1.5 to 1.875rem for secondary figures): headline numbers.
- **Body** (Inter 400, 0.875rem): running text, controls, table cells.
- **Caption** (Inter 600, 0.75rem): chips, notes, column labels.

### Named Rules

**The One Weight Rule.** Instrument Serif has one weight. Hierarchy comes from size. The face is declared over weight 100 to 900 so a stray `font-semibold` renders the real glyphs, not a faux bold; do not add bold to serif on purpose.
**The Serif Breathing Rule.** Instrument Serif is condensed with tall ascenders and long descenders, so serif text takes `line-height: 1.18`, `letter-spacing: 0.01em` and `padding-block: 0.04em`. This rule is unlayered in `tokens.css` so it beats Tailwind `text-*`, `leading-*` and `tracking-*` utilities, which otherwise crop headings. Never put `leading-none` or `tracking-tight` on serif.
**The Tabular Rule.** Instrument Serif has no tabular numerals. Every figure, table, input, small control and text under 14px is Inter with `tabular-nums` (set on `body`), so columns align and values do not jitter.

## Layout

Card-based dashboard on a midnight canvas. Card padding is 20px, 24px from the `sm` breakpoint (640px). Card header and content stack with 6px to 16px gaps; `loose` content uses 20px vertical rhythm. The Overview opens with a three-cell KPI row (portfolio value, today, total return) fixed above the widget grid, framed by top and bottom hairlines, not a card, so a saved layout can never hide the answer. On phones the value spans a full row and the other two cells share the next. The auth pages stack context above the form on phones and sit side by side from `lg` (max-w-5xl). Cards keep their radius at every size.

## Elevation & Depth

Flat. Depth is tone plus hairline: midnight canvas, surface cards, surface-2 for fills and hover. `shadow-sm` and `shadow-md` are defined as `none`, so legacy `shadow-md` classes on cards render flat. Only floating layers (menus, popovers, tooltips, dialogs) lift, with a dark-on-dark shadow.

### Shadow Vocabulary

- **Float** (`box-shadow: 0 24px 48px -16px rgba(0,0,0,0.7), 0 4px 12px -4px rgba(0,0,0,0.5)`): floating layers only (`shadow-xl`).
- **Scrim** (`rgba(2, 7, 10, 0.72)`): behind modal layers.

### Named Rules

**The Tone-Not-Shadow Rule.** A resting panel is separated by tone and a 12% white hairline. A resting panel never gets a shadow, glow or gradient.

## Shapes

Soft and generous, on the lavega.dev scale: pill (999px) for buttons, nav and chips of state; card and `lg` 20px; frame 32px for outer shells; tile 14px for inputs, status lines and KPI tiles; chip 10px. Borders are 1px hairline; empty states use a dashed hairline.

## Components

### Buttons

- **Shape:** pill, semibold 14px, `pressable` (scale .98 on active, 150ms ease-out). Disabled: 50% opacity, no pointer events.
- **Primary:** Coral fill, Midnight text, hover at 90% coral, 10px 16px. The only filled CTA.
- **Outline:** transparent, hairline border, Surface 2 on hover.
- **Ghost:** Mist text, Surface 2 on hover with white text, 8px 12px.
- **Destructive:** loss-rose tint (`negative/15` fill, `negative/40` border, rose text), not a solid red fill; hover `negative/25`.
- **Small:** `size="sm"`, 12px text, 8px 12px.
- **Focus:** global `:focus-visible` ring, 2px Signal Blue with a 2px midnight offset.

### Cards / Containers

- **Corner Style:** 20px. **Background:** Surface. **Border:** hairline. **Shadow:** none. **Padding:** 20px (24px at sm).
- **Title:** Instrument Serif, 1.875rem (1.5rem compact).
- **Empty variant:** transparent, dashed hairline, no shadow.

### Inputs / Fields

- **Style:** Midnight fill, hairline stroke, 14px radius, 10px 12px padding, Inter 14px.
- **Focus:** the shared blue ring. Field stacks use 8px label-to-input gap and 24px between fields; descriptions are Mist 14px.

### KPI row

Three cells divided by hairlines under a top and bottom hairline: label in Mist 14px, figure in Inter semibold tabular (3rem value, 1.5 to 1.875rem for change and return), a 12px Mist note beneath. Gain and loss color the figure with green or rose. An unknown figure reads "Unknown" in Mist, with its reason in the note; never zero.

### Status line

One rounded-tile line under the KPI row, `role="alert"`. Problem: rose-tinted border and fill (`negative/30`, `negative/5`) with a rose alert icon; warning: amber-tinted (`warning/30`, `warning/10`). Closed it shows one sentence (count, then the first two problems) plus the first available action; "Details" opens every message.

### Disclosure

Native `<details>` with a `cursor-pointer` summary at 12px Mist for supporting detail ("About these figures", estimated prices). No custom chevron chrome. Partly-unknown value is an amber-tinted tile (`warning/10`) inside it.

### Navigation

Header with the serif wordmark "LaVega" (1.875rem) and a small Mist "Investing" beside it. The module nav is a pill track on Surface 2; the active item is a white pill with midnight text (`bg-foreground text-background`), inactive items are Mist with white on hover. Active is white, never coral.

### Auth layout

Serif wordmark and a small "Investing" in Mist, a serif headline ("Every broker. One honest view.") with a 38ch Mist promise, and the form card beside it from `lg`. Below the form, a 12px Mist honesty line: "Your data is encrypted. We hold the keys, so technically we can access your data. Broker connections are read only." Its meaning must match the public FAQ; do not soften or strengthen it. The page fades in over 180ms.

### Motion

Auth fade 180ms `cubic-bezier(0.23, 1, 0.32, 1)`; button press 150ms ease-out; mention menu 120ms ease-out with 4px rise and 0.97 scale; chart axis label opacity 160ms. All of these are disabled under `prefers-reduced-motion: reduce`.

## Do's and Don'ts

### Do:

- **Do** use Inter with tabular numerals for every figure, table, input, control and text under 14px.
- **Do** keep coral for the single filled CTA and blue for links, active state and focus.
- **Do** separate panels with tone and the 12% white hairline.
- **Do** show unknown figures as "Unknown" with a reason, never as zero.
- **Do** keep serif headings at `line-height: 1.18` with `0.01em` tracking, and build hierarchy from size alone.
- **Do** honor `prefers-reduced-motion` for all animation and transitions.
- **Do** use the semantic radius tokens (card, tile, chip, pill, frame), not ad hoc values.
- **Do** run `check-contrast.mjs` after any palette change; every text token stays at or above 4.5:1 on midnight, surface and surface-2.

### Don't:

- **Don't** drift toward neon crypto-trading dashboards: no glow, no gradient numbers, no gamified color.
- **Don't** put a small uppercase kicker or eyebrow above a heading.
- **Don't** use coral as a selected, active or hover state, or as a chart series.
- **Don't** use green or rose except for gain, loss and problem; chart series never use green, rose or coral hues.
- **Don't** put a shadow on a resting panel; only floating layers lift.
- **Don't** set `leading-none` or `tracking-tight` on serif text, or add bold to it.
- **Don't** set figures, tables or inputs in Instrument Serif.

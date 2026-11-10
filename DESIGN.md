---
name: LaVega Investing
description: Warm-paper private ledger for a self-directed investor, serif voice, honest tabular numbers.
colors:
  paper: "hsl(40 27% 97%)"
  ink: "hsl(60 7% 10%)"
  card: "hsl(0 0% 100%)"
  ledger-blue: "hsl(202 55% 27%)"
  linen: "hsl(40 20% 93%)"
  graphite: "hsl(48 5% 41%)"
  hairline: "hsl(40 17% 88%)"
  gain-green: "hsl(101 35% 35%)"
  loss-rust: "hsl(11 59% 44%)"
  caution-amber: "hsl(39 71% 41%)"
  chart-blue: "hsl(211 47% 44%)"
  chart-purple: "hsl(249 42% 59%)"
  chart-teal: "hsl(174 51% 37%)"
  chart-amber: "hsl(39 71% 48%)"
  chart-coral: "hsl(11 59% 55%)"
typography:
  display:
    fontFamily: "EB Garamond, Georgia, serif"
    fontSize: "1.5rem"
    fontWeight: 600
    letterSpacing: "-0.025em"
  title:
    fontFamily: "EB Garamond, Georgia, serif"
    fontSize: "1.25rem"
    fontWeight: 600
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    letterSpacing: "0.16em"
rounded:
  chip: "10px"
  tile: "14px"
  lg: "18px"
  card: "22px"
  frame: "26px"
  pill: "999px"
spacing:
  card-pad: "20px"
  card-pad-sm: "24px"
components:
  button-primary:
    backgroundColor: "{colors.ledger-blue}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    padding: "10px 16px"
  button-outline:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "10px 16px"
  button-ghost:
    textColor: "{colors.graphite}"
    rounded: "{rounded.pill}"
    padding: "8px 12px"
  button-destructive:
    backgroundColor: "{colors.loss-rust}"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    padding: "10px 16px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "20px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.tile}"
    padding: "10px 12px"
---

# Design System: LaVega Investing

## Overview

**Creative North Star: "The Private Ledger"**

A quiet, bookish record of what you own and why. Warm paper under white cards, a serif voice for headings, one deep ledger-blue for action. Numbers are the content: tabular, aligned, never decorated. The interface reads like a well-kept personal ledger, not a trading floor.

Density is calm and moderate. Surfaces are soft-lifted and rounded; controls are tactile, with a small press-scale. Color is rare and meaningful: blue means act, green and rust mean gain and loss, amber means caution.

Visual anti-reference: neon crypto-trading dashboards (dark, glowing, gamified). No dark theme exists in code today.

**Key Characteristics:**
- Warm paper canvas, white cards, hairline borders.
- EB Garamond for headings, Inter for everything else.
- Generous radii: cards 22px, tiles 14px, pill buttons.
- Diffuse, low-contrast shadows; no hard drop shadows.
- Tabular numerals on every figure.

## Colors

Warm neutrals with one cool, restrained blue; semantic gain/loss tones are muted, not saturated.

### Primary
- **Ledger Blue** (hsl(202 55% 27%)): the only action color. Primary buttons, focus ring, accent. Also the `accent` role.

### Neutral
- **Paper** (hsl(40 27% 97%)): page background and input fill.
- **Card White** (hsl(0 0% 100%)): cards and popovers.
- **Ink** (hsl(60 7% 10%)): body and heading text.
- **Graphite** (hsl(48 5% 41%)): muted and secondary text.
- **Linen** (hsl(40 20% 93%)): secondary and muted fills, hover on ghost and outline.
- **Hairline** (hsl(40 17% 88%)): borders and input strokes.

### Semantic
- **Gain Green** (hsl(101 35% 35%)): positive returns.
- **Loss Rust** (hsl(11 59% 44%)): negative returns, destructive actions.
- **Caution Amber** (hsl(39 71% 41%)): warnings, partial or stale data.

### Chart series
Blue (hsl(211 47% 44%)), purple (hsl(249 42% 59%)), teal (hsl(174 51% 37%)), amber (hsl(39 71% 48%)), coral (hsl(11 59% 55%)). Teal also drives the hatched fill for estimated net-worth regions.

### Named Rules
**The One Voice Rule.** Ledger Blue is the single action color; it never doubles as a data series.
**The Gain/Loss Rule.** Green and rust carry meaning only for gain and loss; never use them as decoration or series colors.

## Typography

**Display Font:** EB Garamond (Georgia, serif), weights 500 to 700
**Body Font:** Inter (system-ui, sans-serif), weights 400 to 700

**Character:** A literary serif over a neutral grotesque. The serif gives the ledger its voice; Inter keeps figures and controls plain.

### Hierarchy
- **Display** (600, 1.5rem, tight tracking -0.025em): card titles.
- **Title** (600, 1.25rem, tight tracking): compact card titles.
- **Body** (400, 0.875rem): all running text and controls; muted text uses Graphite.
- **Label** (600, 0.6875rem, 0.16em tracking, uppercase eyebrow): section eyebrows.

### Named Rules
**The Tabular Rule.** Every figure uses tabular numerals so columns align and changes do not jitter.

## Layout

Card-based dashboard on a paper canvas. Card padding is 20px, 24px from the `sm` breakpoint. Card header and content stack with 6px to 16px gaps; `loose` content uses 20px vertical rhythm. Responsive down to phone width; cards keep their radius at every size.

## Elevation & Depth

Hybrid: hairline border plus a diffuse ambient shadow on cards; layering comes from white cards over warm paper.

### Shadow Vocabulary
- **Soft** (`0 1px 2px rgba(26,26,23,0.04), 0 18px 40px -28px rgba(26,26,23,0.16)`): cards and primary buttons at rest.
- **Float** (`0 32px 64px -28px rgba(26,26,23,0.3), 0 6px 16px -10px rgba(26,26,23,0.12)`): overlays and menus.

### Named Rules
**The Quiet Shadow Rule.** Shadows are long, soft and low in opacity; empty cards drop the shadow and use a dashed border.

## Shapes

Soft and generous. Pill (999px) for buttons, 22px cards, 26px outer frames, 18px default, 14px inputs and tiles, 10px chips. Borders are 1px hairline; empty states use a dashed border.

## Components

### Buttons
- **Shape:** pill (999px), semibold 14px, `pressable` (scale .98 on active, 150ms ease-out).
- **Primary:** Ledger Blue fill, paper text, soft shadow, 10px 16px.
- **Outline:** white fill, hairline border, Linen on hover.
- **Ghost:** Graphite text, Linen on hover, 8px 12px.
- **Destructive:** Loss Rust fill, white text.
- **Focus:** 2px Ledger Blue ring with 2px paper offset. **Disabled:** 50% opacity.

### Cards / Containers
- **Corner Style:** 22px. **Background:** white. **Border:** hairline. **Shadow:** Soft. **Padding:** 20px (24px at sm).
- **Empty variant:** transparent, dashed border, no shadow.

### Inputs / Fields
- **Style:** Paper fill, hairline stroke, 14px radius, 10px 12px padding, 14px text.
- **Focus:** shared Ledger Blue ring.

### Mention menu
Popover that enters with a 120ms fade, 4px rise and 0.97 scale; disabled under reduced motion.

## Do's and Don'ts

### Do:
- **Do** use tabular numerals for every figure.
- **Do** keep Ledger Blue as the only action color.
- **Do** show unknown figures as unknown with a reason.
- **Do** honor `prefers-reduced-motion` for all transitions.
- **Do** use the semantic radius tokens (card, tile, chip, pill), not ad hoc values.

### Don't:
- **Don't** drift toward neon crypto-trading dashboards: no glow, gamified gradients, or dark-only terminals.
- **Don't** use green or rust except for gain and loss.
- **Don't** use hard, short drop shadows.
- **Don't** use a sans-serif for card titles; headings stay EB Garamond.

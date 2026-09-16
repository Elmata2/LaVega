# 0005 — Tailwind and shadcn in the personal app, without a rewrite

**Status:** foundation landed on `feat/web-tailwind-shadcn`, conversion not started.
**Date:** 16 September 2026.

## Why

`apps/investing-web` and `apps/web` currently look like two products. The
investing app was migrated to Tailwind v4 in `719773f`; the personal app has
never used Tailwind at all. Aligning them is a long-term goal, not a deadline
one.

## What the two apps actually started from

This is the fact that shapes everything below, and it was not obvious:

| | investing-web | apps/web |
| --- | --- | --- |
| Tailwind before | yes, v3 | **none** |
| hand-written CSS | 149 lines | **6,343 lines, 8 files** |
| components | 15 | 48 |
| `className` usages | few | **1,182** |

So "do the same update" is not the same job. For investing-web it was a v3 → v4
migration. Here it is adopting a styling system from scratch and re-expressing
1,182 class usages against a bespoke stylesheet forty times the size.

## Decision

Adopt Tailwind as a **coexisting** layer, and convert components one at a time.

Specifically, `src/styles/tokens.css` imports only Tailwind's theme and
utilities:

```css
@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);
```

**Preflight is deliberately omitted.** Importing `tailwindcss` whole brings a
reset that rewrites margins, box-sizing, and the default rendering of headings,
lists and form controls. Against 6,343 lines of CSS that assume the browser
defaults, that silently restyles every screen — and every test keeps passing,
because none of them assert on appearance. That failure mode is the whole
reason for this file.

An `@theme inline` block maps Tailwind's namespaces onto the variables
`tokens.css` already defines, so `bg-surface` compiles to `var(--surface)` and
`rounded-card` to `var(--r-card)`. Verified by building a probe component and
reading the emitted CSS. A converted component therefore cannot drift from an
unconverted one: they resolve to the same value.

## Evidence the foundation changed nothing

The built stylesheet went from 816 rule blocks to 885. Every one of the 816
pre-existing blocks is still present, byte for byte — the diff is purely
additive theme variables. `apps/web` stayed at 1149/1149 tests, typecheck and
lint clean.

## How to continue

Convert one component per change, smallest first, each with its own visual
check against the same screen before and after. Do **not** batch screens: the
test suite cannot catch a visual regression, so the review is a human looking at
it, and that only works at one screen at a time.

Adopt Preflight last, as its own deliberate step with its own visual pass, once
little enough hand-written CSS remains for it to matter. Adopting it early is
the one move that would make this irreversible.

## What this is not

Not scheduled before the design-partner session. The app was verified end to end
on 14 September — 2,619 tests, and an English sweep clean across twelve routes
with real data. A restyle touches every screen that pass validated, and
re-verifying it is slow and manual. Partner feedback on the product is worth
more than partner feedback on a restyle.

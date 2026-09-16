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

## The prerequisite this ADR originally missed

Converting `ModuleGrid` second turned up something that changes the order of
the work. **Eleven test files read the stylesheets directly and assert on the
rules**, and `module-grid.test.ts` parses every `@media` block into a map keyed
by breakpoint. `module-grid.ts` says why out loud: the class names are "the
*only* coupling between the React primitives and styles/modules.css, so both
sides are pinned by tests", and `module-grid.test.ts` adds "this repo has no
render/DOM test lib".

So the CSS text is not incidental here. It is the contract, and it is the only
guard on homescreen layout. Converting a component deletes the rules its test
reads; the test then fails, or passes while asserting nothing.

That splits the stylesheet in two:

| under test contract | free |
| --- | --- |
| `base.css` 1588, `blocks.css` 1048, `charts.css` 816, `modules.css` 358 | `landing.css` 1129, `views.css` 921, `worldmap.css` 394 |
| 3,810 lines, 11 test files | 2,444 lines, none |

`ModuleGrid` and `Module` are **excluded for now** for a second reason too: their
media queries are desktop-first (`max-width: 1200px`, `900px`) while Tailwind is
mobile-first (`min-width`). Converting them means inverting the breakpoint logic,
which is easy to get subtly and invisibly wrong on the one layout every screen
depends on.

**The replacement for CSS-as-contract already exists in this branch.** The
DeltaPill conversion was verified by rendering old rules and new classes side by
side against the real built stylesheet and diffing `getComputedStyle`. That is
strictly stronger than asserting on CSS text: it tests what the browser computes,
not what the file says, and it keeps working after a conversion. jsdom is
available now in a way it was not when those tests were written.

So the order is: convert what is free, and before touching the rest, replace the
stylesheet-reading assertions with computed-style ones.

## Four traps, all of which fail silently

Every one of these produces a wrong screen with a green suite. That is the
shape of the risk in this migration, and none of them is caught by a test.

**1. Alpha modifiers on indirect tokens are dropped.** `bg-pos/12` emits full
opacity, because `@theme inline` points `--color-pos` at another variable and
Tailwind cannot resolve it at build time to mix against. Use a `--x-tint` token
built with `color-mix(in srgb, var(--x) N%, transparent)`.

**2. Unlayered CSS beats layered CSS, regardless of specificity.** Tailwind
utilities compile into `@layer utilities`; every hand-written sheet here sat
outside any layer and therefore won against them silently. Two workers hit this
independently and worked around it with hundreds of `!` modifiers. FIXED AT THE
ROOT: all six hand-written sheets are now wrapped in `@layer components`, so a
utility on a converted element wins as it should. Verified by diffing
`getComputedStyle` for `h2`, `button` and `input` between the migrated build and
production; identical character for character. The `!` workarounds are now
redundant and can be swept.

**3. `@theme` only expands in the file that imports Tailwind.** A per-file
`@theme inline` block compiles to nothing, so `bg-lp-ink` silently never exists.
Either register the token in `tokens.css`, or use an arbitrary value against the
custom property directly: `bg-[var(--lp-ink)]`.

**4. Do not remap Tailwind's numeric spacing scale.** The first version of
`tokens.css` mapped `--spacing-1..6` onto `--sp-1..6`. Steps 1 to 4 agree, but
`--sp-5` is 24px where Tailwind's 5 is 20px, and `--sp-6` is 32px where
Tailwind's 6 is 24px — so `p-6` meant one thing here and another everywhere
else, including the app this migration exists to align with. Removed. The scale
is standard: 24px is `6`, 32px is `8`.

**5. `max-[560px]:` is not `@media (max-width: 560px)`.** Tailwind compiles the
`max-*` variant to `not (min-width: 560px)`, which EXCLUDES exactly 560px; the
hand-written media query includes it. On a responsive boundary that is a real
one-pixel behaviour change, and only visible by reading the built CSS. Use the
arbitrary at-rule form `[@media(max-width:560px)]:`, which compiles byte-identical
to the original condition. This matters everywhere in this app, because its
breakpoints are all desktop-first `max-width`.

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

# 0005 — Tailwind and shadcn in the personal app, without a rewrite

**Status:** conversion in progress on `feat/web-tailwind-shadcn`. Stylesheets
6,343 lines at the start, 4,436 as of 17 September. Preflight not adopted.
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
| `base.css`, `blocks.css`, `charts.css`, `modules.css`, `worldmap.css` | `landing.css`, `views.css` |
| 12 test files | none |

`worldmap.css` was originally listed as free and is not. `Globe.test.tsx` reads
it through a `blad("worldmap.css")` helper rather than a literal
`styles/worldmap.css` path, so the grep that built this table missed it — and
the rule it reads is load-bearing, since the test regex-parses the
`--lv-globe-*` custom properties to recompute WCAG contrast over the map's
`color-mix()` palette. Before trusting this column for any sheet, grep the
basename, not the path.

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

## Ten traps, all of which fail silently

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

**6. The bare `rounded` utility needs `--radius`, not `--radius-DEFAULT`.**
Tailwind v4 keys it off `--radius`; a `-DEFAULT` suffix is simply an unused
token, so `rounded` fell back to Tailwind's own 0.25rem instead of this app's
18px. This one bit for real: a worker converted `border-radius: var(--r)` to
`rounded` and verified it against a build that already had the bug, so the
comparison agreed at 4px on both sides and the regression passed review. Fixed
in `tokens.css`. The lesson generalises — verifying a conversion against a
broken theme proves only that both sides are broken the same way.

**7. A utility applied unconditionally defeats a state class.** Now that the
sheets are layered, a utility beats a component class by design — so
`className="pill bg-surface"` paints the ACTIVE pill white too, hiding
`.pill-active`'s own background. Apply the utility only in the states where it
belongs, or convert the state class with it. Found on the Rekeningen bank tabs.

**8. Converting two competing rules to utilities loses their source-order
tie-break.** `[data-active="1"]` and `[aria-selected="true"]` had equal
specificity in `worldmap.css`, so the later rule won when a row was both — the
selected background beat the active one, by file order. As utilities that order
is gone: Tailwind emits the generated classes in its own sequence, not in the
order the `className` lists them, so the tie flipped and a row that was both
active and selected painted the wrong colour. Nothing failed. Encode the
exclusivity in the selector instead of relying on order:
`[&[data-active="1"]:not([aria-selected="true"])]:bg-accent-soft`. This applies
to every pair of same-specificity state rules in these sheets, and there are
several.

**9. Deleting a class rule does not remove the property, it uncovers the
bare-tag default.** This is the inverse of trap 2 and it is the easiest one to
walk into, because the conversion looks complete. `base.css` still styles
`button` with a background, a border, a radius, padding, colour and cursor, and
does the same for `input`, `select`, `textarea`, `table` and the headings. Those
rules STAY until Preflight. So when you delete `.lp-brand` and move its
declarations to utilities, any property you did not carry over does not fall to
the browser default — it falls to the bare-tag rule underneath. `.lp-brand`'s
border-colour silently became the generic `button` border, on the landing page's
brand mark.

Enumerate the element's bare-tag rule before deleting its class rule, and carry
over or explicitly re-state every property that rule sets. A diff of
`getComputedStyle` across the whole element catches this; reading the class rule
you are converting does not, because the value is not in it.

**10. Naming a hand-written class after a Tailwind utility hands the utility the
element.** `.table` and `.ring` are both real Tailwind utilities and both were
also hand-written class names here. Tailwind generates a utility whenever its
scanner finds the token anywhere in the scanned tree, and utilities beat
`@layer components` regardless of specificity — so the generated rule silently
took over every element carrying that class name.

`.table{display:table}` defeated the `.table-cards table{display:block}` mobile
collapse on four views, costing about 12px of height per card table. `.ring`
was worse in kind: it sets `--tw-ring-shadow` to `0 0 0 1px currentcolor`, and
Tailwind registers the `@property` initial values that make that render, so the
landing page's encryption illustration was drawn with a 1px ring no stylesheet
asks for.

The scanner does not care whether the token is a class. `.ring` is still
generated in this build because `worldMap.test.ts` uses `ring` as a **loop
variable**. A local variable name in a test file is enough to emit a utility
that will override a component-layer rule. So the defence is not "check your
classNames" — it is never to name a hand-written class after a utility.
`.ring` is renamed `.lp-ring`; the generated `.ring` rule remains and is now
inert because nothing carries that class.

Note this landmine was created by the trap-2 fix. While the hand-written sheets
were unlayered they beat the generated utilities and the collision was
invisible. Wrapping them in `@layer components` was correct and also armed this.
It is branch-only: master has no Tailwind at all, so nothing here is live in
production.

## What `resolveStyle.ts` cannot see

It is the replacement for stylesheet-text assertions and it has three blind
spots, all of which return a clean pass rather than an error.

Two are by design and documented in the file: it refuses descendant, child and
sibling combinators, since it is given one element's class list and those
describe a relationship between two.

**Hand-typing the class list defeats the whole tool.** `resolved()` throws when
nothing matches, and that throw is the safety property — it is what stops a
converted component turning a real assertion into a vacuous one. But it can only
check the list you hand it. Type the classes by hand and you have rebuilt the
original problem: the list describes what you believe the component renders, not
what it renders, and it keeps passing after the component stops carrying them.
Worse, a hand-typed list can match some unrelated rule elsewhere in the built
sheet by coincidence and pass for a reason that has nothing to do with the
component. That happened here, to a worker who caught it only because the
assertion passed too easily. **Mount the component, read the real `className`
off the DOM, and pass that.** The assertion is then about the element, which is
the only thing worth asserting about.

The third was found in use. A `hover:` utility compiles inside
`@media (hover:hover)`, and the resolver's media handling only indexes
`max-width` blocks, so a hover rule is invisible to it. Ask it for a hover value
and it reports the base one. Verify interactive states in a real browser.

## A shared primitive becomes a component, not an inlined string

`base.css` is different in kind from the view stylesheets. Its 228 class rules
include the app's shared primitives, and they are shared widely: `.card` in 25
files, `.btn` in 16, `.cell-sub` in 16.

Writing `.card`'s utility string into 25 call sites duplicates the definition 25
times and destroys the single source of truth. That is strictly worse than the
CSS class it replaces. Extract a component instead — `<Button variant="primary">`,
one definition, 16 importers. `class-variance-authority`, `clsx` and
`tailwind-merge` are already dependencies, and this is what aligning with shadcn
means as opposed to merely using utilities.

Its 22 bare-tag rules stay. `html`, `body`, `h1`-`h3`, `p`, `a`, `button`,
`input` are element defaults with no class to attach a utility to. Replacing
them is what adopting Preflight means, which is the last step and the only
irreversible one.

Note the interaction between those two facts: a kept bare-tag rule now sits in
`components` while a utility sits in `utilities`, so the utility wins. An
unconditional `cursor-pointer` on a Button would beat
`button:disabled { cursor: not-allowed }`. Scope such utilities to the state
they belong in (`enabled:cursor-pointer`) and leave the rest to the bare rule.

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

# Plan From Intake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Jouw plan reflect the intake answers: subscriptions without fixed costs, stated cards with catalogue facts, an "Uit je antwoorden" block, and work-type notes.

**Architecture:** One core change (the subscriptions section excludes fixed-cost series). Everything else is web-side in `apps/web/src/plan/`, reading the adviser profile already available to sections via `SectionProps.ctx.profile.store`, and the catalogue through `isCovered` (`packages/core/src/catalog.ts`).

**Tech Stack:** React 19 + TypeScript, Vitest (jsdom for components), `@lavega/core`.

**Spec:** `docs/superpowers/specs/2026-10-27-plan-from-intake-design.md` (including "Settled after the builder check")

## Global Constraints

- Info, not advice: no recommendation, no "you should", no tax amounts; every new string passes `findAdviceLanguage`; NL + EN typed-complete copy.
- Catalogue facts always show `checkedAt` and a `sourceUrl` link; a field failing `isCovered` shows "niet bekend" / "not known".
- No comparison sentence between stated and measured figures (spec settled item 2).
- Money in cents; display like the rest of the plan.
- Workers never commit, push, stash or `git add` content; `git add -N` new files only.

## Review Focus

1. A user with no bank data: the "Uit je antwoorden" block and the stated cards must render without errors and without fake measured values. → Task 3 test `no bank data shows stated only`.
2. A user rule that recategorises a fixed-cost merchant (e.g. Ziggo set to "Wonen & energie") moves it out of subscriptions. → Task 1 test `user category rule excludes a series`.
3. A stated card that also exists as a held card account appears once. → Task 2 test `held card is not repeated under stated cards`.
4. A stated card id no longer in the catalogue renders its id-less fallback ("Onbekende kaart") instead of crashing. → Task 2 test `unknown stated id renders a fallback`.
5. Fee total with one unknown fee says one card was left out. → Task 2 test `fee total excludes unknown fees and says how many`.

---

### Task 1: Subscriptions exclude fixed costs (core)

**Files:** Modify `packages/core/src/plan/subs.ts` (and, if the series→merchant mapping lives there, `packages/core/src/subscriptions.ts`); Test `packages/core/src/plan/subs.test.ts`; plan copy for the new figure/explanation in `apps/web/src/copy/plan/*` (both locales).

**Interfaces — Produces:**
```ts
export const FIXED_COST_CATEGORIES: ReadonlySet<string>; // "Wonen & energie", "Verzekeringen", "Belastingen & overheid"
export const FIXED_COST_MERCHANTS: readonly string[];    // health insurers + childcare words, lower-case match fragments
// SubsFigures gains:
excludedFixedCosts: { name: string; monthlyCents: number }[];
```
plus a new flat id `"sub_fixed_excluded"` (count) added to `SUBS_FLAT_IDS` with labels in both locales (the change log labels every flat id; follow how existing ids are labelled).
Rule: a detected series is excluded when `categorize(tx, rules, own)` of its transactions yields a category in `FIXED_COST_CATEGORIES`, or its counterparty matches `FIXED_COST_MERCHANTS` (at least: zilveren kruis, cz, vgz, menzis, ditzo, dsw, zorgverzekering, kinderopvang, gastouder, bso). Use the same categorize inputs the spending section uses.
- [ ] Tests first: `excludes energy, water, health insurance, home insurance and childcare` (Vattenfall, Vitens, Zilveren Kruis, Centraal Beheer, Kinderopvang Het Zonnetje) and `keeps Netflix, Spotify, Basic-Fit, Ziggo, Simyo`; `user category rule excludes a series`; `excluded list carries name and monthly amount`; totals exclude them.
- [ ] Run `cd packages/core && npx vitest run src/plan` — FAIL → implement → PASS; update any existing test that assumed a fixed cost was a subscription and name it in the report.
- [ ] Web: SubscriptionsSection shows "N vaste lasten zijn hier niet meegeteld: name, name, …" (NL) / "N fixed costs are not counted here: …" (EN) when the list is non-empty; test in `apps/web/src/plan/sections/sections.test.tsx`.

### Task 2: Stated cards with catalogue facts (web)

**Files:** Create `apps/web/src/plan/statedCards.ts` (+ test); Modify `apps/web/src/plan/sections/CardsSection.tsx`, plan copy (NL+EN); Test `sections.test.tsx`.

**Interfaces — Produces:**
```ts
export type CardFact = { value: number; checkedAt: string; sourceUrl: string; conditions?: string } | null; // null = niet bekend
export type StatedCardRow = { id: string; name: string; kind: "credit" | "debit"; yearlyFee: CardFact; fxFeePct: CardFact; pointsPerEuro: CardFact };
export function statedCardRows(credit: readonly string[], debit: readonly string[], heldCatalogueIds: ReadonlySet<string>, otherLabels: { credit: string; debit: string }, unknownLabel: string): StatedCardRow[];
export function yearlyFeeTotal(rows: readonly StatedCardRow[]): { totalCents: number; unknownCount: number };
```
- Facts from `docs/catalog/catalog.json` fields `accountFee` (yearly, euros → cents), `fxFeePct`, `pointsPerEuro`; a field fails → `null`. `"other"` → name from `otherLabels`, all facts null. Ids missing from the catalogue → name `unknownLabel` ("Onbekende kaart" / "Unknown card").
- `heldCatalogueIds`: catalogue ids that the existing `entryFor` in `apps/web/src/plan/heldCards.ts` resolves for the user's held card accounts (export what is needed); rows with those ids are dropped.
- CardsSection: a "Jouw kaarten" block (groups "Creditcards" / "Betaalpassen") above the existing content; per card: name, Jaarlijkse kosten, Opslag buitenlandse valuta, Punten per euro (credit; debit only when known), each with "gecontroleerd op <date>" and a "bron" link, `conditions` in small print; then the fee total line ("Samen €X per jaar aan kaartkosten" + "N kaarten zonder bekende kosten tellen niet mee" when >0). Stated cards come from `ctx.profile.store?.current.statedCards` / `statedDebitCards`.
- [ ] Tests first: Review Focus 3, 4, 5; `Amex Gold shows €20 per year, 2,5% and 1 point with dates`; `debit card without points shows no points row`; `no stated cards renders nothing new`.
- [ ] FAIL → implement → PASS (`cd apps/web && npx vitest run src/plan`).

### Task 3: "Uit je antwoorden" block and work notes (web)

**Files:** Create `apps/web/src/plan/FromAnswers.tsx` (+ test); Modify `apps/web/src/views/Plan.tsx` (mount under the header, above "Wat LaVega weet"), `apps/web/src/plan/sections/MonthSection.tsx`, `BufferSection.tsx`, plan copy (NL+EN).

**Interfaces — Consumes:** profile `household`, `children`, `work`, `statedRanges` (income/spend), and the Month section's figures for the middle month (income and spending excluding own transfers — read the figure ids MonthSection already uses; do not recompute).
- Block content per spec part 1 and settled item 2: household line (Alleen / Samen, children with birth years, work chips); two rows "Netto inkomen per maand" and "Uitgaven per maand": "opgegeven" value (exact or band, labelled "voor jullie samen" when Samen) and "gemeten op je gekoppelde rekeningen" value with its month, or "Nog geen rekeningen gekoppeld of geïmporteerd" with a link to Profiel's import when no bank data. Each row has a "Wijzig" link to About you. No comparison sentence.
- Work notes (spec part 3) as one paragraph each inside MonthSection (freelance|business) and BufferSection (freelance|business|jobseeking), using the existing section note styling.
- [ ] Tests first: `no bank data shows stated only` (Review Focus 1); `band shows as range with household label`; `measured shows the middle month value and month`; `freelance note in Je maand`; `jobseeking note in Buffer only`; `employed shows no notes`; advice-language scan over the block and notes.
- [ ] FAIL → implement → PASS; then full gate from the worktree root: `npx pnpm test`, `npx pnpm typecheck --force`, `npx pnpm lint`.

### Task 4: Browser proof

- [ ] `npx pnpm --filter @lavega/web build`; run `/private/tmp/claude-501/-Users-alexandersteunenberg-Desktop-My-Code/0f8adaa3-6ad1-4a04-a6ed-fe307d0ceda4/scratchpad/pw/planwalk.mjs` (full wizard + synthetic CSV upload, then plan text + full-page screenshot). Check in the captured plan: subscriptions list without the five fixed costs and the "niet meegeteld" line; "Jouw kaarten" with American Express Gold Card, ING betaalpas, Revolut Standard betaalpas and dated facts; "Uit je antwoorden" with Samen, 1 kind (2021), Loondienst + Freelance, income €5.600 opgegeven vs gemeten, spend €3.500 – €5.000 vs gemeten; the freelance note in Je maand and Buffer. Copy plan.txt + plan.png into `.superpowers/sdd/2026-10-27-plan-from-intake/evidence/` with a `browser.md` table.

# Cashback & optimisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show what LaVega's owner leaves on the table across the accounts he already holds — money sitting at a lower rate, and spending running through a card that returns less than another he owns.

**Architecture:** One new pure core module (`packages/core/src/returns.ts`) built in three layers — the spending base, the per-account returns, then the two actions — followed by one new module in the existing Optimalisatie view. Everything reuses what exists: `resolveAccountRate` for the balance side, the `cashbackPct` LearnedFact for the spending side, and `categorize`'s "Eigen overboeking" rule to keep own transfers out.

**Tech Stack:** TypeScript, pnpm workspaces + turbo, vitest, React 18 (no chart library).

**Spec:** `docs/superpowers/specs/2026-08-18-cashback-optimalisatie-design.md`

## Global Constraints

- Dutch in the UI, English in code identifiers.
- `packages/core` is PURE: no I/O, no `Date.now()` inside functions, `asOf` always passed in.
- Integer cents for all money. Percentages stay as numbers (`1.5` means 1,5%).
- **Unknown is never zero, a default, or a comparison.** A missing `cashbackPct` is `null` and cannot win or lose a ranking.
- An action whose either side is unknown is NOT produced — it is reported as a gap with the provider named.
- On a payment account the spend base is an **upper bound** and the UI must say "tot €X", never "€X".
- No new colours; reuse `styles/tokens.css` and the `Module` / `ModuleGrid` primitives.
- Never fetch a remote asset at runtime.
- Run `pnpm --filter @lavega/core test` and `pnpm --filter @lavega/web test` — not the whole suite — while working in one package.

---

### Task 1: The spending base

The number cashback multiplies. Getting this wrong inflates every figure downstream, which is why it gets its own task and its own gate.

**Files:**
- Create: `packages/core/src/returns.ts`
- Create: `packages/core/src/returns.test.ts`
- Modify: `packages/core/src/index.ts` (add `export * from "./returns.js";` after the `./interest.js` line)

**Interfaces:**
- Consumes: `Account`, `Tx`, `Rule` from `./model.js`; `categorize`, `type OwnAccounts` from `./views.js`; `accountType` from `./balance.js`
- Produces:
  ```ts
  export const MIN_SPEND_DAYS = 60;
  export type SpendKind = "exact" | "upper-bound" | "unknown";
  export type SpendBase = { perYearCents: number | null; kind: SpendKind; observedDays: number };
  export function annualSpendCents(
    account: Account, txs: Tx[], rules: Rule[], own: OwnAccounts | undefined, asOf: string,
  ): SpendBase;
  ```

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/returns.test.ts
import { expect, test } from "vitest";
import type { Account, Tx } from "./model.js";
import { annualSpendCents, MIN_SPEND_DAYS } from "./returns.js";
import { ownAccounts } from "./views.js";

const acc = (over: Partial<Account>): Account =>
  ({ key: "k", iban: "", name: "Rekening", bank: "ING", entity: "BV1",
     currency: "EUR", balance: 1000, ...over });

const tx = (over: Partial<Tx>): Tx =>
  ({ id: "t", accountKey: "k", date: "2026-08-01", amount: -100, currency: "EUR",
     counterparty: "Albert Heijn", description: "", category: "", manual: false, ...over });

test("a credit card's spend base is EXACT: every outflow on it is card spend", () => {
  const card = acc({ key: "amex", bank: "American Express", type: "Creditcard" });
  // 180 days of history, €900 out in total -> €1.825 per year.
  const txs = [
    tx({ id: "a", accountKey: "amex", date: "2026-03-01", amount: -300 }),
    tx({ id: "b", accountKey: "amex", date: "2026-06-01", amount: -300 }),
    tx({ id: "c", accountKey: "amex", date: "2026-08-27", amount: -300 }),
  ];
  const base = annualSpendCents(card, txs, [], undefined, "2026-08-27");

  expect(base.kind).toBe("exact");
  expect(base.observedDays).toBe(179);
  expect(base.perYearCents).toBe(Math.round((90_000 * 365) / 179));
});

test("a payment account's spend base is an UPPER BOUND — the export cannot tell a card payment from a direct debit", () => {
  const pay = acc({ key: "ing", type: "Betaalrekening" });
  const txs = [
    tx({ id: "a", accountKey: "ing", date: "2026-03-01", amount: -300 }),
    tx({ id: "b", accountKey: "ing", date: "2026-08-27", amount: -300 }),
  ];
  expect(annualSpendCents(pay, txs, [], undefined, "2026-08-27").kind).toBe("upper-bound");
});

test("money moved to your own account is not spending", () => {
  const pay = acc({ key: "ing", type: "Betaalrekening" });
  const savings = acc({ key: "NL01INGB0002222222", iban: "NL01INGB0002222222", name: "Spaar" });
  // Built by core's own builder: the internal shape of byKey is not a fixture's
  // business, and a hand-rolled one silently stops matching if it changes.
  const own = ownAccounts([pay, savings]);
  const txs = [
    tx({ id: "a", accountKey: "ing", date: "2026-03-01", amount: -300 }),
    tx({ id: "b", accountKey: "ing", date: "2026-08-27", amount: -5000,
         counterparty: "NL01INGB0002222222", description: "naar spaarrekening" }),
  ];
  const base = annualSpendCents(pay, txs, [], own, "2026-08-27");

  // Only the €300 counts; the €5.000 sweep is an own transfer.
  expect(base.perYearCents).toBe(Math.round((30_000 * 365) / 179));
});

test("too little history yields UNKNOWN, never a projection from three weeks", () => {
  const pay = acc({ key: "ing", type: "Betaalrekening" });
  const txs = [
    tx({ id: "a", accountKey: "ing", date: "2026-08-10", amount: -300 }),
    tx({ id: "b", accountKey: "ing", date: "2026-08-27", amount: -300 }),
  ];
  const base = annualSpendCents(pay, txs, [], undefined, "2026-08-27");

  expect(base.observedDays).toBeLessThan(MIN_SPEND_DAYS);
  expect(base.kind).toBe("unknown");
  expect(base.perYearCents).toBeNull();
});

test("money coming IN is not spending, and an account with no outflow is unknown", () => {
  const pay = acc({ key: "ing", type: "Betaalrekening" });
  const txs = [
    tx({ id: "a", accountKey: "ing", date: "2026-03-01", amount: 2500 }),
    tx({ id: "b", accountKey: "ing", date: "2026-08-27", amount: 2500 }),
  ];
  expect(annualSpendCents(pay, txs, [], undefined, "2026-08-27").perYearCents).toBeNull();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @lavega/core test -- returns`
Expected: FAIL — `Failed to resolve import "./returns.js"`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/returns.ts
import type { Account, Rule, Tx } from "./model.js";
import { categorize, type OwnAccounts } from "./views.js";
import { accountType } from "./balance.js";

/** Money moved between the owner's own accounts is not spending. Same category
 *  the forecast excludes, for the same reason: a €50k sweep to savings is not
 *  €50k of consumption, and treating it as such invents a number. */
const TRANSFER_CATEGORY = "Eigen overboeking";

/** Below this much history an annualised figure is a guess dressed as a
 *  measurement. Matches the forecast's own floor for the same judgement. */
export const MIN_SPEND_DAYS = 60;

const DAY_MS = 86_400_000;

/**
 *  `exact`       a credit card: every outflow on it IS card spend
 *  `upper-bound` a payment account: the bank export does not reliably say
 *                whether an outflow was a card payment or a direct debit, so
 *                this is the most it could be
 *  `unknown`     too little history, or nothing spent
 */
export type SpendKind = "exact" | "upper-bound" | "unknown";

export type SpendBase = {
  /** Annualised card spending in cents, or null when it cannot be measured. */
  perYearCents: number | null;
  kind: SpendKind;
  /** Days between the first and last transaction we hold for this account. */
  observedDays: number;
};

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
}

/** What this account spends in a year, as the base cashback multiplies. */
export function annualSpendCents(
  account: Account,
  txs: Tx[],
  rules: Rule[],
  own: OwnAccounts | undefined,
  asOf: string,
): SpendBase {
  const mine = txs.filter((t) => t.accountKey === account.key && t.date <= asOf);
  if (mine.length === 0) return { perYearCents: null, kind: "unknown", observedDays: 0 };

  const dates = mine.map((t) => t.date).sort();
  const observedDays = daysBetween(dates[0], dates[dates.length - 1]);

  let outCents = 0;
  for (const t of mine) {
    if (t.amount >= 0) continue; // money in is not spending
    if (categorize(t, rules, own) === TRANSFER_CATEGORY) continue;
    outCents += Math.round(-t.amount * 100);
  }

  if (observedDays < MIN_SPEND_DAYS || outCents === 0) {
    return { perYearCents: null, kind: "unknown", observedDays };
  }
  return {
    perYearCents: Math.round((outCents * 365) / observedDays),
    kind: accountType(account) === "Creditcard" ? "exact" : "upper-bound",
    observedDays,
  };
}
```

- [ ] **Step 4: Export it and run the tests**

Add to `packages/core/src/index.ts`, directly after the `./interest.js` line:

```ts
export * from "./returns.js";
```

Run: `pnpm --filter @lavega/core test -- returns` then `pnpm --filter @lavega/core typecheck`
Expected: 5 passing, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/returns.ts packages/core/src/returns.test.ts packages/core/src/index.ts
git commit -m "feat(core): the spending base cashback multiplies

Card spend per year per account, which is the number every cashback figure
rests on. Own transfers are excluded - a sweep to your own savings is not
consumption - and money in is not spending.

The kind matters as much as the number. On a credit card every outflow IS card
spend, so it is exact. On a payment account the export does not reliably
distinguish a card payment from a direct debit, so it is an upper bound and has
to be labelled as one. Under 60 days of history it is null, never a projection."
```

---

### Task 2: Per-account returns

**Files:**
- Modify: `packages/core/src/returns.ts`
- Modify: `packages/core/src/returns.test.ts`

**Interfaces:**
- Consumes: `annualSpendCents`, `SpendBase` from Task 1; `resolveAccountRate`, `type RateSource`, `type RateBenchmark` from `./interest.js`; `factNumber` from `./facts.js`; `productOf`, `TRAVEL_AGENT` from `./travel.js`
- Produces:
  ```ts
  export type AccountReturn = {
    account: Account;
    savingsPct: number | null;
    savingsSource: RateSource;
    cashbackPct: number | null;
    balanceCents: number;
    spend: SpendBase;
  };
  export function accountReturns(
    accounts: Account[], txs: Tx[], rules: Rule[], own: OwnAccounts | undefined,
    facts: readonly LearnedFact[], rates: readonly RateBenchmark[], asOf: string,
  ): AccountReturn[];
  ```

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/returns.test.ts`:

```ts
import { accountReturns } from "./returns.js";
import { makeFact } from "./facts.js";
import { TRAVEL_AGENT } from "./travel.js";

const cashbackFact = (subject: string, value: string) =>
  makeFact({ agent: TRAVEL_AGENT, subject, key: "cashbackPct", value,
             source: "agent", updatedAt: "2026-08-18" });

test("cashback is read from the product fact, and a card without one stays UNKNOWN", () => {
  const t212 = acc({ key: "t212", bank: "Trading 212", type: "Betaalrekening", balance: 20_000 });
  const ing = acc({ key: "ing", bank: "ING", type: "Betaalrekening", balance: 5_000 });
  const facts = [cashbackFact("Trading 212 betaalpas", "1.5")];

  const out = accountReturns([t212, ing], [], [], undefined, facts, [], "2026-08-18");
  const byKey = Object.fromEntries(out.map((r) => [r.account.key, r]));

  expect(byKey.t212.cashbackPct).toBe(1.5);
  // ING has no cashback fact. It is NOT 0% — nobody said so.
  expect(byKey.ing.cashbackPct).toBeNull();
});

test("the balance rate keeps the source it came from, and cents are integers", () => {
  const savings = acc({ key: "spaar", bank: "Trading 212", name: "Spaar",
                        type: "Spaarrekening", balance: 20_000, interestRate: 3.5 });
  const out = accountReturns([savings], [], [], undefined, [], [], "2026-08-18");

  expect(out[0].savingsPct).toBe(3.5);
  expect(out[0].savingsSource).toBe("manual"); // he typed it; nothing may overrule that
  expect(out[0].balanceCents).toBe(2_000_000);
});

test("an account with no saldo reports zero cents rather than guessing one", () => {
  const unknown = acc({ key: "x", balance: null });
  expect(accountReturns([unknown], [], [], undefined, [], [], "2026-08-18")[0].balanceCents).toBe(0);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @lavega/core test -- returns`
Expected: FAIL — `accountReturns is not exported`.

- [ ] **Step 3: Write the implementation**

Append to `packages/core/src/returns.ts` (and extend the imports at the top of that file):

```ts
import type { LearnedFact } from "./facts.js";
import { factNumber } from "./facts.js";
import { resolveAccountRate, type RateBenchmark, type RateSource } from "./interest.js";
import { productOf, TRAVEL_AGENT } from "./travel.js";

/** What one account he already holds earns and returns.
 *
 *  Two rates on two DIFFERENT bases, deliberately kept apart: savings earns on
 *  the balance sitting there, cashback returns on what is spent. Adding them
 *  into one percentage would read well and mean nothing. */
export type AccountReturn = {
  account: Account;
  savingsPct: number | null;
  savingsSource: RateSource;
  cashbackPct: number | null;
  balanceCents: number;
  spend: SpendBase;
};

export function accountReturns(
  accounts: Account[],
  txs: Tx[],
  rules: Rule[],
  own: OwnAccounts | undefined,
  facts: readonly LearnedFact[],
  rates: readonly RateBenchmark[],
  asOf: string,
): AccountReturn[] {
  return accounts.map((account) => {
    const { ratePct, source } = resolveAccountRate(account, txs, asOf, rates);
    // Cashback belongs to the PRODUCT, so it is keyed the same way the travel
    // agent keys it — one correction moves both surfaces at once.
    const product = productOf(account);
    return {
      account,
      savingsPct: ratePct,
      savingsSource: source,
      cashbackPct: product ? factNumber(facts, TRAVEL_AGENT, product, "cashbackPct") : null,
      balanceCents: account.balance === null ? 0 : Math.round(account.balance * 100),
      spend: annualSpendCents(account, txs, rules, own, asOf),
    };
  });
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @lavega/core test -- returns` then `pnpm --filter @lavega/core typecheck`
Expected: 8 passing, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/returns.ts packages/core/src/returns.test.ts
git commit -m "feat(core): what each account he holds earns and returns

Two rates on two different bases, kept apart on purpose: savings earns on the
balance, cashback returns on what is spent. Blending them into one percentage
would read well and mean nothing.

Cashback is keyed by productOf(), the same key the travel agent uses, so one
correction moves both surfaces. A card with no cashback fact is null - nobody
said it pays nothing."
```

---

### Task 3: The two actions

**Files:**
- Modify: `packages/core/src/returns.ts`
- Modify: `packages/core/src/returns.test.ts`

**Interfaces:**
- Consumes: `accountReturns`, `AccountReturn` from Task 2
- Produces:
  ```ts
  export type ReturnAction = {
    kind: "move-balance" | "route-spending";
    from: Account; to: Account;
    fromPct: number; toPct: number;
    baseCents: number;
    gainPerYearCents: number;
    /** True when the base is an upper bound, so the UI must say "tot €X". */
    approximate: boolean;
  };
  export type ReturnGap = { product: string; missing: "cashbackPct" | "savingsPct" };
  export function optimiseReturns(
    returns: readonly AccountReturn[],
  ): { actions: ReturnAction[]; gaps: ReturnGap[] };
  ```

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/returns.test.ts`:

```ts
import { optimiseReturns } from "./returns.js";

test("his own case: two actions on two bases, not one blended rate", () => {
  // Trading 212: 3,5% on balance and 1,5% cashback. ING: 1,5% and 0%.
  const t212 = acc({ key: "t212", bank: "Trading 212", type: "Betaalrekening",
                     balance: 0, interestRate: 3.5 });
  const ing = acc({ key: "ing", bank: "ING", type: "Betaalrekening",
                    balance: 20_000, interestRate: 1.5 });
  const facts = [cashbackFact("Trading 212 betaalpas", "1.5"), cashbackFact("ING betaalpas", "0")];
  // A year of ING spending at €2.500/month.
  const txs = Array.from({ length: 12 }, (_, i) =>
    tx({ id: "s" + i, accountKey: "ing", amount: -2500,
         date: `2025-${String(i + 1).padStart(2, "0")}-15` }));

  const { actions } = optimiseReturns(
    accountReturns([t212, ing], txs, [], undefined, facts, [], "2026-01-15"),
  );

  const move = actions.find((a) => a.kind === "move-balance");
  const route = actions.find((a) => a.kind === "route-spending");

  // €20.000 × (3,5% − 1,5%) = €400/jaar
  expect(move?.gainPerYearCents).toBe(40_000);
  expect(move?.from.key).toBe("ing");
  expect(move?.to.key).toBe("t212");

  // Spending stays on its own base and is flagged as an upper bound.
  expect(route?.from.key).toBe("ing");
  expect(route?.to.key).toBe("t212");
  expect(route?.approximate).toBe(true);
  expect(route!.gainPerYearCents).toBeGreaterThan(0);

  // Biggest first.
  expect(actions[0].gainPerYearCents).toBeGreaterThanOrEqual(actions[1].gainPerYearCents);
});

test("an unknown side produces a GAP, never an action", () => {
  const t212 = acc({ key: "t212", bank: "Trading 212", type: "Betaalrekening", balance: 0 });
  const ing = acc({ key: "ing", bank: "ING", type: "Betaalrekening", balance: 20_000, interestRate: 1.5 });
  // No cashback fact for either, and no rate for T212.
  const { actions, gaps } = optimiseReturns(
    accountReturns([t212, ing], [], [], undefined, [], [], "2026-08-18"),
  );

  expect(actions.find((a) => a.kind === "route-spending")).toBeUndefined();
  expect(gaps.map((g) => g.product)).toContain("Trading 212 betaalpas");
  expect(gaps.every((g) => g.missing === "cashbackPct" || g.missing === "savingsPct")).toBe(true);
});

test("no action when the winner is the account already holding the money", () => {
  const best = acc({ key: "t212", bank: "Trading 212", balance: 20_000, interestRate: 3.5 });
  const { actions } = optimiseReturns(
    accountReturns([best], [], [], undefined, [], [], "2026-08-18"),
  );
  expect(actions.find((a) => a.kind === "move-balance")).toBeUndefined();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @lavega/core test -- returns`
Expected: FAIL — `optimiseReturns is not exported`.

- [ ] **Step 3: Write the implementation**

Append to `packages/core/src/returns.ts`:

```ts
/** One concrete thing he can do, with the arithmetic attached so the UI never
 *  has to invent any. */
export type ReturnAction = {
  kind: "move-balance" | "route-spending";
  from: Account;
  to: Account;
  fromPct: number;
  toPct: number;
  /** The euros the difference applies to: a balance, or a year of spending. */
  baseCents: number;
  gainPerYearCents: number;
  /** The base is an upper bound (a payment account), so the UI must say "tot". */
  approximate: boolean;
};

/** A comparison we could not make, and the product whose figure would fix it.
 *  Reported rather than silently skipped: a missing fee is a question, and the
 *  owner is the one who can answer it. */
export type ReturnGap = { product: string; missing: "cashbackPct" | "savingsPct" };

/** Below this the advice is noise. Same threshold `analyzeInterest` uses. */
const MARGIN_PCT = 0.1;

export function optimiseReturns(
  returns: readonly AccountReturn[],
): { actions: ReturnAction[]; gaps: ReturnGap[] } {
  const actions: ReturnAction[] = [];
  const gaps: ReturnGap[] = [];

  const bestSavings = returns
    .filter((r) => r.savingsPct !== null)
    .sort((a, b) => (b.savingsPct as number) - (a.savingsPct as number))[0];
  const bestCashback = returns
    .filter((r) => r.cashbackPct !== null)
    .sort((a, b) => (b.cashbackPct as number) - (a.cashbackPct as number))[0];

  for (const r of returns) {
    const product = productOf(r.account);
    if (r.savingsPct === null) {
      if (product) gaps.push({ product, missing: "savingsPct" });
    } else if (bestSavings && r.account.key !== bestSavings.account.key && r.balanceCents > 0) {
      const delta = (bestSavings.savingsPct as number) - r.savingsPct;
      if (delta > MARGIN_PCT) {
        actions.push({
          kind: "move-balance",
          from: r.account,
          to: bestSavings.account,
          fromPct: r.savingsPct,
          toPct: bestSavings.savingsPct as number,
          baseCents: r.balanceCents,
          gainPerYearCents: Math.round((r.balanceCents * delta) / 100),
          approximate: false,
        });
      }
    }

    if (r.cashbackPct === null) {
      if (product) gaps.push({ product, missing: "cashbackPct" });
      continue;
    }
    // No spend base means no honest multiplication. Skip rather than assume.
    if (r.spend.perYearCents === null) continue;
    if (!bestCashback || r.account.key === bestCashback.account.key) continue;
    const delta = (bestCashback.cashbackPct as number) - r.cashbackPct;
    if (delta <= MARGIN_PCT) continue;
    actions.push({
      kind: "route-spending",
      from: r.account,
      to: bestCashback.account,
      fromPct: r.cashbackPct,
      toPct: bestCashback.cashbackPct as number,
      baseCents: r.spend.perYearCents,
      gainPerYearCents: Math.round((r.spend.perYearCents * delta) / 100),
      approximate: r.spend.kind === "upper-bound",
    });
  }

  return { actions: actions.sort((a, b) => b.gainPerYearCents - a.gainPerYearCents), gaps };
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @lavega/core test -- returns` then `pnpm --filter @lavega/core typecheck`
Expected: 11 passing, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/returns.ts packages/core/src/returns.test.ts
git commit -m "feat(core): two actions, two bases, with the arithmetic attached

His example priced: EUR 20.000 idle at 3,5% instead of 1,5% is EUR 400/jaar, and
a year of spending at 1,5% instead of 0% is its own figure on its own base. Two
actions rather than one blended 'bijna 4%', which is both larger and checkable
against a statement.

An unknown side never becomes an action. It becomes a gap naming the product
whose figure would answer it, because a missing fee is a question and he is the
one who can answer it."
```

---

### Task 4: The Cashback module

**Files:**
- Modify: `apps/web/src/views/Optimalisatie.tsx`
- Modify: `apps/web/src/App.tsx` (pass `facts`)
- Create: `apps/web/src/optimalisatie-cashback.test.tsx`

**Interfaces:**
- Consumes: `accountReturns`, `optimiseReturns`, `type ReturnAction`, `type ReturnGap` from Tasks 1–3
- Produces: nothing other tasks depend on

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/src/optimalisatie-cashback.test.tsx
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Account, Tx } from "@lavega/core";
import { makeFact, TRAVEL_AGENT } from "@lavega/core";
import Optimalisatie from "./views/Optimalisatie";

const acc = (over: Partial<Account>): Account =>
  ({ key: "k", iban: "", name: "Rekening", bank: "ING", entity: "BV1",
     currency: "EUR", balance: 1000, ...over });

const spend = (key: string, month: number): Tx =>
  ({ id: key + month, accountKey: key, date: `2025-${String(month).padStart(2, "0")}-15`,
     amount: -2500, currency: "EUR", counterparty: "Albert Heijn", description: "",
     category: "", manual: false });

const render = (props: Partial<Parameters<typeof Optimalisatie>[0]> = {}) =>
  renderToStaticMarkup(
    <Optimalisatie
      txs={Array.from({ length: 12 }, (_, i) => spend("ing", i + 1))}
      accounts={[
        acc({ key: "ing", bank: "ING", balance: 20_000, interestRate: 1.5 }),
        acc({ key: "t212", bank: "Trading 212", balance: 0, interestRate: 3.5 }),
      ]}
      rules={[]}
      own={undefined}
      asOf="2026-01-15"
      busy={false}
      facts={[
        makeFact({ agent: TRAVEL_AGENT, subject: "Trading 212 betaalpas", key: "cashbackPct",
                   value: "1.5", source: "agent", updatedAt: "2026-08-18" }),
        makeFact({ agent: TRAVEL_AGENT, subject: "ING betaalpas", key: "cashbackPct",
                   value: "0", source: "agent", updatedAt: "2026-08-18" }),
      ]}
      onRateCommit={() => {}}
      {...props}
    />,
  );

test("the cashback module names both cards, both rates and the euro figure", () => {
  const html = render();
  expect(html).toContain("Cashback");
  expect(html).toContain("Trading 212");
  expect(html).toContain("1,5%");
});

test("a payment account's figure says 'tot', because it is an upper bound", () => {
  // The bank export cannot tell a card payment from a direct debit, so the
  // number is the most it could be — and printing it bare would be a claim we
  // cannot support.
  expect(render()).toContain("tot ");
});

test("a card with no cashback figure is a question, not a zero", () => {
  const html = render({ facts: [] });
  // Asserted on the cashback copy specifically: the Rente module prints its own
  // percentages, so a bare not-toContain("0%") would pass or fail for reasons
  // that have nothing to do with cashback.
  expect(html).toContain("Cashback onbekend voor");
  expect(html).toContain("Trading 212 betaalpas");
  expect(html).not.toContain("per jaar</span>"); // no euro claim without a rate
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @lavega/web test -- optimalisatie-cashback`
Expected: FAIL — `facts` is not a valid prop of `Optimalisatie`.

- [ ] **Step 3: Add the prop and the module**

In `apps/web/src/views/Optimalisatie.tsx`, add to `OptimalisatieProps` (around line 48):

```ts
  /** What the agents have learned, for the cashback figures. Keyed by
   *  productOf(), the same key the travel agent uses. */
  facts: readonly LearnedFact[];
```

Add `facts` to the destructured parameter list on the `export default function Optimalisatie(...)` line, then above the `return`:

```tsx
  // Two rates on two bases, from the accounts he already holds. Core owns the
  // whole derivation; this view only prints it.
  const returns = useMemo(
    () => accountReturns(accounts, txs, rules, own, facts, rates.rates, asOf),
    [accounts, txs, rules, own, facts, rates, asOf],
  );
  const { actions, gaps } = useMemo(() => optimiseReturns(returns), [returns]);
  const routing = actions.filter((a) => a.kind === "route-spending");
  const cashbackGaps = gaps.filter((g) => g.missing === "cashbackPct");
```

Add a third `<Module>` inside the existing `<ModuleGrid>`, after the Rente module:

```tsx
        <Module title="Cashback" footer={<span>Percentages gelden op wat je uitgeeft, niet op je saldo.</span>}>
          {routing.length === 0 && cashbackGaps.length === 0 && (
            <p className="block-empty">Je betaalt al met de kaart die het meeste teruggeeft.</p>
          )}
          {routing.map((a) => (
            <div className="position-row" key={a.from.key + a.to.key}>
              <span>
                Betaal met <strong>{a.to.bank}</strong> in plaats van {a.from.bank} — {a.toPct}% tegen {a.fromPct}%.
              </span>
              <span className="text-pos">
                {a.approximate ? "tot " : ""}
                {euro(a.gainPerYearCents)} per jaar
              </span>
            </div>
          ))}
          {cashbackGaps.length > 0 && (
            <p className="cell-sub">
              Cashback onbekend voor {cashbackGaps.map((g) => g.product).join(", ")}. Vul het zelf in bij het
              reisblok — wat jij invult wordt nooit overschreven.
            </p>
          )}
        </Module>
```

Extend the `@lavega/core` import at the top of the file with `accountReturns`, `optimiseReturns` and `type LearnedFact`.

In `apps/web/src/App.tsx`, add `facts={facts}` to the `<Optimalisatie ... />` element (around line 952, beside `rules={rules}`).

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @lavega/web test -- optimalisatie-cashback` then `pnpm --filter @lavega/web typecheck`
Expected: 3 passing, no type errors.

- [ ] **Step 5: Run everything and commit**

```bash
pnpm turbo run typecheck --force
pnpm turbo run test --force
pnpm --filter @lavega/web build

git add apps/web/src/views/Optimalisatie.tsx apps/web/src/App.tsx apps/web/src/optimalisatie-cashback.test.tsx
git commit -m "feat(web): a Cashback module in Optimalisatie

The third module, as chosen: Abonnementen, Rente, Cashback. It names both
cards, both rates and the euros, and says 'tot' on a payment account because
the export cannot tell a card payment from a direct debit there.

A card with no cashback figure is printed as a question naming the product, not
as 0%. Nobody said it pays nothing."
```

---

## Notes for the executor

- **Do not blend the two percentages.** Savings earns on a balance, cashback on spending. One number would read better and mean less; the spec exists because that distinction is the point.
- **`upper-bound` is not a nicety.** On a payment account the figure can be roughly double the truth, because rent and direct debits are inside it. If you drop the word "tot", you have re-introduced the class of bug this codebase spent three days removing.
- **Do not add a switch-to-a-card-you-do-not-own feature.** The spec records why: no neutral Dutch source exists, only affiliate sites quoting "up to".
- The travel agent already writes `cashbackPct` facts. After running a travel lookup, the Cashback module fills in on its own — that is the intended coupling, and it is why the fact key is `productOf()`.

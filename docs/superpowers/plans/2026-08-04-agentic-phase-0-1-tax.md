# Agentic Phase 0 (foundation) + Phase 1 (Tax/BTW) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the 13-week forecast a way to see _scheduled_ future money (a `ScheduledFlow`), then use it to make VAT (BTW) real: auto-estimate the VAT to set aside per BV, net it out of "beschikbaar saldo", place it in the forecast on the BTW deadline, and raise deadline alerts.

**Architecture:** One new pure primitive in `@lavega/core` — `ScheduledFlow` (a signed, dated cents amount) — folded into `forecast.ts` as a THIRD flow source alongside recurring streams + the incidental baseline. A VAT set-aside is just a `ScheduledFlow` with `source:"vat"`. Storage adds optional `VaultData` fields (single-blob vault ⇒ no DB migration; missing fields default to empty). Phase 1 adds deterministic NL BTW rules/deadlines + `computeVatSetAside` + deadline alerts. No LLM, no connectors, no network.

**Tech Stack:** TypeScript, pnpm monorepo, Vitest. `@lavega/core` (pure), `@lavega/adapters` (IndexedDB vault), `apps/web` (React+Vite).

## Global Constraints

- Pure/deterministic in `@lavega/core`: no `Date.now()`/`Math.random()` inside pure functions — `asOf` (ISO `YYYY-MM-DD`) is always passed in. Integer **cents** for money math; ISO-date day math via `Date.UTC` (never `new Date(str)`).
- Additive only: existing `forecast.ts`/`balance.ts`/`alerts.ts` call sites and their tests must stay green. New params are OPTIONAL with safe defaults.
- Local-first: NO LLM, NO connectors, NO network in Phase 0/1. Nothing here sends data anywhere.
- Amounts on `ScheduledFlow` are POSITIVE magnitudes in cents; direction is the `sign` field (`1` in / `-1` out), mirroring `RecurringStream`.
- `ScheduledFlow.id` is content-hashed with the existing `hash()` from `packages/core/src/hash.ts` (same discipline as `assignTxIds`).
- Dutch UI copy. Every task ends by committing with a message ending:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- Run the whole suite with `pnpm test`; typecheck with `pnpm typecheck`.

## File Structure

- `packages/core/src/model.ts` — add `ScheduledFlow`, `VatSettings` types (modify).
- `packages/core/src/scheduledFlows.ts` — NEW: pure helpers (`makeScheduledFlow`, `scheduledFlowsForScope`, `reservedCents`).
- `packages/core/src/forecast.ts` — thread `scheduledFlows` into the roll-forward (modify).
- `packages/core/src/balance.ts` — `availableBalance` netting reservations (modify).
- `packages/core/src/tax.ts` — NEW: `NL_BTW`, `nextBtwDeadline`, `computeVatSetAside`.
- `packages/core/src/alerts.ts` — BTW deadline alerts (modify).
- `packages/core/src/index.ts` — export new modules (modify).
- `packages/adapters/src/storage/StorageAdapter.ts` — keep as-is; new methods go on `VaultStorage`.
- `packages/adapters/src/storage/encryptedStorage.ts` — extend `VaultData` + add scheduledFlows/vatSettings methods (modify).
- `apps/web/src/App.tsx`, `apps/web/src/views/Belasting.tsx` (NEW), `components/Sidebar.tsx`, `components/TopBar.tsx` — minimal Belasting surface (modify/create).

---

## Task 1: `ScheduledFlow` + `VatSettings` types and pure helpers

**Files:**

- Modify: `packages/core/src/model.ts`
- Create: `packages/core/src/scheduledFlows.ts`
- Test: `packages/core/src/scheduledFlows.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Produces: `ScheduledFlow`, `VatSettings` types; `makeScheduledFlow(input): ScheduledFlow`; `scheduledFlowsForScope(flows, entity?): ScheduledFlow[]`; `reservedCents(flows, asOf): number`.

- [ ] **Step 1: Write the failing test** — `packages/core/src/scheduledFlows.test.ts`

```ts
import { expect, test } from "vitest";
import { makeScheduledFlow, scheduledFlowsForScope, reservedCents } from "./scheduledFlows.js";

test("makeScheduledFlow builds a positive-cents dated flow with a stable id", () => {
  const f = makeScheduledFlow({
    entity: "BV1",
    label: "BTW Q1",
    sign: -1,
    amountCents: 120000,
    dueDate: "2026-04-30",
    source: "vat",
    status: "confirmed",
  });
  expect(f).toMatchObject({
    entity: "BV1",
    sign: -1,
    amountCents: 120000,
    dueDate: "2026-04-30",
    source: "vat",
    status: "confirmed",
  });
  expect(typeof f.id).toBe("string");
  // same content -> same id (dedup on re-compute)
  expect(
    makeScheduledFlow({
      entity: "BV1",
      label: "BTW Q1",
      sign: -1,
      amountCents: 120000,
      dueDate: "2026-04-30",
      source: "vat",
      status: "confirmed",
    }).id,
  ).toBe(f.id);
});

test("scheduledFlowsForScope filters by entity ('' = all)", () => {
  const a = makeScheduledFlow({
    entity: "BV1",
    label: "x",
    sign: -1,
    amountCents: 100,
    dueDate: "2026-05-01",
    source: "vat",
    status: "confirmed",
  });
  const b = makeScheduledFlow({
    entity: "BV2",
    label: "y",
    sign: -1,
    amountCents: 200,
    dueDate: "2026-05-01",
    source: "vat",
    status: "confirmed",
  });
  expect(scheduledFlowsForScope([a, b], "BV1")).toEqual([a]);
  expect(scheduledFlowsForScope([a, b], "")).toEqual([a, b]);
});

test("reservedCents sums outflow 'vat' flows not yet paid/cancelled (earmarked money)", () => {
  const flows = [
    makeScheduledFlow({
      entity: "BV1",
      label: "BTW",
      sign: -1,
      amountCents: 50000,
      dueDate: "2026-05-01",
      source: "vat",
      status: "confirmed",
    }),
    makeScheduledFlow({
      entity: "BV1",
      label: "BTW paid",
      sign: -1,
      amountCents: 9900,
      dueDate: "2026-02-01",
      source: "vat",
      status: "paid",
    }),
    makeScheduledFlow({
      entity: "BV1",
      label: "invoice",
      sign: -1,
      amountCents: 7000,
      dueDate: "2026-05-01",
      source: "invoice",
      status: "expected",
    }),
  ];
  expect(reservedCents(flows, "2026-04-01")).toBe(50000); // only the unpaid vat flow
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm vitest run packages/core/src/scheduledFlows.test.ts` → FAIL (module not found).

- [ ] **Step 3: Add types to `packages/core/src/model.ts`** (append):

```ts
/** A signed, dated future cash movement the forecast can see BEFORE the bank
 *  transaction lands (a VAT set-aside, an expected invoice, a manual plan).
 *  amountCents is a POSITIVE magnitude; `sign` gives direction (1 in / -1 out). */
export type ScheduledFlow = {
  id: string;
  entity: string;
  label: string;
  sign: 1 | -1;
  amountCents: number;
  dueDate: string; // ISO YYYY-MM-DD
  source: "vat" | "invoice" | "manual";
  status: "expected" | "confirmed" | "paid" | "cancelled";
};

/** Per-entity (per-BV) VAT/BTW config for the set-aside estimate. */
export type VatSettings = {
  entity: string;
  frequency: "monthly" | "quarterly" | "yearly";
  defaultRatePct: number; // e.g. 21
  mixedRates: boolean; // true => don't auto-estimate; manual-only
  manualCents?: number; // manual override of the amount to set aside this period
};
```

- [ ] **Step 4: Create `packages/core/src/scheduledFlows.ts`**:

```ts
import type { ScheduledFlow } from "./model.js";
import { hash } from "./hash.js";

/** Build a ScheduledFlow with a content-hashed id (same content => same id, so
 *  recomputing a VAT period doesn't create duplicates). */
export function makeScheduledFlow(f: Omit<ScheduledFlow, "id">): ScheduledFlow {
  const id = hash([f.entity, f.source, f.dueDate, f.sign, f.amountCents, f.label].join("|"));
  return { ...f, id };
}

/** Filter to one entity ("" = all). */
export function scheduledFlowsForScope(flows: ScheduledFlow[], entity = ""): ScheduledFlow[] {
  return entity ? flows.filter((f) => f.entity === entity) : flows;
}

/** Money already earmarked for VAT that hasn't left the account yet — netted
 *  from "beschikbaar saldo". Only outflow `vat` flows that are not paid/cancelled. */
export function reservedCents(flows: ScheduledFlow[], _asOf: string): number {
  return flows
    .filter(
      (f) => f.source === "vat" && f.sign === -1 && f.status !== "paid" && f.status !== "cancelled",
    )
    .reduce((s, f) => s + f.amountCents, 0);
}
```

- [ ] **Step 5: Export from `packages/core/src/index.ts`** — add after the `views` export line:

```ts
export * from "./scheduledFlows.js";
export * from "./tax.js";
```

(`./tax.js` is created in Task 4; add both now so the barrel is stable. If the implementer runs Task 1 in isolation, temporarily omit the `tax.js` line and add it in Task 4.)

- [ ] **Step 6: Run tests** — `pnpm vitest run packages/core/src/scheduledFlows.test.ts` → PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/model.ts packages/core/src/scheduledFlows.ts packages/core/src/scheduledFlows.test.ts packages/core/src/index.ts
git commit -m "feat(core): ScheduledFlow + VatSettings types and pure helpers

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Fold `scheduledFlows` into the forecast roll-forward

**Files:**

- Modify: `packages/core/src/forecast.ts`
- Test: `packages/core/src/forecast.test.ts` (append)

**Interfaces:**

- Consumes: `ScheduledFlow`, `scheduledFlowsForScope` (Task 1).
- Produces: `ForecastOptions.scheduledFlows?: ScheduledFlow[]` — a scheduled flow whose `dueDate` is after `asOf` and on/before the horizon moves the projected closing balance on that day.

**Context:** `forecast.ts` today has `type ForecastOptions = { asOf: string; horizonDays?: number; bufferCents?: number }`, a `buildForecast(scopeTxs, scopeAccounts, scope, asOf, horizonDays, bufferCents)` with a day loop `for (let d = 1; d <= horizonDays; d++) { const day = addDays(asOf, d); bal += incidentalPerDayCents; for (const s of streams) {...} if (d % 7 === 0) points.push(...) }`, and `forecastCashflow(txs, accounts, opts)` which partitions by entity and calls `buildForecast`. Only `openingCents !== null` scopes produce a saldo line.

- [ ] **Step 1: Write the failing test** — append to `packages/core/src/forecast.test.ts`

```ts
import { makeScheduledFlow } from "./scheduledFlows.js";

test("forecast: a scheduled outflow on its due date lowers the projected closing", () => {
  const accounts = [
    { key: "A", iban: "A", name: "A", bank: "ING", entity: "BV1", currency: "EUR", balance: 1000 },
  ];
  const flow = makeScheduledFlow({
    entity: "BV1",
    label: "BTW",
    sign: -1,
    amountCents: 30000,
    dueDate: "2026-08-15",
    source: "vat",
    status: "confirmed",
  });
  const withFlow = forecastCashflow([], accounts, {
    asOf: "2026-08-01",
    scheduledFlows: [flow],
  }).consolidated;
  const without = forecastCashflow([], accounts, { asOf: "2026-08-01" }).consolidated;
  // €300 lower from the due date onward (week 3 point = day 21, after 08-15)
  const wk3With = withFlow.points.find((p) => p.date >= "2026-08-15")!;
  const wk3Without = without.points.find((p) => p.date >= "2026-08-15")!;
  expect((wk3Without.projectedClosingCents ?? 0) - (wk3With.projectedClosingCents ?? 0)).toBe(
    30000,
  );
});

test("forecast: no scheduledFlows => identical to before (additive)", () => {
  const accounts = [
    { key: "A", iban: "A", name: "A", bank: "ING", entity: "BV1", currency: "EUR", balance: 500 },
  ];
  const a = forecastCashflow([], accounts, { asOf: "2026-08-01" }).consolidated;
  const b = forecastCashflow([], accounts, { asOf: "2026-08-01", scheduledFlows: [] }).consolidated;
  expect(a.points).toEqual(b.points);
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm vitest run packages/core/src/forecast.test.ts -t scheduled` → FAIL.

- [ ] **Step 3: Modify `forecast.ts`.** (a) import at top:

```ts
import type { ScheduledFlow } from "./model.js";
import { scheduledFlowsForScope } from "./scheduledFlows.js";
```

(b) Extend `ForecastOptions`:

```ts
export type ForecastOptions = {
  asOf: string;
  horizonDays?: number;
  bufferCents?: number;
  scheduledFlows?: ScheduledFlow[];
};
```

(c) Add a `scheduledFlows` parameter to `buildForecast` (default `[]`) and apply it in the day loop. Change the signature to accept it and, inside the `for (let d ...)` loop, right after the `for (const s of streams)` block and before the `if (d % 7 === 0)`:

```ts
for (const f of scheduledFlows) {
  if (f.status === "cancelled" || f.status === "paid") continue;
  if (f.dueDate === day) bal += f.sign * f.amountCents;
}
```

(d) In `forecastCashflow`, partition flows by entity and pass them through:

```ts
const allFlows = opts.scheduledFlows ?? [];
// ...for each entity e:
byEntity[e] = buildForecast(
  scopeTxsByEntity.get(e) ?? [],
  scopeAccountsByEntity.get(e) ?? [],
  e,
  asOf,
  horizonDays,
  bufferCents,
  scheduledFlowsForScope(allFlows, e),
);
// ...consolidated:
const consolidated = buildForecast(
  txs,
  accounts,
  "geconsolideerd",
  asOf,
  horizonDays,
  bufferCents,
  allFlows,
);
```

Update `buildForecast`'s signature to `(scopeTxs, scopeAccounts, scope, asOf, horizonDays, bufferCents, scheduledFlows: ScheduledFlow[] = [])`.

- [ ] **Step 4: Run tests** — `pnpm vitest run packages/core/src/forecast.test.ts` → PASS (new + all existing).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/forecast.ts packages/core/src/forecast.test.ts
git commit -m "feat(core): forecast folds scheduledFlows in as a third flow source

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: `availableBalance` — net reservations out of spendable cash

**Files:**

- Modify: `packages/core/src/balance.ts`
- Test: `packages/core/src/balance.test.ts` (append)

**Interfaces:**

- Consumes: `reservedCents` (Task 1), `currentBalance`/`withCurrentBalances` (existing).
- Produces: `availableBalanceCents(totalBalance: number, flows: ScheduledFlow[], asOf: string): number` — `round(totalBalance*100) - reservedCents`.

- [ ] **Step 1: Write the failing test** — append to `packages/core/src/balance.test.ts`

```ts
import { availableBalanceCents } from "./balance.js";
import { makeScheduledFlow } from "./scheduledFlows.js";

test("availableBalanceCents subtracts unpaid VAT reservations from the total", () => {
  const flows = [
    makeScheduledFlow({
      entity: "BV1",
      label: "BTW",
      sign: -1,
      amountCents: 45000,
      dueDate: "2026-05-01",
      source: "vat",
      status: "confirmed",
    }),
  ];
  expect(availableBalanceCents(1000, flows, "2026-04-01")).toBe(100000 - 45000); // €1000 - €450 = €550
  expect(availableBalanceCents(1000, [], "2026-04-01")).toBe(100000);
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm vitest run packages/core/src/balance.test.ts -t availableBalance` → FAIL.

- [ ] **Step 3: Implement in `balance.ts`** (append):

```ts
import type { ScheduledFlow } from "./model.js";
import { reservedCents } from "./scheduledFlows.js";

/** Spendable cash = total balance (euros) minus money earmarked for VAT
 *  (reservations), in integer cents. The forecast still places the actual VAT
 *  outflow on its due date; this is the "beschikbaar NU" view. */
export function availableBalanceCents(
  totalBalanceEuros: number,
  flows: ScheduledFlow[],
  asOf: string,
): number {
  return Math.round(totalBalanceEuros * 100) - reservedCents(flows, asOf);
}
```

- [ ] **Step 4: Run tests** — `pnpm vitest run packages/core/src/balance.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/balance.ts packages/core/src/balance.test.ts
git commit -m "feat(core): availableBalanceCents nets VAT reservations out of spendable cash

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: NL BTW rules + deadline calculator

**Files:**

- Create: `packages/core/src/tax.ts`
- Test: `packages/core/src/tax.test.ts`

**Interfaces:**

- Produces: `NL_VAT_RATES` (readonly), `BTW_RULES_AS_OF` (string), `nextBtwDeadline(frequency, asOf): { periodLabel: string; periodEnd: string; deadline: string }`.

**NL fact (verify at build time; the spec lists it):** a BTW aangifte+betaling is due the **last day of the month after** the period. Quarterly Q1 (Jan–Mar) ⇒ deadline **30 Apr**; Q2 ⇒ 31 Jul; Q3 ⇒ 31 Oct; Q4 ⇒ 31 Jan (next year). Monthly ⇒ last day of the following month. Yearly ⇒ 31 Mar next year. (Weekend shifting exists in practice; MVP uses the calendar last-day and notes lower confidence — do NOT silently invent Belastingdienst business-day rules.)

- [ ] **Step 1: Write the failing test** — `packages/core/src/tax.test.ts`

```ts
import { expect, test } from "vitest";
import { nextBtwDeadline, BTW_RULES_AS_OF } from "./tax.js";

test("nextBtwDeadline quarterly: from mid-Q2 -> Q2 ends 06-30, deadline 07-31", () => {
  expect(nextBtwDeadline("quarterly", "2026-05-10")).toEqual({
    periodLabel: "Q2 2026",
    periodEnd: "2026-06-30",
    deadline: "2026-07-31",
  });
});
test("nextBtwDeadline quarterly: Q4 deadline rolls into next year (31 Jan)", () => {
  expect(nextBtwDeadline("quarterly", "2026-11-15")).toEqual({
    periodLabel: "Q4 2026",
    periodEnd: "2026-12-31",
    deadline: "2027-01-31",
  });
});
test("nextBtwDeadline monthly: Aug -> deadline 30 Sep", () => {
  expect(nextBtwDeadline("monthly", "2026-08-04")).toEqual({
    periodLabel: "aug 2026",
    periodEnd: "2026-08-31",
    deadline: "2026-09-30",
  });
});
test("has a verified-as-of date", () => {
  expect(BTW_RULES_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm vitest run packages/core/src/tax.test.ts` → FAIL.

- [ ] **Step 3: Create `packages/core/src/tax.ts`**:

```ts
import type { Tx, VatSettings } from "./model.js";
import { makeScheduledFlow } from "./scheduledFlows.js";
import type { ScheduledFlow } from "./model.js";

/** INDICATIVE snapshot — verify against the Belastingdienst. */
export const BTW_RULES_AS_OF = "2026-08-04";
export const NL_VAT_RATES = [21, 9, 0] as const;

/** ISO last day of month (y, m1..12). */
function lastDayOfMonth(y: number, m: number): string {
  const d = new Date(Date.UTC(y, m, 0)); // day 0 of next month = last day of month m
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

const Q_LABEL = ["Q1", "Q2", "Q3", "Q4"];
const NL_MONTHS = [
  "jan",
  "feb",
  "mrt",
  "apr",
  "mei",
  "jun",
  "jul",
  "aug",
  "sep",
  "okt",
  "nov",
  "dec",
];

/** The current period's end + its aangifte/betaling deadline (last day of the
 *  month AFTER the period end), relative to asOf. */
export function nextBtwDeadline(
  frequency: VatSettings["frequency"],
  asOf: string,
): { periodLabel: string; periodEnd: string; deadline: string } {
  const [y, m] = asOf.split("-").map(Number); // m: 1..12
  if (frequency === "yearly") {
    return { periodLabel: `${y}`, periodEnd: `${y}-12-31`, deadline: `${y + 1}-03-31` };
  }
  if (frequency === "monthly") {
    const periodEnd = lastDayOfMonth(y, m); // last day of this month
    const nextM = m === 12 ? 1 : m + 1;
    const nextY = m === 12 ? y + 1 : y;
    return {
      periodLabel: `${NL_MONTHS[m - 1]} ${y}`,
      periodEnd,
      deadline: lastDayOfMonth(nextY, nextM),
    };
  }
  // quarterly
  const q = Math.floor((m - 1) / 3); // 0..3
  const periodEndMonth = (q + 1) * 3; // 3,6,9,12
  const periodEnd = lastDayOfMonth(y, periodEndMonth);
  const deadlineMonth = periodEndMonth === 12 ? 1 : periodEndMonth + 1;
  const deadlineYear = periodEndMonth === 12 ? y + 1 : y;
  return {
    periodLabel: `${Q_LABEL[q]} ${y}`,
    periodEnd,
    deadline: lastDayOfMonth(deadlineYear, deadlineMonth),
  };
}

export {}; // (computeVatSetAside added in Task 5)
```

- [ ] **Step 4: Run tests** — `pnpm vitest run packages/core/src/tax.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tax.ts packages/core/src/tax.test.ts
git commit -m "feat(core): NL BTW rates + nextBtwDeadline calculator

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `computeVatSetAside` — estimate the reservation per BTW period

**Files:**

- Modify: `packages/core/src/tax.ts`
- Test: `packages/core/src/tax.test.ts` (append)

**Interfaces:**

- Consumes: `Tx`, `VatSettings`, `nextBtwDeadline`, `makeScheduledFlow`.
- Produces: `computeVatSetAside(txs, settings, asOf): ScheduledFlow | null` — a `source:"vat"`, `sign:-1`, `status:"confirmed"` flow due on the BTW deadline. `null` when nothing to reserve.

**Estimate (deterministic, conservative, clearly an estimate):** for the entity's txs inside the current period, net VAT ≈ `round((incomeGross − expenseGross) × r / (100 + r))`, floored at 0 (you reserve owed VAT, not a refund). `income` = positive amounts, `expense` = |negative amounts|, over the period `[periodEnd−cadence, periodEnd]`. If `settings.mixedRates` is true, DO NOT estimate — return a flow only if `manualCents` is set. If `settings.manualCents` is set, it overrides the estimate.

- [ ] **Step 1: Write the failing test** — append to `packages/core/src/tax.test.ts`

```ts
import { computeVatSetAside } from "./tax.js";
import type { Tx, VatSettings } from "./model.js";

const tx = (date: string, amount: number): Tx => ({
  id: date + amount,
  accountKey: "A",
  date,
  amount,
  currency: "EUR",
  counterparty: "x",
  description: "",
  category: "",
  manual: false,
});
const settings = (o: Partial<VatSettings> = {}): VatSettings => ({
  entity: "BV1",
  frequency: "quarterly",
  defaultRatePct: 21,
  mixedRates: false,
  ...o,
});

test("computeVatSetAside: 21% net-VAT on Q2 margin, due 07-31", () => {
  // Q2 2026 (apr-jun): income 12100, expense 2420 -> margin 9680 -> VAT 9680*21/121 = 1680.00
  const txs = [tx("2026-04-10", 12100), tx("2026-05-05", -2420), tx("2026-01-01", 99999)];
  const f = computeVatSetAside(txs, settings(), "2026-06-20")!;
  expect(f).toMatchObject({
    source: "vat",
    sign: -1,
    status: "confirmed",
    dueDate: "2026-07-31",
    entity: "BV1",
  });
  expect(f.amountCents).toBe(168000);
});

test("computeVatSetAside: negative margin -> no reservation (null)", () => {
  expect(
    computeVatSetAside([tx("2026-05-01", 1000), tx("2026-05-02", -5000)], settings(), "2026-06-20"),
  ).toBeNull();
});

test("computeVatSetAside: mixedRates without manual -> null; manual override wins", () => {
  expect(
    computeVatSetAside([tx("2026-05-01", 99999)], settings({ mixedRates: true }), "2026-06-20"),
  ).toBeNull();
  const f = computeVatSetAside(
    [tx("2026-05-01", 99999)],
    settings({ mixedRates: true, manualCents: 500000 }),
    "2026-06-20",
  )!;
  expect(f.amountCents).toBe(500000);
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm vitest run packages/core/src/tax.test.ts -t computeVatSetAside` → FAIL.

- [ ] **Step 3: Implement in `tax.ts`** — replace the `export {};` line with:

```ts
const CADENCE_DAYS: Record<VatSettings["frequency"], number> = {
  monthly: 31,
  quarterly: 92,
  yearly: 366,
};

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** Estimate the VAT to set aside for the current BTW period, as a confirmed
 *  outflow ScheduledFlow due on the deadline. See header for the estimate. */
export function computeVatSetAside(
  txs: Tx[],
  settings: VatSettings,
  asOf: string,
): ScheduledFlow | null {
  const { periodLabel, periodEnd, deadline } = nextBtwDeadline(settings.frequency, asOf);
  const cadence = CADENCE_DAYS[settings.frequency];

  let amountCents: number;
  if (typeof settings.manualCents === "number") {
    amountCents = Math.max(0, Math.round(settings.manualCents));
  } else if (settings.mixedRates) {
    return null; // can't safely auto-estimate mixed rates
  } else {
    let incomeCents = 0;
    let expenseCents = 0;
    for (const t of txs) {
      const age = daysBetween(t.date, periodEnd); // 0..cadence => inside the period
      if (age < 0 || age >= cadence) continue;
      const c = Math.round(t.amount * 100);
      if (c >= 0) incomeCents += c;
      else expenseCents += -c;
    }
    const marginCents = incomeCents - expenseCents;
    const r = settings.defaultRatePct;
    amountCents = marginCents > 0 ? Math.round((marginCents * r) / (100 + r)) : 0;
  }
  if (amountCents <= 0) return null;
  return makeScheduledFlow({
    entity: settings.entity,
    label: `BTW ${periodLabel}`,
    sign: -1,
    amountCents,
    dueDate: deadline,
    source: "vat",
    status: "confirmed",
  });
}
```

- [ ] **Step 4: Run tests** — `pnpm vitest run packages/core/src/tax.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/tax.ts packages/core/src/tax.test.ts
git commit -m "feat(core): computeVatSetAside estimates the BTW reservation per period

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: BTW deadline alerts

**Files:**

- Modify: `packages/core/src/alerts.ts`
- Test: `packages/core/src/alerts.test.ts` (append)

**Interfaces:**

- Consumes: `ScheduledFlow` (Task 1). Extends `ComputeAlertsInput` with optional `scheduledFlows?: ScheduledFlow[]`.
- Produces: a `warning`/`critical`/`info` alert per upcoming `vat` flow, ranked by the existing ladder: `<=3` days ⇒ critical, `<=14` ⇒ warning, `<=30` ⇒ info; beyond 30 days ⇒ no alert.

**Context:** `computeAlerts({ accounts, forecast, asOf, bufferCents })` returns ranked `Alert[]`; it already has `daysBetween`, `eur`, and the `rank` sort. Add `scheduledFlows` to the input and emit alerts for `source:"vat"`, `status` not paid/cancelled, `dueDate >= asOf`.

- [ ] **Step 1: Write the failing test** — append to `packages/core/src/alerts.test.ts`

```ts
import { makeScheduledFlow } from "./scheduledFlows.js";

test("computeAlerts: BTW deadline within 14 days -> warning with the amount", () => {
  const vat = makeScheduledFlow({
    entity: "BV1",
    label: "BTW Q2 2026",
    sign: -1,
    amountCents: 168000,
    dueDate: "2026-08-10",
    source: "vat",
    status: "confirmed",
  });
  const alerts = computeAlerts({
    accounts: [acc("A", 1000)],
    asOf: "2026-08-01",
    bufferCents: 0,
    forecast: fc({}),
    scheduledFlows: [vat],
  });
  const w = alerts.filter((a) => a.id.startsWith("vat:"));
  expect(w).toHaveLength(1);
  expect(w[0].severity).toBe("warning");
  expect(w[0].detail).toContain("1.680,00");
});
test("computeAlerts: BTW deadline > 30 days out -> no alert", () => {
  const vat = makeScheduledFlow({
    entity: "BV1",
    label: "BTW",
    sign: -1,
    amountCents: 100,
    dueDate: "2026-12-31",
    source: "vat",
    status: "confirmed",
  });
  expect(
    computeAlerts({
      accounts: [acc("A", 1000)],
      asOf: "2026-08-01",
      bufferCents: 0,
      forecast: fc({}),
      scheduledFlows: [vat],
    }).filter((a) => a.id.startsWith("vat:")),
  ).toHaveLength(0);
});
```

(Reuse the `acc` and `fc` helpers already defined at the top of `alerts.test.ts`.)

- [ ] **Step 2: Run test to verify it fails** — `pnpm vitest run packages/core/src/alerts.test.ts -t BTW` → FAIL.

- [ ] **Step 3: Modify `alerts.ts`.** (a) import + extend input:

```ts
import type { ScheduledFlow } from "./model.js";
// ...
export type ComputeAlertsInput = {
  accounts: Account[];
  forecast: EntityForecast;
  asOf: string;
  bufferCents: number;
  scheduledFlows?: ScheduledFlow[];
};
```

(b) In `computeAlerts`, after the missed-payment loop and before the no-balance block, add:

```ts
for (const f of opts.scheduledFlows ?? []) {
  if (f.source !== "vat" || f.status === "paid" || f.status === "cancelled") continue;
  const days = daysBetween(asOf, f.dueDate); // dueDate - asOf
  if (days < 0 || days > 30) continue;
  const severity = days <= 3 ? "critical" : days <= 14 ? "warning" : "info";
  alerts.push({
    id: `vat:${f.id}`,
    severity,
    title: `${f.label} — betaal vóór ${f.dueDate}`,
    detail: `Zet ${eur(f.amountCents)} klaar; de BTW-aangifte + betaling moet uiterlijk ${f.dueDate} (over ${days} dagen).`,
  });
}
```

(Adjust the destructure at the top of `computeAlerts` to include `asOf`/`bufferCents` as today; `opts` is the full input.)

- [ ] **Step 4: Run tests** — `pnpm vitest run packages/core/src/alerts.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/alerts.ts packages/core/src/alerts.test.ts
git commit -m "feat(core): BTW deadline alerts via the existing severity ladder

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Vault storage for scheduledFlows + vatSettings

**Files:**

- Modify: `packages/adapters/src/storage/encryptedStorage.ts`
- Test: `packages/adapters/src/storage/encryptedStorage.test.ts` (append)

**Interfaces:**

- Produces on `VaultStorage`: `getScheduledFlows(): Promise<ScheduledFlow[]>`, `putScheduledFlows(f: ScheduledFlow[]): Promise<void>` (replace-all), `getVatSettings(): Promise<VatSettings[]>`, `putVatSettings(s: VatSettings[]): Promise<void>` (replace-all).

**Context:** the vault is a single encrypted blob `VaultData = { accounts; txs; rules }`. New optional fields round-trip automatically; a legacy vault decrypts without them, so getters default to `[]`. NO DB_VERSION bump, NO migrate.ts change. Follow the existing `putRules` (replace-all, `enqueueWrite` + `persist`) pattern.

- [ ] **Step 1: Write the failing test** — append to `packages/adapters/src/storage/encryptedStorage.test.ts`

```ts
test("scheduledFlows + vatSettings round-trip; legacy vault defaults to empty", async () => {
  const s = createEncryptedStorage("lavega-vault-test-sf");
  await s.setup("pw");
  expect(await s.getScheduledFlows()).toEqual([]); // default
  const flow = {
    id: "f1",
    entity: "BV1",
    label: "BTW",
    sign: -1 as const,
    amountCents: 1000,
    dueDate: "2026-05-01",
    source: "vat" as const,
    status: "confirmed" as const,
  };
  await s.putScheduledFlows([flow]);
  await s.putVatSettings([
    { entity: "BV1", frequency: "quarterly", defaultRatePct: 21, mixedRates: false },
  ]);
  expect(await s.getScheduledFlows()).toEqual([flow]);
  expect(await s.getVatSettings()).toHaveLength(1);
});
```

(Match the existing test file's setup — it uses `fake-indexeddb/auto` + a jsdom env at the top; reuse those.)

- [ ] **Step 2: Run test to verify it fails** — `pnpm vitest run packages/adapters/src/storage/encryptedStorage.test.ts -t round-trip` → FAIL.

- [ ] **Step 3: Modify `encryptedStorage.ts`.** (a) imports + type:

```ts
import type { Account, Tx, Rule, ScheduledFlow, VatSettings } from "@lavega/core";
// ...
type VaultData = {
  accounts: Account[];
  txs: Tx[];
  rules: Rule[];
  scheduledFlows?: ScheduledFlow[];
  vatSettings?: VatSettings[];
};
```

(b) Extend the `VaultStorage` interface:

```ts
  getScheduledFlows(): Promise<ScheduledFlow[]>;
  putScheduledFlows(f: ScheduledFlow[]): Promise<void>;
  getVatSettings(): Promise<VatSettings[]>;
  putVatSettings(s: VatSettings[]): Promise<void>;
```

(c) Add the methods to the returned object (next to `getRules`/`putRules`), replace-all like `putRules`:

```ts
    async getScheduledFlows(): Promise<ScheduledFlow[]> {
      if (data == null) throw new Error(LOCKED_ERROR);
      return [...(data.scheduledFlows ?? [])];
    },
    putScheduledFlows(f: ScheduledFlow[]): Promise<void> {
      return enqueueWrite(async () => {
        if (key == null || data == null) throw new Error(LOCKED_ERROR);
        data = { ...data, scheduledFlows: [...f] };
        await persist();
      });
    },
    async getVatSettings(): Promise<VatSettings[]> {
      if (data == null) throw new Error(LOCKED_ERROR);
      return [...(data.vatSettings ?? [])];
    },
    putVatSettings(s: VatSettings[]): Promise<void> {
      return enqueueWrite(async () => {
        if (key == null || data == null) throw new Error(LOCKED_ERROR);
        data = { ...data, vatSettings: [...s] };
        await persist();
      });
    },
```

- [ ] **Step 4: Run tests** — `pnpm vitest run packages/adapters/src/storage/encryptedStorage.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/adapters/src/storage/encryptedStorage.ts packages/adapters/src/storage/encryptedStorage.test.ts
git commit -m "feat(adapters): vault stores scheduledFlows + vatSettings (single-blob, no migration)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Minimal "Belasting" web surface + wiring

**Files:**

- Create: `apps/web/src/views/Belasting.tsx`
- Modify: `apps/web/src/App.tsx`, `apps/web/src/components/Sidebar.tsx`, `apps/web/src/components/TopBar.tsx`
- Test: `apps/web/src/belasting.test.ts` (NEW — pure wiring test, jsdom + fake-indexeddb like `categories.test.ts`)

**Interfaces:**

- Consumes everything above: `computeVatSetAside`, `nextBtwDeadline`, `availableBalanceCents`, `computeAlerts` (now with `scheduledFlows`), forecast with `scheduledFlows`, and the new storage methods.

**Scope note (UI later):** keep this minimal and functional, not polished. It must let the owner (a) set VAT settings per entity, (b) see the next BTW deadline + estimated set-aside, (c) recompute + save the reservation, and it must feed `scheduledFlows` into the existing Overzicht forecast + alerts. Detailed styling is deferred.

- [ ] **Step 1: Write the failing test** — `apps/web/src/belasting.test.ts`

```ts
// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { expect, test } from "vitest";
import { computeVatSetAside, nextBtwDeadline } from "@lavega/core";
import type { Tx, VatSettings } from "@lavega/core";

test("Belasting wiring: settings + txs -> a savable VAT ScheduledFlow", () => {
  const settings: VatSettings = {
    entity: "BV1",
    frequency: "quarterly",
    defaultRatePct: 21,
    mixedRates: false,
  };
  const txs: Tx[] = [
    {
      id: "t",
      accountKey: "A",
      date: "2026-05-01",
      amount: 12100,
      currency: "EUR",
      counterparty: "Klant",
      description: "",
      category: "",
      manual: false,
    },
  ];
  const dl = nextBtwDeadline("quarterly", "2026-06-20");
  const flow = computeVatSetAside(txs, settings, "2026-06-20");
  expect(dl.deadline).toBe("2026-07-31");
  expect(flow?.source).toBe("vat");
  expect(flow?.dueDate).toBe("2026-07-31");
});
```

- [ ] **Step 2: Run test to verify it fails** — `pnpm vitest run apps/web/src/belasting.test.ts` → FAIL (or PASS once core is built; this guards the wiring contract).

- [ ] **Step 3: Add the `View` value + nav.** In `App.tsx` extend `export type View` with `"belasting"`; in `Sidebar.tsx` add an `belasting` icon entry + `{ key: "belasting", label: "Belasting" }` in `NAV_ITEMS`; in `TopBar.tsx` add `belasting: "Belasting"` to `VIEW_TITLES`.

- [ ] **Step 4: Create `apps/web/src/views/Belasting.tsx`** — a card with, per entity: a frequency `<select>`, a default-rate input, a `mixedRates` checkbox, a manual-override input; a computed "Volgende BTW-deadline: {deadline}" and "Geschat opzij te zetten: {euro}"; and a "Bereken & bewaar" button that calls `computeVatSetAside` per entity and persists via `onSaveScheduledFlows`. Props:

```ts
type BelastingProps = {
  entities: string[];
  txs: Tx[];
  asOf: string;
  vatSettings: VatSettings[];
  scheduledFlows: ScheduledFlow[];
  busy: boolean;
  onSaveVatSettings: (s: VatSettings[]) => void;
  onSaveScheduledFlows: (f: ScheduledFlow[]) => void;
};
```

Implementation: for each entity, resolve its `VatSettings` (default `{entity, frequency:"quarterly", defaultRatePct:21, mixedRates:false}`), show `nextBtwDeadline(freq, asOf)` and a live `computeVatSetAside(entityTxs, settings, asOf)` preview (formatEuro of `amountCents/100`). "Bereken & bewaar": rebuild the `vat`-source flows (drop old `source:"vat"` flows for that entity, add the freshly computed one if non-null) and call `onSaveScheduledFlows`. Reuse `.card/.table/.btn/.eyebrow` classes.

- [ ] **Step 5: Wire `App.tsx`.** Load + hold state:

```ts
const [scheduledFlows, setScheduledFlows] = useState<ScheduledFlow[]>([]);
const [vatSettings, setVatSettings] = useState<VatSettings[]>([]);
// in the gate-ready load effect, also:
setScheduledFlows(await storage.getScheduledFlows());
setVatSettings(await storage.getVatSettings());
```

Persist helpers (mirror `saveRules`):

```ts
async function saveScheduledFlows(next: ScheduledFlow[]) {
  setScheduledFlows(next);
  await storage.putScheduledFlows(next);
}
async function saveVatSettings(next: VatSettings[]) {
  setVatSettings(next);
  await storage.putVatSettings(next);
}
```

Thread `scheduledFlows` into the forecast + alerts by passing it to `Overzicht` and `Forecast` (add a `scheduledFlows` prop and include it in their `forecastCashflow({ ..., scheduledFlows })` and `computeAlerts({ ..., scheduledFlows })` calls). Filter by `entityScope` with `scheduledFlowsForScope(scheduledFlows, entityScope)` where a scope is active. Route:

```tsx
{
  view === "belasting" && (
    <Belasting
      entities={entityOptions}
      txs={scopedTxs}
      asOf={asOf}
      vatSettings={vatSettings}
      scheduledFlows={scheduledFlows}
      busy={busy}
      onSaveVatSettings={saveVatSettings}
      onSaveScheduledFlows={saveScheduledFlows}
    />
  );
}
```

- [ ] **Step 6: Run the full suite + typecheck + build.**

```bash
pnpm test && pnpm typecheck && pnpm --filter @lavega/web build
```

Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): minimal Belasting view — VAT set-aside + BTW deadline, wired into forecast/alerts

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Deferred to Phase 2 (not in this plan)

The agent LLM-proxy (`/api/agent/*` + `ANTHROPIC_API_KEY`), the redaction-boundary helper + rate limiter, the connector abstraction (`InvoiceAccessAdapter`, Gmail/MS-Graph OAuth), and the "Koppelingen" consent view are built **just before Phase 2 (Invoice connectors/LLM)**, when there is an agent that actually calls out — YAGNI until then. Phase 0/1 above is fully deterministic, local, and shippable on its own.

## Self-Review notes

- Spec coverage: ScheduledFlow ✓ (T1), forecast wiring ✓ (T2), reservation netting ✓ (T3), NL BTW rules/deadlines ✓ (T4), computeVatSetAside + manual override + mixed-rate escape ✓ (T5), deadline alerts via ladder ✓ (T6), vault storage ✓ (T7), per-BV settings + minimal UI ✓ (T8). The LLM-proxy/redaction/consent/connectors from the design's Phase 0 are consciously deferred to Phase 2 (documented above) — they have no consumer in Phase 0/1.
- Type consistency: `ScheduledFlow`/`VatSettings` defined once in `model.ts`; `computeVatSetAside` returns `ScheduledFlow | null`; forecast/alerts/storage all import from `@lavega/core`.
- Estimate honesty: `computeVatSetAside` is a documented margin proxy with a manual override and a mixed-rate escape hatch — never presented as exact.

# LaVega — Deterministic cashflow forecast engine (core) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** A pure, deterministic 13-week cashflow forecast in `@lavega/core` — re-implemented in TypeScript from the FinnTell deterministic-forecast design spec (clean-room; the Python engine and its ML/backtest harness are NOT ported). Detect recurring streams from transaction history, roll them forward day-by-day per entity + consolidated, add a simple incidental baseline, and flag the first shortfall below a buffer. This is roadmap #2; the forecast VIEW is Phase 2 (a separate plan).

**Architecture:** One pure module `packages/core/src/forecast.ts` (+ types). Integer-cents arithmetic internally so output is bit-identical every run ("no float drift in the hero number"). Consumes the existing `Tx`/`Account` model; uses `norm` from hash.ts. No I/O, no new dependencies, no ML, no tax overlay, no backtest harness.

**Reference (method only — clean-room, do NOT copy code):** the FinnTell design spec at `/Users/alexandersteunenberg/Desktop/My_Code/finntell/docs/superpowers/specs/2026-06-29-finntell-deterministic-forecast-engine-design.md` §6 (algorithms + parameters).

## Global Constraints

- **`packages/core` stays I/O-free**; ESM (`.js` specifiers); no new deps.
- **Deterministic** — identical output across runs; no `Date.now()`/`Math.random()` inside the module (the caller passes `asOf`). Integer cents internally; expose euro `number`s only at the boundary if needed (the UI formats).
- **No changes** to `consolidate`/`ingest`/`tx.id`/parsers/existing views.
- Amounts in `Tx.amount` are signed euros (negative = outflow); convert to cents via `Math.round(amount * 100)`.
- Deferred (NOT this plan, note in code): NL BTW tax overlay, ADI/CV² + Croston/SBA routing, ML challengers, backtest harness, the residual-quantile (backtest-calibrated) cone.

---

### Task 1: Recurring-stream detection

**Files:**

- Create: `packages/core/src/forecast.ts` (types + `detectRecurringStreams`)
- Create: `packages/core/src/forecast.test.ts`
- Modify: `packages/core/src/index.ts` (add `export * from "./forecast.js";`)

**Interfaces produced:**

```ts
export type RecurringStream = {
  key: string; // norm(counterparty) + "|" + (sign > 0 ? "in" : "out")
  counterparty: string; // the (raw) counterparty of the first occurrence
  sign: 1 | -1; // 1 = inflow, -1 = outflow
  cadenceDays: number; // snapped: 7 | 14 | 30 | 91 | 365
  amountCents: number; // representative magnitude (median of |amount| in cents), POSITIVE
  occurrences: number;
  lastDate: string; // ISO date of the most recent occurrence
  intervalCv: number; // std/mean of the day-gaps (0 if <2 gaps)
};
export type DetectOptions = {
  minOccurrences?: number;
  maxIntervalCv?: number;
  amountTolerance?: number;
};
export function detectRecurringStreams(txs: Tx[], opts?: DetectOptions): RecurringStream[];
```

**Algorithm (adapted from spec §6.1):**

- Group by `key = norm(counterparty) + "|" + (amount >= 0 ? "in" : "out")`. Skip txs with `amount === 0`.
- Within each group: sort by `date` ascending; need `occurrences >= minOccurrences` (default 3).
- Day-gaps between consecutive dates (whole days via `daysBetween`). `medianGap` = median of gaps.
- **Snap** `medianGap` to the nearest cadence whose tolerance band contains it: `7 → [6,8]`, `14 → [12,16]`, `30 → [26,36]`, `91 → [84,98]`, `365 → [350,380]`. If it falls in no band, the group is NOT recurring (skip).
- `intervalCv = std(gaps)/mean(gaps)`; reject if `intervalCv > maxIntervalCv` (default 0.35).
- Amounts: `amountCents = median(|amount_i| in cents)`; reject if any occurrence is outside `±amountTolerance` (default 0.25 = 25%) of that median (with a `±€1.00` absolute floor so tiny amounts aren't rejected on rounding).
- On acceptance push a `RecurringStream` (`lastDate` = max date; `sign` from the group).
- **Determinism:** stable sort; ties broken by original order. No randomness.

Helper (module-private, exported for tests is optional): `daysBetween(a: string, b: string): number` (UTC-midnight diff; ISO `YYYY-MM-DD` only, so `Date.UTC` from the parts — do NOT use `new Date(str)` local parsing). `median(nums: number[]): number`.

- [ ] **Step 1: Write failing tests** (`forecast.test.ts`)

```ts
import { expect, test } from "vitest";
import type { Tx } from "./model.js";
import { detectRecurringStreams } from "./forecast.js";

// helper to build a tx quickly
function tx(id: string, date: string, amount: number, cp: string): Tx {
  return {
    id,
    accountKey: "A1",
    date,
    amount,
    currency: "EUR",
    counterparty: cp,
    description: "",
    category: "",
    manual: false,
  };
}

test("detects a monthly salary inflow (3 occurrences, ~30d cadence, stable amount)", () => {
  const txs: Tx[] = [
    tx("1", "2026-04-25", 2500, "Werkgever BV"),
    tx("2", "2026-05-25", 2500, "Werkgever BV"),
    tx("3", "2026-06-25", 2500, "Werkgever BV"),
  ];
  const streams = detectRecurringStreams(txs);
  expect(streams).toHaveLength(1);
  expect(streams[0]).toMatchObject({
    sign: 1,
    cadenceDays: 30,
    amountCents: 250000,
    occurrences: 3,
    lastDate: "2026-06-25",
  });
});

test("detects a weekly outflow and separates it from an inflow of the same counterparty (sign in the key)", () => {
  const txs: Tx[] = [
    tx("1", "2026-06-01", -50, "Spar"),
    tx("2", "2026-06-08", -50, "Spar"),
    tx("3", "2026-06-15", -50, "Spar"),
    tx("4", "2026-06-02", 200, "Spar"),
    tx("5", "2026-06-09", 200, "Spar"),
    tx("6", "2026-06-16", 200, "Spar"),
  ];
  const streams = detectRecurringStreams(txs);
  expect(streams).toHaveLength(2);
  expect(streams.find((s) => s.sign === -1)).toMatchObject({ cadenceDays: 7, amountCents: 5000 });
  expect(streams.find((s) => s.sign === 1)).toMatchObject({ cadenceDays: 7, amountCents: 20000 });
});

test("rejects fewer than 3 occurrences", () => {
  const txs: Tx[] = [tx("1", "2026-05-01", -100, "Rent"), tx("2", "2026-06-01", -100, "Rent")];
  expect(detectRecurringStreams(txs)).toHaveLength(0);
});

test("rejects irregular cadence (no snap band) and wildly variable amounts", () => {
  const irregular: Tx[] = [
    tx("1", "2026-06-01", -30, "X"),
    tx("2", "2026-06-03", -30, "X"),
    tx("3", "2026-06-20", -30, "X"),
  ]; // gaps 2,17 -> median 9.5 no band
  expect(detectRecurringStreams(irregular)).toHaveLength(0);
  const variable: Tx[] = [
    tx("1", "2026-04-01", -10, "Y"),
    tx("2", "2026-05-01", -500, "Y"),
    tx("3", "2026-06-01", -10, "Y"),
  ]; // amounts vary >25%
  expect(detectRecurringStreams(variable)).toHaveLength(0);
});
```

- [ ] **Step 2: Run to verify they fail** — `pnpm test`.
- [ ] **Step 3: Implement** `detectRecurringStreams` + helpers + types per the algorithm above.
- [ ] **Step 4: Add the export** to `index.ts`.
- [ ] **Step 5: Run tests + typecheck** — green. If an assertion is wrong vs the actual (correct) algorithm output, fix the assertion to the true value and note it.
- [ ] **Step 6: Commit** — `feat(core): recurring-stream detection for the cashflow forecast`.

---

### Task 2: Roll-forward + shortfall + band + orchestrator

**Files:**

- Modify: `packages/core/src/forecast.ts` (add the forecast types + `forecastCashflow`)
- Modify: `packages/core/src/forecast.test.ts` (add tests)

**Interfaces produced:**

```ts
export type ForecastPoint = {
  date: string; // ISO, weekly closing date (asOf + 7,14,...)
  projectedClosingCents: number | null; // null when opening is unknown (flow-only)
  lowerCents: number | null;
  upperCents: number | null;
};
export type Shortfall = { date: string; balanceCents: number };
export type Driver = { label: string; sign: 1 | -1; perWeekCents: number }; // avg weekly contribution
export type EntityForecast = {
  scope: string; // entity name, or "geconsolideerd"
  asOf: string;
  horizonDays: number;
  openingCents: number | null;
  points: ForecastPoint[]; // weekly closings, length = horizonDays/7
  shortfall: Shortfall | null; // null if never below buffer (or opening unknown)
  streams: RecurringStream[];
  drivers: Driver[]; // top recurring streams by |perWeekCents|, desc
};
export type ForecastOptions = { asOf: string; horizonDays?: number; bufferCents?: number };
export function forecastCashflow(
  txs: Tx[],
  accounts: Account[],
  opts: ForecastOptions,
): { byEntity: Record<string, EntityForecast>; consolidated: EntityForecast };
```

**Algorithm (adapted from spec §6.3, §6.5, §6.6):**

- `asOf` is REQUIRED (caller passes today — keeps the module deterministic). `horizonDays` default 91 (13 weeks); `bufferCents` default 0.
- Map `accountKey → entity` (via accounts; missing → "onbekend"). Partition txs by entity; also treat ALL txs as the consolidated scope.
- Per scope, build an `EntityForecast`:
  - **opening**: sum of `Account.balance` (× 100, rounded) over that scope's accounts. If ANY of that scope's accounts has `balance === null`, `openingCents = null` (position unknown — still project flows, but `projectedClosingCents`/band are null).
  - **streams** = `detectRecurringStreams(scopeTxs)`.
  - **incidental daily net**: `nonRecurring` = scope txs whose `key` is not a detected stream's key. `historyDays = max(1, daysBetween(minDate, maxDate))`. `incidentalPerDayCents = round(sum(nonRecurringCents) / historyDays)`.
  - **roll forward** day d from `asOf+1` to `asOf+horizonDays`: `balance += incidentalPerDayCents + Σ(stream.sign × stream.amountCents for streams whose next-due lands on d)`. A stream is "due" on day `d` iff `(d - stream.lastDate) % cadenceDays === 0` and `d > lastDate` (project future occurrences only). Record a weekly closing every 7 days.
  - If `openingCents === null`, `points[i].projectedClosingCents = null` (and band null) but still compute the flow internally so `drivers` are populated; `shortfall = null`.
  - **band (simple, honest)**: `spread(weekIndex) = round(bandK × incidentalStdPerWeekCents × sqrt(weekIndex))` where `incidentalStdPerWeekCents` = stddev of the scope's weekly incidental nets over history (fallback: 15% of |avg weekly flow|), `bandK` = 1.0. `lower = closing − spread`, `upper = closing + spread`. Band widens with horizon.
  - **shortfall**: first weekly point with `projectedClosingCents < bufferCents` (skip if opening null).
  - **drivers**: for each stream, `perWeekCents = round(sign × amountCents × 7 / cadenceDays)`; sort by `|perWeekCents|` desc; take top ~8.
- Return `{ byEntity, consolidated }`. Consolidated is a plain sum scope (its own detection + opening = sum of all account balances; null if any null) — matches the spec's "consolidated = plain sum, no netting".
- **Determinism**: no `Date.now`/random; integer cents throughout; stable ordering.

- [ ] **Step 1: Write failing tests** (append to `forecast.test.ts`)

```ts
import type { Account } from "./model.js";
import { forecastCashflow } from "./forecast.js";

test("roll-forward: monthly salary + monthly rent projects the balance and dates future occurrences from asOf", () => {
  const txs: Tx[] = [
    tx("1", "2026-04-25", 3000, "Werkgever"),
    tx("2", "2026-05-25", 3000, "Werkgever"),
    tx("3", "2026-06-25", 3000, "Werkgever"),
    tx("4", "2026-04-01", -1000, "Verhuurder"),
    tx("5", "2026-05-01", -1000, "Verhuurder"),
    tx("6", "2026-06-01", -1000, "Verhuurder"),
  ];
  const accounts: Account[] = [
    {
      key: "A1",
      iban: "A1",
      name: "ING",
      bank: "ING",
      entity: "BV1",
      currency: "EUR",
      balance: 5000,
    },
  ];
  const { byEntity, consolidated } = forecastCashflow(txs, accounts, {
    asOf: "2026-07-01",
    horizonDays: 91,
    bufferCents: 0,
  });

  const f = byEntity["BV1"];
  expect(f.openingCents).toBe(500000);
  expect(f.points).toHaveLength(13);
  // two recurring streams detected (salary in, rent out)
  expect(f.streams).toHaveLength(2);
  // net recurring ≈ +2000/month over 13 weeks -> ending balance clearly above opening; no shortfall
  expect(f.shortfall).toBeNull();
  expect(f.points[12].projectedClosingCents!).toBeGreaterThan(f.openingCents!);
  // consolidated mirrors the single entity here
  expect(consolidated.openingCents).toBe(500000);
});

test("shortfall: a large recurring outflow against a small opening flags the first breach date", () => {
  const txs: Tx[] = [
    tx("1", "2026-04-05", -2000, "Lening"),
    tx("2", "2026-05-05", -2000, "Lening"),
    tx("3", "2026-06-05", -2000, "Lening"),
  ];
  const accounts: Account[] = [
    { key: "A1", iban: "A1", name: "x", bank: "", entity: "BV1", currency: "EUR", balance: 1000 },
  ];
  const { byEntity } = forecastCashflow(txs, accounts, {
    asOf: "2026-07-01",
    horizonDays: 91,
    bufferCents: 0,
  });
  const f = byEntity["BV1"];
  expect(f.shortfall).not.toBeNull();
  expect(f.shortfall!.balanceCents).toBeLessThan(0);
  // first breach is the first projected -2000 after asOf (~2026-07-05 week)
  expect(f.shortfall!.date >= "2026-07-01").toBe(true);
});

test("null opening (CSV-only account) -> flow projected but closing/band null, no shortfall", () => {
  const txs: Tx[] = [
    tx("1", "2026-04-25", 3000, "W"),
    tx("2", "2026-05-25", 3000, "W"),
    tx("3", "2026-06-25", 3000, "W"),
  ];
  const accounts: Account[] = [
    { key: "A1", iban: "A1", name: "x", bank: "", entity: "BV1", currency: "EUR", balance: null },
  ];
  const { byEntity } = forecastCashflow(txs, accounts, { asOf: "2026-07-01" });
  const f = byEntity["BV1"];
  expect(f.openingCents).toBeNull();
  expect(f.points[0].projectedClosingCents).toBeNull();
  expect(f.shortfall).toBeNull();
  expect(f.streams.length).toBeGreaterThan(0); // still detects, for drivers
  expect(f.drivers.length).toBeGreaterThan(0);
});

test("deterministic: identical output on repeated runs", () => {
  const txs: Tx[] = [
    tx("1", "2026-04-25", 3000, "W"),
    tx("2", "2026-05-25", 3000, "W"),
    tx("3", "2026-06-25", 3000, "W"),
  ];
  const accounts: Account[] = [
    { key: "A1", iban: "A1", name: "x", bank: "", entity: "BV1", currency: "EUR", balance: 5000 },
  ];
  const a = forecastCashflow(txs, accounts, { asOf: "2026-07-01" });
  const b = forecastCashflow(txs, accounts, { asOf: "2026-07-01" });
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});
```

- [ ] **Step 2: Run to verify they fail** — `pnpm test`.
- [ ] **Step 3: Implement** `forecastCashflow` + the forecast types per the algorithm.
- [ ] **Step 4: Run tests + typecheck** — green. Correct any assertion that's wrong vs the true algorithm output (never loosen), noting it.
- [ ] **Step 5: Commit** — `feat(core): cashflow roll-forward, shortfall flag, band + forecast orchestrator`.

## Self-Review checklist

- `core` I/O-free, deterministic (no Date.now/random; integer cents; stable order). Detection: ≥3 occ, cadence snap, CV + amount gates. Roll-forward dates future occurrences from `asOf`, weekly closings, incidental baseline, widening band, first-breach shortfall. Null opening → flow-only (null closing), no crash. Consolidated = plain sum. No new deps; no ML/tax/harness. `tx.id`/parsers untouched.

## Notes

- The forecast VIEW (Overzicht integration, matching FinnTell's `app-forecast.png`: shortfall banner + 13-week median/band/buffer chart + drivers panel) is **Phase 2** (the dark-dashboard UI plan).
- Thresholds (minOccurrences, cadence bands, CV, amount tolerance, bufferCents, bandK) are options/consts, tunable on real data (spec risk R1).

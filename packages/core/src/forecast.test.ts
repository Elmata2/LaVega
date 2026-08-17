import { expect, test } from "vitest";
import type { Account, Tx } from "./model.js";
import { detectRecurringStreams, forecastCashflow, streamOccurrences } from "./forecast.js";
import { makeScheduledFlow } from "./scheduledFlows.js";

function tx(id: string, date: string, amount: number, cp: string): Tx {
  return { id, accountKey: "A1", date, amount, currency: "EUR", counterparty: cp, description: "", category: "", manual: false };
}

test("amountCents stays an integer for an even occurrence count (median of two middles is rounded)", () => {
  const txs: Tx[] = [
    tx("1", "2026-03-25", -100.0, "Saas"), tx("2", "2026-04-25", -100.0, "Saas"),
    tx("3", "2026-05-25", -100.01, "Saas"), tx("4", "2026-06-25", -100.02, "Saas"),
  ];
  const streams = detectRecurringStreams(txs);
  expect(streams).toHaveLength(1);
  // cents [10000,10000,10001,10002] -> median (10000+10001)/2 = 10000.5 -> round 10001
  expect(streams[0].amountCents).toBe(10001);
  expect(Number.isInteger(streams[0].amountCents)).toBe(true);
});

test("interval CV uses SAMPLE stddev: a jittery ~monthly stream (gaps 22 & 40) is rejected as too irregular", () => {
  // median gap 31 snaps to the 30-day band; amounts stable -> only the CV gate can reject.
  // sample CV = 12.73/31 ≈ 0.41 > 0.35 -> rejected (population CV would be 0.29 -> accepted).
  const txs: Tx[] = [
    tx("1", "2026-06-01", -100, "Jitter"),
    tx("2", "2026-06-23", -100, "Jitter"), // +22 days
    tx("3", "2026-08-02", -100, "Jitter"), // +40 days
  ];
  expect(detectRecurringStreams(txs)).toHaveLength(0);
});

test("detects a monthly salary inflow (3 occurrences, ~30d cadence, stable amount)", () => {
  const txs: Tx[] = [
    tx("1", "2026-04-25", 2500, "Werkgever BV"),
    tx("2", "2026-05-25", 2500, "Werkgever BV"),
    tx("3", "2026-06-25", 2500, "Werkgever BV"),
  ];
  const streams = detectRecurringStreams(txs);
  expect(streams).toHaveLength(1);
  expect(streams[0]).toMatchObject({ sign: 1, cadenceDays: 30, amountCents: 250000, occurrences: 3, lastDate: "2026-06-25" });
});

test("detects a weekly outflow and separates it from an inflow of the same counterparty (sign in the key)", () => {
  const txs: Tx[] = [
    tx("1", "2026-06-01", -50, "Spar"), tx("2", "2026-06-08", -50, "Spar"), tx("3", "2026-06-15", -50, "Spar"),
    tx("4", "2026-06-02", 200, "Spar"), tx("5", "2026-06-09", 200, "Spar"), tx("6", "2026-06-16", 200, "Spar"),
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
  const irregular: Tx[] = [tx("1", "2026-06-01", -30, "X"), tx("2", "2026-06-03", -30, "X"), tx("3", "2026-06-20", -30, "X")];
  expect(detectRecurringStreams(irregular)).toHaveLength(0);
  const variable: Tx[] = [tx("1", "2026-04-01", -10, "Y"), tx("2", "2026-05-01", -500, "Y"), tx("3", "2026-06-01", -10, "Y")];
  expect(detectRecurringStreams(variable)).toHaveLength(0);
});

test("roll-forward: monthly salary + rent projects the balance, no shortfall, ends above opening", () => {
  const txs: Tx[] = [
    tx("1", "2026-04-25", 3000, "Werkgever"), tx("2", "2026-05-25", 3000, "Werkgever"), tx("3", "2026-06-25", 3000, "Werkgever"),
    tx("4", "2026-04-01", -1000, "Verhuurder"), tx("5", "2026-05-01", -1000, "Verhuurder"), tx("6", "2026-06-01", -1000, "Verhuurder"),
  ];
  const accounts: Account[] = [{ key: "A1", iban: "A1", name: "ING", bank: "ING", entity: "BV1", currency: "EUR", balance: 5000 }];
  const { byEntity, consolidated } = forecastCashflow(txs, accounts, { asOf: "2026-07-01", horizonDays: 91, bufferCents: 0 });
  const f = byEntity["BV1"];
  expect(f.openingCents).toBe(500000);
  expect(f.points).toHaveLength(13);
  expect(f.streams).toHaveLength(2);
  expect(f.shortfall).toBeNull();
  expect(f.points[12].projectedClosingCents!).toBeGreaterThan(f.openingCents!);
  expect(consolidated.openingCents).toBe(500000);
});

test("shortfall: a large recurring outflow against a small opening flags a breach date", () => {
  const txs: Tx[] = [tx("1", "2026-04-05", -2000, "Lening"), tx("2", "2026-05-05", -2000, "Lening"), tx("3", "2026-06-05", -2000, "Lening")];
  const accounts: Account[] = [{ key: "A1", iban: "A1", name: "x", bank: "", entity: "BV1", currency: "EUR", balance: 1000 }];
  const { byEntity } = forecastCashflow(txs, accounts, { asOf: "2026-07-01", horizonDays: 91, bufferCents: 0 });
  const f = byEntity["BV1"];
  expect(f.shortfall).not.toBeNull();
  expect(f.shortfall!.balanceCents).toBeLessThan(0);
  expect(f.shortfall!.date >= "2026-07-01").toBe(true);
});

test("null opening (CSV-only) -> flow projected internally but closing/band null, no shortfall, drivers present", () => {
  const txs: Tx[] = [tx("1", "2026-04-25", 3000, "W"), tx("2", "2026-05-25", 3000, "W"), tx("3", "2026-06-25", 3000, "W")];
  const accounts: Account[] = [{ key: "A1", iban: "A1", name: "x", bank: "", entity: "BV1", currency: "EUR", balance: null }];
  const { byEntity } = forecastCashflow(txs, accounts, { asOf: "2026-07-01" });
  const f = byEntity["BV1"];
  expect(f.openingCents).toBeNull();
  expect(f.points[0].projectedClosingCents).toBeNull();
  expect(f.shortfall).toBeNull();
  expect(f.streams.length).toBeGreaterThan(0);
  expect(f.drivers.length).toBeGreaterThan(0);
});

test("thin history: a big non-recurring one-off does NOT dominate (incidental baseline needs >= 60 days)", () => {
  // ~20 days of history + a -10000 one-off. Un-guarded, -10000/20 ≈ -500/day over
  // 91 days ≈ -45k would fabricate a shortfall. Guarded -> incidental 0, flat.
  const txs: Tx[] = [
    tx("1", "2026-06-10", -10000, "Equipment"),
    tx("2", "2026-06-20", -50, "Coffee"),
    tx("3", "2026-06-30", -50, "Coffee"),
  ];
  const accounts: Account[] = [{ key: "A1", iban: "A1", name: "x", bank: "", entity: "BV1", currency: "EUR", balance: 5000 }];
  const { byEntity } = forecastCashflow(txs, accounts, { asOf: "2026-07-01", horizonDays: 91, bufferCents: 0 });
  const f = byEntity["BV1"];
  expect(f.streams).toHaveLength(0);            // nothing recurs (Coffee 2x, Equipment 1x)
  expect(f.points[12].projectedClosingCents).toBe(500000); // opening, flat — no incidental drift
  expect(f.shortfall).toBeNull();
});

test("sufficient history: the incidental (non-recurring) baseline drifts the projection", () => {
  // 90-day window, two distinct one-offs (neither recurs) -> a real daily drift.
  const txs: Tx[] = [
    tx("1", "2026-04-01", -910, "Diversen"),
    tx("2", "2026-06-30", -910, "Anders"),
  ];
  const accounts: Account[] = [{ key: "A1", iban: "A1", name: "x", bank: "", entity: "BV1", currency: "EUR", balance: 5000 }];
  const { byEntity } = forecastCashflow(txs, accounts, { asOf: "2026-07-01", horizonDays: 91 });
  const f = byEntity["BV1"];
  expect(f.streams).toHaveLength(0);
  // history 90d, nonRecurring sum -182000c, per day round(-182000/90) = -2022 -> well below opening
  expect(f.points[12].projectedClosingCents!).toBeLessThan(500000);
});

test("orphan txs (accountKey with no account) -> 'onbekend' scope has null opening, no spurious shortfall", () => {
  // The tx's accountKey "GHOST" matches no account, so it lands in the "onbekend"
  // entity scope, which has ZERO accounts -> opening must be unknown, not €0.
  const txs: Tx[] = [
    { id: "1", accountKey: "GHOST", date: "2026-04-05", amount: -2000, currency: "EUR", counterparty: "Lening", description: "", category: "", manual: false },
    { id: "2", accountKey: "GHOST", date: "2026-05-05", amount: -2000, currency: "EUR", counterparty: "Lening", description: "", category: "", manual: false },
    { id: "3", accountKey: "GHOST", date: "2026-06-05", amount: -2000, currency: "EUR", counterparty: "Lening", description: "", category: "", manual: false },
  ];
  const accounts: Account[] = []; // no accounts at all
  const { byEntity } = forecastCashflow(txs, accounts, { asOf: "2026-07-01" });
  const f = byEntity["onbekend"];
  expect(f.openingCents).toBeNull();
  expect(f.shortfall).toBeNull(); // would have been a spurious breach if opening defaulted to 0
});

test("deterministic: identical JSON on repeated runs", () => {
  const txs: Tx[] = [tx("1", "2026-04-25", 3000, "W"), tx("2", "2026-05-25", 3000, "W"), tx("3", "2026-06-25", 3000, "W")];
  const accounts: Account[] = [{ key: "A1", iban: "A1", name: "x", bank: "", entity: "BV1", currency: "EUR", balance: 5000 }];
  const a = forecastCashflow(txs, accounts, { asOf: "2026-07-01" });
  const b = forecastCashflow(txs, accounts, { asOf: "2026-07-01" });
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});

test("forecast: a scheduled outflow on its due date lowers the projected closing", () => {
  const accounts = [{ key: "A", iban: "A", name: "A", bank: "ING", entity: "BV1", currency: "EUR", balance: 1000 }];
  const flow = makeScheduledFlow({ entity: "BV1", label: "BTW", sign: -1, amountCents: 30000, dueDate: "2026-08-15", source: "vat", status: "confirmed" });
  const withFlow = forecastCashflow([], accounts, { asOf: "2026-08-01", scheduledFlows: [flow] }).consolidated;
  const without = forecastCashflow([], accounts, { asOf: "2026-08-01" }).consolidated;
  // €300 lower from the due date onward (week 3 point = day 21, after 08-15)
  const wk3With = withFlow.points.find((p) => p.date >= "2026-08-15")!;
  const wk3Without = without.points.find((p) => p.date >= "2026-08-15")!;
  expect((wk3Without.projectedClosingCents ?? 0) - (wk3With.projectedClosingCents ?? 0)).toBe(30000);
});

test("forecast: no scheduledFlows => identical to before (additive)", () => {
  const accounts = [{ key: "A", iban: "A", name: "A", bank: "ING", entity: "BV1", currency: "EUR", balance: 500 }];
  const a = forecastCashflow([], accounts, { asOf: "2026-08-01" }).consolidated;
  const b = forecastCashflow([], accounts, { asOf: "2026-08-01", scheduledFlows: [] }).consolidated;
  expect(a.points).toEqual(b.points);
});

/* ── The projection's calendar ────────────────────────────────────────────────
 * A "monthly" stream is a day of the month, not 30 days. The shortfall date is
 * the number the owner checks against his own bank statement, so the projected
 * dates have to be the real ones. */

test("monthly cadence steps by CALENDAR month, not 30 days — no drift over a quarter", () => {
  const txs: Tx[] = [
    tx("1", "2026-03-25", 3000, "Werkgever"),
    tx("2", "2026-04-25", 3000, "Werkgever"),
    tx("3", "2026-05-25", 3000, "Werkgever"),
  ];
  const [s] = detectRecurringStreams(txs);
  // The old modulo-30 walk gave 06-24, 07-24, 08-23 — three days early by August.
  expect(streamOccurrences(s, "2026-06-01", "2026-08-31")).toEqual(["2026-06-25", "2026-07-25", "2026-08-25"]);
});

test("a month-end stream clamps to short months and RETURNS to the 31st", () => {
  const txs: Tx[] = [
    tx("1", "2025-12-31", -1000, "Verhuurder"),
    tx("2", "2026-01-31", -1000, "Verhuurder"),
    tx("3", "2026-02-28", -1000, "Verhuurder"),
  ];
  const [s] = detectRecurringStreams(txs);
  // Anchored on the last occurrence (28 Feb), so 28th onwards — but the anchor
  // arithmetic is what matters: stepping from a clamped result would strand the
  // series on the shortest month it ever met.
  expect(streamOccurrences(s, "2026-03-01", "2026-05-31")).toEqual(["2026-03-28", "2026-04-28", "2026-05-28"]);
  const jan31 = { ...s, lastDate: "2026-01-31" };
  expect(streamOccurrences(jan31, "2026-02-01", "2026-05-31")).toEqual(["2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"]);
});

/* ── Streams that stopped ─────────────────────────────────────────────────── */

test("a stream silent for more than two missed cycles is not projected, and is NAMED as ended", () => {
  const txs: Tx[] = [
    tx("1", "2025-12-15", -50, "Streamingdienst"),
    tx("2", "2026-01-15", -50, "Streamingdienst"),
    tx("3", "2026-02-15", -50, "Streamingdienst"),
  ];
  const accounts: Account[] = [{ key: "A1", iban: "A1", name: "x", bank: "", entity: "BV1", currency: "EUR", balance: 5000 }];
  const f = forecastCashflow(txs, accounts, { asOf: "2026-07-01", horizonDays: 91 }).byEntity["BV1"];
  // Still DETECTED (alerts.ts reasons over forecast.streams), but not projected.
  expect(f.streams).toHaveLength(1);
  expect(f.basis!.liveStreamCount).toBe(0);
  expect(f.basis!.endedStreams.map((s) => s.counterparty)).toEqual(["Streamingdienst"]);
  expect(f.drivers).toHaveLength(0);
  expect(f.points[12].projectedClosingCents).toBe(500000); // a cancelled subscription is not still being paid
});

test("a stream inside the two-missed-cycle window is still projected", () => {
  const txs: Tx[] = [
    tx("1", "2026-04-15", -50, "Streamingdienst"),
    tx("2", "2026-05-15", -50, "Streamingdienst"),
    tx("3", "2026-06-15", -50, "Streamingdienst"),
  ];
  const accounts: Account[] = [{ key: "A1", iban: "A1", name: "x", bank: "", entity: "BV1", currency: "EUR", balance: 5000 }];
  const f = forecastCashflow(txs, accounts, { asOf: "2026-07-01", horizonDays: 91 }).byEntity["BV1"];
  expect(f.basis!.liveStreamCount).toBe(1);
  expect(f.basis!.endedStreams).toHaveLength(0);
  expect(f.points[12].projectedClosingCents).toBeLessThan(500000);
});

test("a recently missed payment is rolled forward, not silently dropped", () => {
  const txs: Tx[] = [
    tx("1", "2026-04-01", -1200, "Verhuurder"),
    tx("2", "2026-05-01", -1200, "Verhuurder"),
    tx("3", "2026-06-01", -1200, "Verhuurder"),
  ];
  const [s] = detectRecurringStreams(txs);
  // 9 days past the 1 July due date (grace is 6 for a monthly stream): the rent
  // is late, not cancelled — it still has to leave the account.
  expect(streamOccurrences(s, "2026-07-10", "2026-10-09")).toEqual(["2026-07-11", "2026-08-01", "2026-09-01", "2026-10-01"]);
  // One day past due is inside the grace window — no catch-up invented.
  expect(streamOccurrences(s, "2026-07-02", "2026-10-01")).toEqual(["2026-08-01", "2026-09-01", "2026-10-01"]);
});

/* ── The band ─────────────────────────────────────────────────────────────── */

test("no measurable variability -> NO band at all (null), never a confident tight one", () => {
  const txs: Tx[] = [
    tx("1", "2026-06-10", -10000, "Equipment"),
    tx("2", "2026-06-20", -50, "Coffee"),
    tx("3", "2026-06-30", -50, "Coffee"),
  ];
  const accounts: Account[] = [{ key: "A1", iban: "A1", name: "x", bank: "", entity: "BV1", currency: "EUR", balance: 5000 }];
  const f = forecastCashflow(txs, accounts, { asOf: "2026-07-01", horizonDays: 91 }).byEntity["BV1"];
  expect(f.basis!.bandBasis).toBe("none");
  expect(f.points[0].lowerCents).toBeNull();
  expect(f.points[0].upperCents).toBeNull();
  expect(f.points[12].projectedClosingCents).toBe(500000); // the line itself is still drawn
});

test("the band widens by the streams' OWN measured amount spread, one occurrence at a time", () => {
  // |amounts| 2500 / 2600 / 2400 -> sample std exactly €100 = 10_000 cents.
  const txs: Tx[] = [
    tx("1", "2026-04-25", 2500, "Werkgever"),
    tx("2", "2026-05-25", 2600, "Werkgever"),
    tx("3", "2026-06-25", 2400, "Werkgever"),
  ];
  const accounts: Account[] = [{ key: "A1", iban: "A1", name: "x", bank: "", entity: "BV1", currency: "EUR", balance: 10000 }];
  const f = forecastCashflow(txs, accounts, { asOf: "2026-07-01", horizonDays: 91 }).byEntity["BV1"];
  const wk = (n: number) => f.points[n - 1];
  // Week 1: nothing has been paid yet, so nothing is uncertain yet.
  expect(wk(1).upperCents! - wk(1).lowerCents!).toBe(0);
  // Week 4 is past the 25 July salary: one occurrence of variance -> ±€100.
  expect(wk(4).upperCents! - wk(4).lowerCents!).toBe(20000);
  // Week 13 is past three: variance adds, so the half-width is sqrt(3)*€100.
  expect(wk(13).upperCents! - wk(13).lowerCents!).toBe(2 * Math.round(Math.sqrt(3 * 1e8)));
});

test("quiet weeks count as real zeros: two identical burst weeks are not a steady scope", () => {
  // Old behaviour bucketed only the weeks that HAD a transaction, so this
  // sample was [-300, -300] -> std 0 -> a band of zero width over a scope that
  // is anything but steady. Counting every whole observed week fixes it.
  const txs: Tx[] = [
    tx("1", "2026-01-01", -1000, "Verhuurder"), tx("2", "2026-02-01", -1000, "Verhuurder"),
    tx("3", "2026-03-01", -1000, "Verhuurder"), tx("4", "2026-04-01", -1000, "Verhuurder"),
    tx("5", "2026-02-10", -300, "Winkel A"),
    tx("6", "2026-03-10", -300, "Winkel B"),
  ];
  const accounts: Account[] = [{ key: "A1", iban: "A1", name: "x", bank: "", entity: "BV1", currency: "EUR", balance: 20000 }];
  const f = forecastCashflow(txs, accounts, { asOf: "2026-04-15", horizonDays: 91 }).byEntity["BV1"];
  expect(f.basis!.bandBasis).toBe("both");
  expect(f.basis!.fullWeeks).toBeGreaterThanOrEqual(8);
  expect(f.points[0].upperCents! - f.points[0].lowerCents!).toBeGreaterThan(0);
});

/* ── What is NOT spending ─────────────────────────────────────────────────── */

test("a one-off sweep to the owner's OWN savings account is not projected as a spending baseline", () => {
  const accounts: Account[] = [
    { key: "NL01BANK0000000001", iban: "NL01BANK0000000001", name: "Betaal", bank: "ING", entity: "BV1", currency: "EUR", balance: 10000 },
    { key: "NL02BANK0000000002", iban: "NL02BANK0000000002", name: "Spaar", bank: "ING", entity: "BV1", currency: "EUR", balance: 50000 },
  ];
  const t = (id: string, date: string, amount: number, cp: string): Tx =>
    ({ id, accountKey: "NL01BANK0000000001", date, amount, currency: "EUR", counterparty: cp, description: "", category: "", manual: false });
  const txs: Tx[] = [
    t("1", "2026-03-01", -1, "Koffie"),
    t("2", "2026-05-01", -500, "NL02BANK0000000002"), // the sweep — his own money, still his
    t("3", "2026-05-30", -1, "Boek"),
  ];
  const f = forecastCashflow(txs, accounts, { asOf: "2026-06-01", horizonDays: 91 }).byEntity["BV1"];
  // Only the €2 of real incidental spend feeds the baseline: -200c over 90 days.
  expect(f.basis!.incidentalIncluded).toBe(true);
  expect(f.basis!.incidentalPerWeekCents).toBe(-14);
  expect(f.points[12].projectedClosingCents).toBe(6_000_000 + 91 * -2);
  // Un-excluded this was -50_200c/90d ≈ -€5.58/day, ≈ -€508 of invented "spend".
});

/* ── Coverage honesty ─────────────────────────────────────────────────────── */

test("basis reports the SHORTEST account's history — three weeks of one card caps confidence at low", () => {
  const accounts: Account[] = [
    { key: "A", iban: "A", name: "Betaal", bank: "ING", entity: "BV1", currency: "EUR", balance: 1000 },
    { key: "B", iban: "B", name: "Card", bank: "Amex", entity: "BV1", currency: "EUR", balance: 500 },
  ];
  const on = (id: string, key: string, date: string, cp: string): Tx =>
    ({ id, accountKey: key, date, amount: -25, currency: "EUR", counterparty: cp, description: "", category: "", manual: false });
  const txs: Tx[] = [
    on("1", "A", "2026-01-01", "Koffie"), on("2", "A", "2026-07-19", "Boek"),
    on("3", "B", "2026-07-01", "Tanken"), on("4", "B", "2026-07-22", "Lunch"),
  ];
  const f = forecastCashflow(txs, accounts, { asOf: "2026-07-25", horizonDays: 91 }).byEntity["BV1"];
  expect(f.basis!.historyDays).toBe(202);
  expect(f.basis!.accountsTotal).toBe(2);
  expect(f.basis!.accountsWithHistory).toBe(2);
  expect(f.basis!.shortestAccountDays).toBe(21);
  // 202 days would otherwise read "high"; one card with three weeks caps it.
  expect(f.basis!.confidence).toBe("low");
});

test("an account whose balance counts but whose transactions were never imported caps confidence at low", () => {
  const accounts: Account[] = [
    { key: "A", iban: "A", name: "Betaal", bank: "ING", entity: "BV1", currency: "EUR", balance: 1000 },
    { key: "B", iban: "B", name: "Zakelijk", bank: "Knab", entity: "BV1", currency: "EUR", balance: 9000 },
  ];
  const on = (id: string, date: string, cp: string): Tx =>
    ({ id, accountKey: "A", date, amount: -25, currency: "EUR", counterparty: cp, description: "", category: "", manual: false });
  const txs: Tx[] = [on("1", "2026-01-01", "Koffie"), on("2", "2026-07-19", "Boek")];
  const f = forecastCashflow(txs, accounts, { asOf: "2026-07-25", horizonDays: 91 }).byEntity["BV1"];
  expect(f.basis!.accountsTotal).toBe(2);
  expect(f.basis!.accountsWithHistory).toBe(1); // B's future flows are invisible
  expect(f.basis!.confidence).toBe("low");
});

test("nothing to project from -> confidence 'none': a flat line at today's balance is not a forecast", () => {
  const accounts: Account[] = [{ key: "A1", iban: "A1", name: "x", bank: "", entity: "BV1", currency: "EUR", balance: 5000 }];
  const f = forecastCashflow([], accounts, { asOf: "2026-07-01", horizonDays: 91 }).byEntity["BV1"];
  expect(f.basis!.confidence).toBe("none");
  expect(f.basis!.liveStreamCount).toBe(0);
  expect(f.basis!.incidentalIncluded).toBe(false);
  expect(f.basis!.bandBasis).toBe("none");
  expect(f.shortfall).toBeNull();
});

test("history long enough and even across accounts -> medium, then high", () => {
  const accounts: Account[] = [{ key: "A1", iban: "A1", name: "x", bank: "", entity: "BV1", currency: "EUR", balance: 5000 }];
  const medium = forecastCashflow(
    [tx("1", "2026-04-01", -25, "Koffie"), tx("2", "2026-06-30", -25, "Boek")],
    accounts, { asOf: "2026-07-01" },
  ).byEntity["BV1"];
  expect(medium.basis!.confidence).toBe("medium"); // 90 days

  const high = forecastCashflow(
    [tx("1", "2025-10-01", -25, "Koffie"), tx("2", "2026-06-30", -25, "Boek")],
    accounts, { asOf: "2026-07-01" },
  ).byEntity["BV1"];
  expect(high.basis!.confidence).toBe("high"); // 272 days
});

/* ── Scheduled flows ──────────────────────────────────────────────────────── */

test("an overdue, still-unpaid scheduled flow is reported — not silently dropped from the projection", () => {
  const accounts: Account[] = [{ key: "A", iban: "A", name: "A", bank: "ING", entity: "BV1", currency: "EUR", balance: 1000 }];
  const overdue = makeScheduledFlow({ entity: "BV1", label: "BTW Q2", sign: -1, amountCents: 30000, dueDate: "2026-07-20", source: "vat", status: "confirmed" });
  const f = forecastCashflow([], accounts, { asOf: "2026-08-01", scheduledFlows: [overdue] }).consolidated;
  // Not in the line: from here we cannot know whether he paid it outside LaVega.
  expect(f.points[12].projectedClosingCents).toBe(100000);
  // But it is on the record, with its amount, so the view can say so.
  expect(f.basis!.overdueFlowCount).toBe(1);
  expect(f.basis!.overdueFlowsCents).toBe(-30000);
  expect(f.basis!.projectedFlowCount).toBe(0);
});

test("a future scheduled flow counts as evidence and is projected", () => {
  const accounts: Account[] = [{ key: "A", iban: "A", name: "A", bank: "ING", entity: "BV1", currency: "EUR", balance: 1000 }];
  const flow = makeScheduledFlow({ entity: "BV1", label: "BTW Q3", sign: -1, amountCents: 30000, dueDate: "2026-08-15", source: "vat", status: "confirmed" });
  const f = forecastCashflow([], accounts, { asOf: "2026-08-01", scheduledFlows: [flow] }).consolidated;
  expect(f.basis!.projectedFlowCount).toBe(1);
  expect(f.basis!.overdueFlowCount).toBe(0);
  expect(f.basis!.confidence).toBe("low"); // a known bill is evidence, but thin
});

/* ── Risk that the median line hides ──────────────────────────────────────── */

test("atRisk: the band reaches below the buffer while the expected line still clears it", () => {
  // |amounts| 2000 / 2100 / 1900 -> sample std €100; three occurrences inside
  // the horizon -> half-width sqrt(3)*€100 ≈ €173 at week 11.
  const txs: Tx[] = [
    tx("1", "2026-04-10", -2000, "Aannemer"),
    tx("2", "2026-05-10", -2100, "Aannemer"),
    tx("3", "2026-06-10", -1900, "Aannemer"),
  ];
  const accounts: Account[] = [{ key: "A1", iban: "A1", name: "x", bank: "", entity: "BV1", currency: "EUR", balance: 6200 }];
  const f = forecastCashflow(txs, accounts, { asOf: "2026-07-01", horizonDays: 91, bufferCents: 15000 }).byEntity["BV1"];
  expect(f.shortfall).toBeNull();               // the expected line ends at €200, above the €150 buffer
  expect(f.atRisk).not.toBeNull();
  expect(f.atRisk!.date).toBe("2026-09-16");
  expect(f.atRisk!.balanceCents).toBeLessThan(15000);
});

test("atRisk is cleared when there is a real shortfall — the louder statement wins", () => {
  const txs: Tx[] = [
    tx("1", "2026-04-05", -2000, "Lening"), tx("2", "2026-05-05", -2000, "Lening"), tx("3", "2026-06-05", -2000, "Lening"),
  ];
  const accounts: Account[] = [{ key: "A1", iban: "A1", name: "x", bank: "", entity: "BV1", currency: "EUR", balance: 1000 }];
  const f = forecastCashflow(txs, accounts, { asOf: "2026-07-01", horizonDays: 91, bufferCents: 0 }).byEntity["BV1"];
  expect(f.shortfall).not.toBeNull();
  expect(f.atRisk).toBeNull();
});

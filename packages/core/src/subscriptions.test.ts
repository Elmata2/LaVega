import { expect, test } from "vitest";
import type { Tx } from "./model.js";
import { detectSubscriptions, subscriptionPriceIncreases, subscriptionOverlaps, subscriptionFunction, subscriptionCoverage, minHistoryDaysFor, CADENCE_LABEL_NL } from "./subscriptions.js";

let n = 0;
const tx = (cp: string, date: string, amount: number): Tx =>
  ({ id: String(n++), accountKey: "A1", date, amount, currency: "EUR", counterparty: cp, description: "", category: "", manual: false });

// Netflix monthly, price rose 13,99 -> 15,99
const netflix = [
  tx("Netflix", "2026-01-15", -13.99), tx("Netflix", "2026-02-15", -13.99), tx("Netflix", "2026-03-15", -13.99),
  tx("Netflix", "2026-04-15", -15.99), tx("Netflix", "2026-05-15", -15.99),
];
const hbo = ["2026-01-10", "2026-02-10", "2026-03-10", "2026-04-10", "2026-05-10"].map((d) => tx("HBO Max", d, -8.99));
const spotify = ["2026-01-05", "2026-02-05", "2026-03-05", "2026-04-05"].map((d) => tx("Spotify AB", d, -10.99));
const adobe = [tx("Adobe Systems", "2025-03-01", -120), tx("Adobe Systems", "2026-03-01", -120)]; // yearly
const oneoff = [tx("Random Store", "2026-01-01", -50), tx("Andere Winkel", "2026-02-02", -20)];

test("detectSubscriptions finds monthly + yearly, normalizes to monthly, tags function", () => {
  const subs = detectSubscriptions([...netflix, ...hbo, ...spotify, ...adobe, ...oneoff]);
  const byName = Object.fromEntries(subs.map((s) => [s.name, s]));
  expect(byName["Netflix"]).toMatchObject({ cadenceDays: 30, monthlyCents: 1599, function: "Videostreaming" });
  expect(byName["Netflix"].changePct).toBeCloseTo(0.143, 2);
  expect(byName["HBO Max"]).toMatchObject({ function: "Videostreaming", monthlyCents: 899 });
  expect(byName["Spotify AB"].function).toBe("Muziekstreaming");
  expect(byName["Adobe Systems"]).toMatchObject({ cadenceDays: 365, function: "Software", monthlyCents: 986 });
  expect(subs.find((s) => s.name === "Random Store")).toBeUndefined(); // not recurring
});

test("subscriptionPriceIncreases flags Netflix's rise, not the flat ones", () => {
  const inc = subscriptionPriceIncreases(detectSubscriptions([...netflix, ...hbo]));
  expect(inc).toHaveLength(1);
  expect(inc[0]).toMatchObject({ fromCents: 1399, toCents: 1599 });
});

test("subscriptionOverlaps flags two videostreaming services, not a lone music one", () => {
  const ov = subscriptionOverlaps(detectSubscriptions([...netflix, ...hbo, ...spotify]));
  expect(ov).toHaveLength(1);
  expect(ov[0].function).toBe("Videostreaming");
  expect(ov[0].subs.map((s) => s.name).sort()).toEqual(["HBO Max", "Netflix"]);
  expect(ov[0].monthlyCents).toBe(1599 + 899);
});

test("subscriptionFunction maps known merchants; unknown -> Overig", () => {
  expect(subscriptionFunction("NETFLIX.COM")).toBe("Videostreaming");
  expect(subscriptionFunction("Vodafone Libertel")).toBe("Mobiel abonnement");
  expect(subscriptionFunction("Onbekende Dienst")).toBe("Overig");
});

test("excludes peer transfers and unstable 2-occurrence streams", () => {
  const transfer = ["2026-01-15", "2026-02-15", "2026-03-15"].map((d) => tx("Overschrijving naar Jan Jansen", d, -100));
  const ibanCp = ["2026-01-15", "2026-02-15", "2026-03-15"].map((d) => tx("NL17INGB0539576085", d, -50));
  const unstable = [tx("Iets Vaags", "2025-03-01", -100), tx("Iets Vaags", "2026-03-01", -40)]; // -60% over a year
  const subs = detectSubscriptions([...transfer, ...ibanCp, ...unstable]);
  expect(subs).toHaveLength(0);
});

/* ── Cadence coverage (UI review round 2, 2026-08-17) ─────────────────────
 *
 * Before this round the bands were monthly (26–36d, 3 occ), quarterly (84–98d,
 * 2 occ) and yearly (350–380d, 2 occ). Quarterly was therefore already visible
 * — the suspected "one-month window" does not exist anywhere in this file — but
 * 37–83 days and 99–349 days matched NO band, so a two-monthly or half-yearly
 * charge could never be seen at all. These tests pin the widened table. */

test("a quarterly subscription is detected from two occurrences", () => {
  const simeo = ["2026-04-05", "2026-07-05"].map((d) => tx("Simeo", d, -74.85));
  const [sub] = detectSubscriptions(simeo);
  expect(sub).toMatchObject({ cadenceDays: 91, occurrences: 2, lastAmountCents: 7485 });
  expect(sub.monthlyCents).toBe(Math.round((7485 * 30) / 91));
});

test("quarterly billing that drifts a few days off 91 still lands in the band", () => {
  // Direct debits shifted to business days: 87 and 95 days apart.
  const drifting = ["2026-01-05", "2026-04-02", "2026-07-06"].map((d) => tx("Simeo", d, -74.85));
  expect(detectSubscriptions(drifting)[0]).toMatchObject({ cadenceDays: 91, occurrences: 3 });
});

test("half-yearly and two-monthly charges are now visible at all", () => {
  const halfYearly = ["2026-01-05", "2026-07-06"].map((d) => tx("Verzekeraar Halfjaar", d, -149.7));
  const twoMonthly = ["2026-03-05", "2026-05-05", "2026-07-05"].map((d) => tx("Tweemaandelijks BV", d, -49.9));
  const subs = detectSubscriptions([...halfYearly, ...twoMonthly]);
  const byName = Object.fromEntries(subs.map((s) => [s.name, s]));
  expect(byName["Verzekeraar Halfjaar"]).toMatchObject({ cadenceDays: 182, occurrences: 2 });
  expect(byName["Verzekeraar Halfjaar"].monthlyCents).toBe(Math.round((14970 * 30) / 182));
  expect(byName["Tweemaandelijks BV"]).toMatchObject({ cadenceDays: 61, occurrences: 3 });
});

test("two-monthly needs three occurrences — two purchases 60 days apart are not a subscription", () => {
  const twice = ["2026-05-05", "2026-07-05"].map((d) => tx("Dezelfde Winkel", d, -49.9));
  expect(detectSubscriptions(twice)).toHaveLength(0);
});

test("minHistoryDaysFor states what each cadence needs before it can be seen", () => {
  expect(minHistoryDaysFor(30)).toBe(60); // three monthly charges = two gaps
  expect(minHistoryDaysFor(61)).toBe(122);
  expect(minHistoryDaysFor(91)).toBe(91); // one quarterly gap
  expect(minHistoryDaysFor(182)).toBe(182);
  expect(minHistoryDaysFor(365)).toBe(365);
  expect(minHistoryDaysFor(7)).toBe(0); // not a cadence we detect
});

test("subscriptionCoverage says which cadences the history can and cannot show", () => {
  // One month of statements: nothing can be recognised yet, and the empty list
  // is explained rather than left as a shrug.
  const oneMonth = ["2026-07-02", "2026-07-20", "2026-07-31"].map((d) => tx("Winkel", d, -20));
  const short = subscriptionCoverage(oneMonth);
  expect(short).toMatchObject({ firstDate: "2026-07-02", lastDate: "2026-07-31", historyDays: 30 });
  expect(short.visibleCadences).toEqual([]);
  expect(short.hiddenCadences).toEqual([
    { cadenceDays: 30, needsDays: 60 },
    { cadenceDays: 61, needsDays: 122 },
    { cadenceDays: 91, needsDays: 91 },
    { cadenceDays: 182, needsDays: 182 },
    { cadenceDays: 365, needsDays: 365 },
  ]);

  // Six months: monthly and quarterly become possible, half-yearly and yearly
  // still cannot be claimed.
  const sixMonths = ["2026-02-01", "2026-07-31"].map((d) => tx("Winkel", d, -20));
  const half = subscriptionCoverage(sixMonths);
  expect(half.historyDays).toBe(181);
  expect(half.visibleCadences).toEqual([30, 61, 91]);
  expect(half.hiddenCadences.map((h) => h.cadenceDays)).toEqual([182, 365]);
});

test("subscriptionCoverage ignores inflows and reports zero history when there are no outflows", () => {
  const inflowsOnly = [tx("Salaris", "2026-01-01", 3000), tx("Salaris", "2026-07-01", 3000)];
  expect(subscriptionCoverage(inflowsOnly)).toMatchObject({ firstDate: "", lastDate: "", historyDays: 0, visibleCadences: [] });
});

test("CADENCE_LABEL_NL names every cadence the detector can return", () => {
  for (const days of [30, 61, 91, 182, 365]) expect(CADENCE_LABEL_NL[days]).toBeTruthy();
});

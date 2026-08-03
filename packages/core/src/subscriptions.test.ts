import { expect, test } from "vitest";
import type { Tx } from "./model.js";
import { detectSubscriptions, subscriptionPriceIncreases, subscriptionOverlaps, subscriptionFunction } from "./subscriptions.js";

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

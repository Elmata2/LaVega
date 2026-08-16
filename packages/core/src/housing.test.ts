import { expect, test } from "vitest";
import type { Rule, Tx } from "./model.js";
import { housingKind, proposeHousingCost, resolveHousingCost } from "./housing.js";

let n = 0;
const tx = (cp: string, date: string, amount: number, description = ""): Tx => ({
  id: String(n++), accountKey: "A1", date, amount, currency: "EUR", counterparty: cp, description, category: "", manual: false,
});

const months = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
const monthly = (cp: string, amount: number, day = "01", description = "") =>
  months.map((m) => tx(cp, `${m}-${day}`, amount, description));

test("housingKind names rent, mortgage and plain housing spend", () => {
  expect(housingKind("Woningstichting Rochdale")).toBe("huur");
  expect(housingKind("Huur augustus")).toBe("huur");
  expect(housingKind("Hypotheek 1234.56.789")).toBe("hypotheek");
  expect(housingKind("Vattenfall")).toBe("wonen");
});

test("proposeHousingCost reads the rent off the recurring payments instead of asking for it", () => {
  const txs = [
    ...monthly("Woningstichting Rochdale", -1450, "05"),
    ...monthly("Vattenfall", -145, "12"),
    ...monthly("Albert Heijn", -80, "18"),
    tx("Random Store", "2026-07-09", -900),
  ];
  const p = proposeHousingCost(txs, [])!;
  expect(p).toMatchObject({
    counterparty: "Woningstichting Rochdale",
    kind: "huur",
    monthlyCents: 145_000,
    cadenceDays: 30,
    occurrences: 6,
    lastDate: "2026-08-05",
  });
  // Energy is housing-categorised too, so it is offered as an alternative — but
  // the named rent stream is the proposal, not the biggest guess.
  expect(p.alternatives.map((a) => a.counterparty)).toEqual(["Woningstichting Rochdale", "Vattenfall"]);
});

test("proposeHousingCost prefers a NAMED rent stream over a larger unnamed housing one", () => {
  const txs = [...monthly("Huurbetaling Jansen", -900, "01"), ...monthly("Eneco", -1200, "10")];
  const p = proposeHousingCost(txs, [])!;
  expect(p.counterparty).toBe("Huurbetaling Jansen");
  expect(p.kind).toBe("huur");
  expect(p.monthlyCents).toBe(90_000);
});

test("proposeHousingCost picks up a mortgage as the housing cost", () => {
  const p = proposeHousingCost(monthly("ING Hypotheken", -1875.5, "28"), [])!;
  expect(p).toMatchObject({ kind: "hypotheek", monthlyCents: 187_550 });
});

test("a user rule that labels an unknown landlord is enough", () => {
  const rules: Rule[] = [{ id: "r1", match: "j. de vries", category: "Wonen & energie" }];
  const p = proposeHousingCost(monthly("J. de Vries", -1100, "03"), rules)!;
  expect(p).toMatchObject({ counterparty: "J. de Vries", kind: "wonen", monthlyCents: 110_000 });
});

test("proposeHousingCost returns null rather than a placeholder when nothing recurs", () => {
  expect(proposeHousingCost([], [])).toBeNull();
  // Housing spend, but no rhythm: two payments, wildly different, months apart.
  expect(proposeHousingCost([tx("Huur", "2026-01-05", -1400), tx("Huur", "2026-05-05", -300)], [])).toBeNull();
  // No housing spend at all.
  expect(proposeHousingCost(monthly("Albert Heijn", -80), [])).toBeNull();
});

test("a quarterly housing charge is not offered as a MONTHLY housing cost", () => {
  const quarterly = ["2026-01-05", "2026-04-05", "2026-07-05"].map((d) => tx("Verhuurder Servicekosten", d, -300));
  expect(proposeHousingCost(quarterly, [])).toBeNull();
});

test("resolveHousingCost: a typed figure always wins, and the derived one is still shown", () => {
  const txs = monthly("Woningstichting Rochdale", -1450, "05");
  const r = resolveHousingCost(120_000, txs, []);
  expect(r.monthlyCents).toBe(120_000);
  expect(r.source).toBe("manual");
  expect(r.proposal?.monthlyCents).toBe(145_000); // never silently substituted
});

test("resolveHousingCost: a typed ZERO is an answer, not an absence", () => {
  const r = resolveHousingCost(0, monthly("Woningstichting Rochdale", -1450, "05"), []);
  expect(r.monthlyCents).toBe(0);
  expect(r.source).toBe("manual");
});

test("resolveHousingCost: nothing typed and nothing detected is unknown — not zero", () => {
  const r = resolveHousingCost(null, monthly("Albert Heijn", -80), []);
  expect(r.monthlyCents).toBeNull();
  expect(r.source).toBe("unknown");
  expect(r.proposal).toBeNull();
});

test("resolveHousingCost: nothing typed but something detected is marked as derived", () => {
  const r = resolveHousingCost(undefined, monthly("Woningstichting Rochdale", -1450, "05"), []);
  expect(r).toMatchObject({ monthlyCents: 145_000, source: "detected" });
  expect(r.proposal?.counterparty).toBe("Woningstichting Rochdale");
});

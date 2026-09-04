import { expect, test } from "vitest";
import type { Account } from "./model.js";
import type { EntityForecast, RecurringStream } from "./forecast.js";
import { computeAlerts } from "./alerts.js";
import { makeScheduledFlow } from "./scheduledFlows.js";
import { makeRewardsBalance } from "./rewards.js";
import { dueRewards } from "./tracking.js";

const acc = (key: string, balance: number | null): Account => ({
  key,
  iban: key,
  name: key,
  bank: "ING",
  entity: "BV1",
  currency: "EUR",
  balance,
});
const stream = (over: Partial<RecurringStream>): RecurringStream => ({
  key: "k",
  counterparty: "X",
  sign: -1,
  cadenceDays: 30,
  amountCents: 5000,
  occurrences: 4,
  lastDate: "2026-07-25",
  intervalCv: 0.1,
  ...over,
});
const fc = (over: Partial<EntityForecast>): EntityForecast => ({
  scope: "geconsolideerd",
  asOf: "2026-08-01",
  horizonDays: 91,
  openingCents: 100000,
  points: [],
  shortfall: null,
  streams: [],
  drivers: [],
  ...over,
});

const ASOF = "2026-08-01";

test("shortfall -> one critical alert mentioning date and buffer", () => {
  const alerts = computeAlerts({
    accounts: [acc("A", 100)],
    asOf: ASOF,
    bufferCents: 250000,
    forecast: fc({ shortfall: { date: "2026-09-10", balanceCents: -1500 } }),
  });
  expect(alerts[0].severity).toBe("critical");
  expect(alerts[0].detail).toContain("2026-09-10");
  expect(alerts[0].detail).toContain("2.500,00"); // buffer shown
});

test("recurring stream overdue within window -> warning; recent or long-gone -> none", () => {
  const overdue = stream({
    key: "rent",
    counterparty: "Verhuurder",
    sign: -1,
    cadenceDays: 30,
    lastDate: "2026-06-22",
  }); // expectedNext 07-22, 10d overdue
  const recent = stream({ key: "sal", lastDate: "2026-07-25" }); // expectedNext 08-24, not due
  const ended = stream({ key: "old", lastDate: "2026-01-01" }); // expectedNext 01-31, 182d overdue -> assume ended
  const alerts = computeAlerts({
    accounts: [acc("A", 100)],
    asOf: ASOF,
    bufferCents: 0,
    forecast: fc({ streams: [overdue, recent, ended] }),
  });
  const warnings = alerts.filter((a) => a.severity === "warning");
  expect(warnings).toHaveLength(1);
  expect(warnings[0].detail).toContain("Verhuurder");
});

test("accounts without saldo -> one info alert with the count", () => {
  const alerts = computeAlerts({
    accounts: [acc("A", 100), acc("B", null), acc("C", null)],
    asOf: ASOF,
    bufferCents: 0,
    forecast: fc({}),
  });
  const info = alerts.filter((a) => a.severity === "info");
  expect(info).toHaveLength(1);
  expect(info[0].detail).toContain("2 rekeningen");
});

test("alerts are ranked critical -> warning -> info", () => {
  const alerts = computeAlerts({
    accounts: [acc("A", null)],
    asOf: ASOF,
    bufferCents: 0,
    forecast: fc({
      shortfall: { date: "2026-09-01", balanceCents: -100 },
      streams: [stream({ key: "r", lastDate: "2026-06-22" })],
    }),
  });
  expect(alerts.map((a) => a.severity)).toEqual(["critical", "warning", "info"]);
});

test("nothing wrong -> no alerts", () => {
  expect(
    computeAlerts({ accounts: [acc("A", 100)], asOf: ASOF, bufferCents: 0, forecast: fc({}) }),
  ).toEqual([]);
});

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

test("a prepayment deadline gets the same ladder as a BTW deadline, in its own words", () => {
  const prepay = makeScheduledFlow({
    entity: "BV1",
    label: "Vorauszahlung 3/4 2026",
    sign: -1,
    amountCents: 2_500_000,
    dueDate: "2026-08-10",
    source: "prepayment",
    status: "expected",
  });
  const alerts = computeAlerts({
    accounts: [acc("A", 1000)],
    asOf: "2026-08-01",
    bufferCents: 0,
    forecast: fc({}),
    scheduledFlows: [prepay],
  });
  const a = alerts.filter((x) => x.id.startsWith("tax:"));
  expect(a).toHaveLength(1);
  expect(a[0].severity).toBe("warning"); // 9 days out
  expect(a[0].title).toContain("Vorauszahlung 3/4 2026");
  expect(a[0].detail).toContain("vooruitbetaling winstbelasting");
  expect(a[0].detail).toContain("25.000,00");
});

test("a stale hand-kept balance becomes an alert whose detail IS the question (item 7, low-trust)", () => {
  const amex = makeRewardsBalance({
    program: "American Express Membership Rewards",
    points: 240000,
    updatedAt: "2026-01-10",
  });
  const alerts = computeAlerts({
    accounts: [acc("A", 100)],
    asOf: "2026-08-01",
    bufferCents: 0,
    forecast: fc({}),
    tracking: dueRewards([amex], "2026-08-01"),
  });
  const t = alerts.filter((a) => a.id.startsWith("tracking:"));
  expect(t).toHaveLength(1);
  expect(t[0].id).toBe(`tracking:rewards:${amex.id}`);
  expect(t[0].severity).toBe("warning"); // 203 days old -> overdue
  expect(t[0].title).toBe("American Express Membership Rewards — saldo bijwerken");
  expect(t[0].detail).toContain("2026-01-10");
  expect(t[0].detail).toContain("Stuur alleen het getal");
  expect(t[0].detail).not.toContain("240"); // the balance itself never appears in the ask
});

test("a merely-due balance is info, a fresh one is nothing, and a money problem still outranks both", () => {
  const due = makeRewardsBalance({ program: "Avios", points: 1000, updatedAt: "2026-05-01" }); // 92d -> due
  const fresh = makeRewardsBalance({
    program: "Flying Blue",
    points: 1000,
    updatedAt: "2026-07-20",
  });
  const alerts = computeAlerts({
    accounts: [acc("A", 100)],
    asOf: "2026-08-01",
    bufferCents: 250000,
    forecast: fc({ shortfall: { date: "2026-09-10", balanceCents: -1500 } }),
    tracking: dueRewards([due, fresh], "2026-08-01"),
  });
  expect(alerts.filter((a) => a.id.startsWith("tracking:")).map((a) => a.severity)).toEqual([
    "info",
  ]);
  expect(alerts[0].severity).toBe("critical"); // cash first, points later
});

test("no tracking passed at all -> the alert center behaves exactly as before", () => {
  expect(
    computeAlerts({ accounts: [acc("A", 100)], asOf: ASOF, bufferCents: 0, forecast: fc({}) }),
  ).toEqual([]);
  expect(
    computeAlerts({
      accounts: [acc("A", 100)],
      asOf: ASOF,
      bufferCents: 0,
      forecast: fc({}),
      tracking: [],
    }),
  ).toEqual([]);
});

import type { PlanResult, Rule, ScheduledFlow } from "@lavega/core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { buildMirror, createMirrorSync } from "./mirror.js";

const NOW = new Date("2026-11-10T09:00:00Z");

const flow = (over: Partial<ScheduledFlow>): ScheduledFlow => ({
  id: "f1",
  entity: "BV1",
  label: "BTW Q4 2026",
  sign: -1,
  amountCents: 123456,
  dueDate: "2027-01-31",
  source: "vat",
  status: "expected",
  ...over,
});
const rules: Rule[] = [{ id: "r1", match: "albert heijn", category: "Boodschappen" }];

const plan = (cards: unknown): PlanResult =>
  ({ sections: { cards: { figures: cards } } }) as unknown as PlanResult;
const net = (cardKey: string, name: string, netCents: number | null) => ({
  cardKey,
  name,
  netCents,
});

test("the mirror serialises without any flow amount or counterparty", () => {
  const m = buildMirror({
    rules,
    flows: [flow({ amountCents: 987654, label: "BTW Q4 2026" })],
    plan: null,
    now: NOW,
  });
  const json = JSON.stringify(m);
  expect(json).not.toContain("amountCents");
  expect(json).not.toContain("987654");
  expect(json).not.toContain("counterparty");
  expect(m.dueDates).toEqual([{ kind: "vat", label: "BTW Q4 2026", date: "2027-01-31" }]);
  expect(m.rules).toEqual(rules);
});

test("paid, cancelled and past flows are excluded; confirmed and today stay", () => {
  const m = buildMirror({
    rules: [],
    flows: [
      flow({ id: "a", status: "paid" }),
      flow({ id: "b", status: "cancelled" }),
      flow({ id: "c", dueDate: "2026-11-09" }),
      flow({
        id: "d",
        status: "confirmed",
        source: "invoice",
        label: "Factuur 7",
        dueDate: "2026-11-10",
      }),
    ],
    plan: null,
    now: NOW,
  });
  expect(m.dueDates).toEqual([{ kind: "other", label: "Betaling te doen", date: "2026-11-10" }]);
});

test("non-VAT due dates carry a generic label, never a user typed supplier name", () => {
  const flows = [
    flow({
      id: "i",
      source: "invoice",
      label: "Factuur Acme Holding BV 2026-114",
      dueDate: "2026-12-01",
    }),
    flow({ id: "m", source: "manual", label: "Aanbetaling Jansen", dueDate: "2026-12-02" }),
  ];
  const nl = buildMirror({ rules: [], flows, plan: null, now: NOW });
  expect(JSON.stringify(nl)).not.toMatch(/Acme|Jansen/);
  expect(nl.dueDates.map((d) => d.label)).toEqual(["Betaling te doen", "Betaling te doen"]);
  const en = buildMirror({ rules: [], flows, plan: null, now: NOW, locale: "en" });
  expect(en.dueDates[0]?.label).toBe("Payment due");
});

test("a gain inside the cards.ts margin is not reported", () => {
  // margin is 10% of |in-use net|: 10000 -> 1000
  const nets = (best: number) => [net("k1", "A", 10000), net("k2", "B", best)];
  const at = (best: number) =>
    buildMirror({
      rules: [],
      flows: [],
      plan: plan({ cardInUseKey: "k1", months: 12, cardableSpendCents: 1, nets: nets(best) }),
      now: NOW,
    }).cardOffer;
  expect(at(10900)).toBeNull();
  expect(at(11000)).toBeNull();
  expect(at(11001)?.yearlyGainCents).toBe(1001);
});

test("the card offer is the best other card's gain over the card in use, yearly", () => {
  const p = plan({
    cardInUseKey: "k1",
    months: 12,
    cardableSpendCents: 100000,
    nets: [net("k1", "Mijn kaart", 1000), net("k2", "Kaart B", 9000), net("k3", "Kaart C", 4000)],
  });
  expect(buildMirror({ rules: [], flows: [], plan: p, now: NOW }).cardOffer).toEqual({
    name: "Kaart B",
    yearlyGainCents: 8000,
    computedAt: "2026-11-10",
  });
});

test("a shorter history is scaled to a year; no gain or unknown nets give null", () => {
  const six = plan({
    cardInUseKey: "k1",
    months: 6,
    cardableSpendCents: 100000,
    nets: [net("k1", "A", 0), net("k2", "B", 3000)],
  });
  expect(
    buildMirror({ rules: [], flows: [], plan: six, now: NOW }).cardOffer?.yearlyGainCents,
  ).toBe(6000);
  for (const nets of [
    [net("k1", "A", 5000), net("k2", "B", 5000)],
    [net("k1", "A", null), net("k2", "B", 9000)],
    [net("k1", "A", 100)],
  ])
    expect(
      buildMirror({
        rules: [],
        flows: [],
        plan: plan({ cardInUseKey: "k1", months: 12, cardableSpendCents: 1, nets }),
        now: NOW,
      }).cardOffer,
    ).toBeNull();
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const m = (n: number) =>
  buildMirror({
    rules: [{ id: "r", match: `m${n}`, category: "c" }],
    flows: [],
    plan: null,
    now: NOW,
  });

test("five rule edits inside the debounce window make one PUT with the last state", async () => {
  const put = vi.fn(async () => undefined);
  const sync = createMirrorSync({ put }, () => true);
  for (let n = 1; n <= 5; n++) {
    sync.push(m(n));
    await vi.advanceTimersByTimeAsync(500);
  }
  expect(put).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2000);
  expect(put).toHaveBeenCalledTimes(1);
  expect(put).toHaveBeenCalledWith(m(5));
});

test("an identical payload is not sent twice, a failed one is retried", async () => {
  const put = vi.fn(async () => undefined);
  const sync = createMirrorSync({ put }, () => true);
  sync.push(m(1));
  await vi.advanceTimersByTimeAsync(2100);
  sync.push(m(1));
  await vi.advanceTimersByTimeAsync(2100);
  expect(put).toHaveBeenCalledTimes(1);

  const failing = vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValue(undefined);
  const s2 = createMirrorSync({ put: failing }, () => true);
  s2.push(m(2));
  await vi.advanceTimersByTimeAsync(2100);
  s2.push(m(2));
  await vi.advanceTimersByTimeAsync(2100);
  expect(failing).toHaveBeenCalledTimes(2);
});

test("disabled makes zero calls, also when turned off during the wait", async () => {
  const put = vi.fn(async () => undefined);
  let on = false;
  const sync = createMirrorSync({ put }, () => on);
  sync.push(m(1));
  await vi.advanceTimersByTimeAsync(5000);
  expect(put).not.toHaveBeenCalled();
  on = true;
  sync.push(m(2));
  on = false;
  await vi.advanceTimersByTimeAsync(5000);
  expect(put).not.toHaveBeenCalled();
});

test("the day boundary is the Amsterdam day: 00:30 local in winter and in summer time (F10)", () => {
  // 23:30Z in January is 00:30 on the 16th in Amsterdam (CET); 22:30Z in July likewise (CEST).
  for (const [instant, today] of [
    ["2026-01-15T23:30:00Z", "2026-01-16"],
    ["2026-07-15T22:30:00Z", "2026-07-16"],
  ] as const) {
    const m = buildMirror({
      rules: [],
      flows: [
        flow({
          id: "yesterday",
          dueDate: new Date(Date.parse(today) - 86_400_000).toISOString().slice(0, 10),
        }),
        flow({ id: "today", dueDate: today }),
      ],
      plan: null,
      now: new Date(instant),
    });
    expect(
      m.dueDates.map((d) => d.date),
      instant,
    ).toEqual([today]);
  }
});

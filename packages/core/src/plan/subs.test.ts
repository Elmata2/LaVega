import { describe, expect, test } from "vitest";
import { proposeFixedCosts } from "../advisor/fixedCosts.js";
import { fingerprint } from "../advisor/evidence.js";
import { scopedOwn } from "../advisor/room.js";
import { personalView } from "../advisor/scopePersonal.js";
import { mkAccount, mkTx } from "../advisor/testkit.js";
import type { Tx } from "../model.js";
import { detectSubscriptions } from "../subscriptions.js";
import { buildFactSheet } from "./factsheet.js";
import type { PlanEvent } from "./preferences.js";
import { computeSubscriptions, priceChange, SUBS_CALC_IDS } from "./subs.js";
import { AS_OF, planInput } from "./testkit.js";

/** One charge per month on the 5th, the first in `start` (YYYY-MM). */
const series = (
  counterparty: string,
  start: string,
  amounts: number[],
  o: Partial<Tx> = {},
): Tx[] => {
  const [y, m] = start.split("-").map(Number) as [number, number];
  return amounts.map((a, k) => {
    const idx = y * 12 + (m - 1) + k;
    const date = `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}-05`;
    return mkTx(counterparty, date, -a, o);
  });
};
const rep = (n: number, v: number): number[] => Array.from({ length: n }, () => v);
const acct = [mkAccount("A1")];
const input = (txs: Tx[], over: Parameters<typeof planInput>[0] = {}) =>
  planInput({ accounts: acct, txs, ...over });
const sub = (txs: Tx[], key?: string) => {
  const subs = detectSubscriptions(txs, { asOf: AS_OF });
  return key === undefined ? subs[0]! : subs.find((s) => s.key === key)!;
};
const dec = (id: string, at: string, streamKey: string, decision: string): PlanEvent =>
  ({ id, kind: "subscription-decision", at, streamKey, decision }) as PlanEvent;
const use = (id: string, at: string, streamKey: string, month: string): PlanEvent =>
  ({ id, kind: "usage-log", at, streamKey, month }) as PlanEvent;

// Netflix 9.99 x4 then 11.79 x3 (2026-04 .. 2026-10)
const netflixUp = () => series("Netflix", "2026-04", [...rep(4, 9.99), ...rep(3, 11.79)]);

describe("priceChange", () => {
  test("9.99 x4 then 11.79 x3 -> first 11.79 charge, 999 -> 1179", () => {
    const txs = netflixUp();
    expect(priceChange(sub(txs), txs)).toEqual({
      changeDate: "2026-08-05",
      fromCents: 999,
      toCents: 1179,
      changePct: 0.18,
    });
  });
  test("below 3% or 50 cents -> null", () => {
    const small = series("Netflix", "2026-04", [...rep(4, 9.99), ...rep(3, 10.29)]); // 3.0% but 30 cents
    expect(priceChange(sub(small), small)).toBeNull();
    const pctLow = series("Videoland", "2026-04", [...rep(4, 100), ...rep(3, 101)]);
    expect(priceChange(sub(pctLow), pctLow)).toBeNull();
    const flat = series("Netflix", "2026-04", rep(7, 9.99));
    expect(priceChange(sub(flat), flat)).toBeNull();
  });
});

describe("priceChange: boundaries of the last step (task 13)", () => {
  test("a last step of exactly 3% (and >= 50 cents) after an earlier rise is reported as the last step", () => {
    const txs = series("Netflix", "2026-04", [...rep(2, 15), ...rep(2, 20), ...rep(3, 20.6)]);
    expect(priceChange(sub(txs), txs)).toEqual({
      changeDate: "2026-08-05",
      fromCents: 2000,
      toCents: 2060,
      changePct: 0.03,
    });
  });
  test("a last step of exactly 50 cents (and >= 3%) after an earlier rise is reported as the last step", () => {
    const txs = series("Netflix", "2026-04", [...rep(2, 10), ...rep(2, 15), ...rep(3, 15.5)]);
    expect(priceChange(sub(txs), txs)).toEqual({
      changeDate: "2026-08-05",
      fromCents: 1500,
      toCents: 1550,
      changePct: 0.033,
    });
  });
});

describe("computeSubscriptions", () => {
  test("rows sort by name and carry only facts[] kinds", () => {
    const txs = [
      ...series("Spotify", "2026-04", rep(7, 10.99)),
      ...series("Netflix", "2026-04", rep(7, 12.99)),
      ...series("Adobe", "2026-04", rep(7, 24.19)),
    ];
    const r = computeSubscriptions(input(txs));
    const names = r.figures.rows.map((x) => x.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    expect(names).toHaveLength(3);
    expect(r.figures.totalMonthlyCents).toBe(1099 + 1299 + 2419);
    expect(r.figures.totalYearlyCents).toBe((1099 + 1299 + 2419) * 12);
    for (const row of r.figures.rows) {
      expect(Object.keys(row).sort()).toEqual(
        [
          "key",
          "name",
          "function",
          "monthlyCents",
          "yearlyCents",
          "monthsActive",
          "priceChange",
          "overlapGroup",
          "overlapCombinedMonthlyCents",
          "skippedCycles",
          "usage",
          "decision",
          "facts",
        ].sort(),
      );
      for (const f of row.facts)
        expect(["price-up", "overlap", "no-use-logged", "missed-payment"]).toContain(f);
    }
  });

  test("decision comes only from events: none -> null; keep then cancel -> cancel; clear -> null", () => {
    const txs = series("Netflix", "2026-04", rep(7, 12.99));
    const key = sub(txs).key;
    const at = (events: PlanEvent[]) =>
      computeSubscriptions(input(txs, { events })).figures.rows[0]!.decision;
    expect(at([])).toBeNull();
    expect(at([dec("a", "2026-10-01", key, "keep"), dec("b", "2026-10-02", key, "cancel")])).toBe(
      "cancel",
    );
    expect(
      at([dec("a", "2026-10-01", key, "cancel"), dec("b", "2026-10-02", key, "clear")]),
    ).toBeNull();
  });

  test("whatIfCancel sums only rows marked cancel; none marked -> 0", () => {
    const txs = [
      ...series("Netflix", "2026-04", rep(7, 12.99)),
      ...series("Spotify", "2026-04", rep(7, 10.99)),
    ];
    const keyN = sub(
      txs,
      detectSubscriptions(txs, { asOf: AS_OF }).find((s) => s.merchant.includes("netflix"))!.key,
    ).key;
    const none = computeSubscriptions(input(txs));
    expect(none.figures.whatIfCancelMonthlyCents).toBe(0);
    expect(none.figures.whatIfCancelYearlyCents).toBe(0);
    const one = computeSubscriptions(
      input(txs, { events: [dec("a", "2026-10-01", keyN, "cancel")] }),
    );
    expect(one.figures.whatIfCancelMonthlyCents).toBe(1299);
    expect(one.figures.whatIfCancelYearlyCents).toBe(1299 * 12);
  });

  test("usage unknown by default; one logged month -> cost per use; duplicate month once", () => {
    const txs = series("Netflix", "2026-04", rep(7, 12.99));
    const key = sub(txs).key;
    expect(computeSubscriptions(input(txs)).figures.rows[0]!.usage).toBe("unknown");
    const events = [
      use("u1", "2026-10-02", key, "2026-09"),
      use("u2", "2026-10-03", key, "2026-09"), // second device, same month
    ];
    const row = computeSubscriptions(input(txs, { events })).figures.rows[0]!;
    expect(row.usage).toEqual({
      loggedMonths: 1,
      lastLoggedMonth: "2026-09",
      costPerUseCents: 1299 * 12,
    });
    const two = computeSubscriptions(
      input(txs, { events: [...events, use("u3", "2026-10-04", key, "2026-08")] }),
    ).figures.rows[0]!;
    expect(two.usage).toMatchObject({ loggedMonths: 2, costPerUseCents: 1299 * 6 });
  });

  test("usage older than 12 months does not count", () => {
    const txs = series("Netflix", "2026-04", rep(7, 12.99));
    const key = sub(txs).key;
    const row = computeSubscriptions(
      input(txs, { events: [use("u1", "2026-10-02", key, "2025-06")] }),
    ).figures.rows[0]!;
    expect(row.usage).toBe("unknown");
  });

  test("no-use-logged only when usage was logged for another stream and none for this one", () => {
    const txs = [
      ...series("Netflix", "2026-04", rep(7, 12.99)),
      ...series("Spotify", "2026-04", rep(7, 10.99)),
    ];
    const subs = detectSubscriptions(txs, { asOf: AS_OF });
    const netflix = subs.find((s) => s.merchant.includes("netflix"))!;
    const spotify = subs.find((s) => s.merchant.includes("spotify"))!;
    const nobody = computeSubscriptions(input(txs));
    expect(nobody.figures.rows.every((x) => !x.facts.includes("no-use-logged"))).toBe(true);
    expect(nobody.facts.some((f) => f.factId.startsWith("sub_no_use:"))).toBe(false);

    const r = computeSubscriptions(
      input(txs, { events: [use("u1", "2026-10-02", spotify.key, "2026-09")] }),
    );
    const byKey = new Map(r.figures.rows.map((x) => [x.key, x]));
    expect(byKey.get(netflix.key)!.facts).toContain("no-use-logged");
    expect(byKey.get(spotify.key)!.facts).not.toContain("no-use-logged");
    expect(r.facts.filter((f) => f.factId.startsWith("sub_no_use:"))).toHaveLength(1);

    // usage logged only for a stream that is gone does not count
    const orphan = computeSubscriptions(
      input(txs, { events: [use("u1", "2026-10-02", "gone|out|999", "2026-09")] }),
    );
    expect(orphan.figures.rows.every((x) => !x.facts.includes("no-use-logged"))).toBe(true);
  });

  test("overlap: two video streams 12.99 + 11.99 -> combined 24.98", () => {
    const txs = [
      ...series("Netflix", "2026-04", rep(7, 12.99)),
      ...series("Videoland", "2026-04", rep(7, 11.99)),
    ];
    const r = computeSubscriptions(input(txs));
    for (const row of r.figures.rows) {
      expect(row.overlapGroup).toBe("Videostreaming");
      expect(row.overlapCombinedMonthlyCents).toBe(2498);
      expect(row.facts).toContain("overlap");
    }
    expect(r.status).toBe("attention");
    expect(r.statusReason.key).toBe("overlap");
    const f = r.facts.filter((x) => x.factId.startsWith("sub_overlap:"));
    expect(f).toHaveLength(1);
    expect(f[0]!.exact).toBe(2498);
  });

  test("same merchant, two streams -> not an overlap", () => {
    const txs = [
      ...series("Netflix", "2026-04", rep(7, 12.99)),
      ...series("Netflix", "2026-04", rep(7, 4.5)),
    ];
    const r = computeSubscriptions(input(txs));
    expect(r.figures.rows.length).toBeGreaterThanOrEqual(1);
    expect(r.figures.rows.every((x) => x.overlapGroup === null)).toBe(true);
    expect(r.status).not.toBe("attention");
  });

  test("skippedCycles > 0 -> missed-payment fact, mustMention true", () => {
    // 2026-06 never arrives
    const txs = [
      ...series("Spotify", "2026-03", rep(3, 10.99)),
      ...series("Spotify", "2026-07", rep(4, 10.99)),
    ];
    const s = sub(txs);
    expect(s.skippedCycles).toBeGreaterThan(0);
    const r = computeSubscriptions(input(txs));
    expect(r.figures.rows[0]!.skippedCycles).toBe(s.skippedCycles);
    expect(r.figures.rows[0]!.facts).toContain("missed-payment");
    const f = r.facts.find((x) => x.factId.startsWith("sub_missed_payment:"))!;
    expect(f.mustMention).toBe(true);
    expect(f.polarity).toBe("negative");
  });

  test("under 90 days with nothing detected -> not-enough-data; 90+ days -> on-track, empty", () => {
    const short = computeSubscriptions(
      input([mkTx("Albert Heijn", "2026-09-01", -10), mkTx("Jumbo", "2026-10-01", -12)]),
    );
    expect(short.status).toBe("not-enough-data");
    expect(short.statusReason.key).toBe("none-short-history");
    expect(short.missing.map((m) => m.kind)).toContain("history-90d");
    expect(short.figures.rows).toEqual([]);

    const long = computeSubscriptions(
      input([mkTx("Albert Heijn", "2026-06-01", -10), mkTx("Jumbo", "2026-10-01", -12)]),
    );
    expect(long.figures.coverageDays).toBeGreaterThanOrEqual(90);
    expect(long.status).toBe("on-track");
    expect(long.statusReason.key).toBe("clean");
    expect(long.figures.rows).toEqual([]);
    expect(long.missing).toEqual([]);
  });

  test("price increase older than 12 months is not flagged; 11 months old is", () => {
    // change at 2025-07 (15 months before AS_OF) vs 2025-11 (11 months)
    const old = series("Netflix", "2025-03", [...rep(4, 9.99), ...rep(16, 11.79)]);
    const oldR = computeSubscriptions(input(old));
    expect(oldR.figures.rows[0]!.priceChange?.changeDate).toBe("2025-07-05");
    expect(oldR.figures.rows[0]!.facts).not.toContain("price-up");
    expect(oldR.status).toBe("on-track");
    expect(oldR.facts.some((f) => f.factId.startsWith("sub_price_up:"))).toBe(false);

    const recent = series("Netflix", "2025-07", [...rep(4, 9.99), ...rep(12, 11.79)]);
    const recR = computeSubscriptions(input(recent));
    expect(recR.figures.rows[0]!.priceChange?.changeDate).toBe("2025-11-05");
    expect(recR.figures.rows[0]!.facts).toContain("price-up");
    expect(recR.status).toBe("attention");
    expect(recR.statusReason.key).toBe("price-increase");
  });

  test("price increase wins over overlap in the status reason", () => {
    const txs = [...netflixUp(), ...series("Videoland", "2026-04", rep(7, 11.99))];
    const r = computeSubscriptions(input(txs));
    expect(r.statusReason.key).toBe("price-increase");
    const pf = r.facts.find((f) => f.factId.startsWith("sub_price_up:"))!;
    expect(pf.polarity).toBe("negative");
    expect(pf.mustMention).toBe(false);
  });

  test("an event for a stream that is gone is ignored and never throws", () => {
    const txs = series("Netflix", "2026-04", rep(7, 12.99));
    const r = computeSubscriptions(
      input(txs, {
        events: [
          dec("a", "2026-10-01", "gone|out|1", "cancel"),
          use("u", "2026-10-01", "gone|out|1", "2026-09"),
        ],
      }),
    );
    expect(r.figures.rows).toHaveLength(1);
    expect(r.figures.rows[0]!.decision).toBeNull();
    expect(r.figures.whatIfCancelMonthlyCents).toBe(0);
  });

  test("a stream the user marked 'Not mine' (profile.removed) is left out of rows and totals", () => {
    const txs = [
      ...series("Netflix", "2026-04", rep(7, 12.99)),
      ...series("Spotify", "2026-04", rep(7, 10.99)),
    ];
    const subs = detectSubscriptions(txs, { asOf: AS_OF });
    const netflix = subs.find((s) => s.merchant.includes("netflix"))!;
    const removed = [fingerprint(netflix.txIds)];
    const r = computeSubscriptions(input(txs, { profile: { removed } }));
    expect(r.figures.rows.map((x) => x.key)).not.toContain(netflix.key);
    expect(r.figures.rows).toHaveLength(1);
    expect(r.figures.totalMonthlyCents).toBe(1099);
  });

  test("a business-entity subscription is excluded (personal scope)", () => {
    const txs = [
      ...series("Netflix", "2026-04", rep(7, 12.99)),
      ...series("Spotify", "2026-04", rep(7, 10.99), { accountKey: "B1" }),
    ];
    const accounts = [mkAccount("A1"), mkAccount("B1", { entity: "Acme BV" })];
    const r = computeSubscriptions(
      planInput({
        accounts,
        txs,
        entityProfiles: [{ entity: "Acme BV", scope: "business" }],
      }),
    );
    expect(r.figures.rows).toHaveLength(1);
    expect(r.figures.rows[0]!.name.toLowerCase()).toContain("netflix");
    expect(r.figures.totalMonthlyCents).toBe(1299);
  });

  test("fact ids hold no merchant name and the sheet builds", () => {
    const txs = [...netflixUp(), ...series("Videoland", "2026-04", rep(7, 11.99))];
    const r = computeSubscriptions(
      input(txs, { events: [use("u", "2026-10-01", "x", "2026-09")] }),
    );
    for (const f of r.facts) {
      expect(f.factId).toMatch(/^[a-z0-9_:-]+$/);
      expect(f.factId.toLowerCase()).not.toContain("netflix");
      expect(f.factId.toLowerCase()).not.toContain("videoland");
      expect(Number.isInteger(f.exact as number) || typeof f.exact === "string").toBe(true);
    }
    expect(() => buildFactSheet(r.facts, { locale: "nl", asOf: AS_OF })).not.toThrow();
  });

  test("CALC ids are declared and used", () => {
    const r = computeSubscriptions(input(netflixUp()));
    expect(r.calc.length).toBeGreaterThan(0);
    for (const c of r.calc) expect(SUBS_CALC_IDS).toContain(c.id as never);
    expect(r.section).toBe("subscriptions");
    expect(r.headline).toEqual({ unit: "cents", value: r.figures.totalYearlyCents });
  });
});

describe("round 1 fixes", () => {
  const amounts = (vals: number[]) => series("Netflix", "2026-03", vals);

  test("I1 trailing one-off: 9.99 x3, 11.79 x3, then 4.50 -> still a 999 -> 1179 step", () => {
    const txs = amounts([...rep(3, 9.99), ...rep(3, 11.79), 4.5]);
    expect(priceChange(sub(txs), txs)).toEqual({
      changeDate: "2026-06-05",
      fromCents: 999,
      toCents: 1179,
      changePct: 0.18,
    });
    const r = computeSubscriptions(input(txs));
    expect(r.statusReason.key).toBe("price-increase");
  });
  test("I1 one-off inside the final run keeps the real step date", () => {
    const txs = amounts([...rep(3, 9.99), 11.79, 11.79, 4.5, 11.79]);
    expect(priceChange(sub(txs), txs)).toMatchObject({
      changeDate: "2026-06-05",
      fromCents: 999,
      toCents: 1179,
    });
  });
  test("I1 up then partly down is not reported as the date it went down", () => {
    const txs = amounts([...rep(3, 9.99), ...rep(2, 13.99), ...rep(2, 11.99)]);
    const c = priceChange(sub(txs), txs);
    expect(c?.changeDate).toBe("2026-06-05");
    expect(c).toMatchObject({ fromCents: 999, toCents: 1199 });
  });
  test("I1 two hikes: the last step 1179 -> 1399 with its own pct", () => {
    const txs = series("Netflix", "2026-02", [...rep(3, 9.99), ...rep(3, 11.79), ...rep(3, 13.99)]);
    expect(priceChange(sub(txs), txs)).toEqual({
      changeDate: "2026-08-05",
      fromCents: 1179,
      toCents: 1399,
      changePct: 0.187,
    });
  });

  test("I2 a USD stream is excluded from rows and totals, and counted", () => {
    const txs = [
      ...series("Netflix", "2026-04", rep(7, 12.99)),
      ...series("Spotify", "2026-04", rep(7, 12), { currency: "USD" }),
    ];
    const r = computeSubscriptions(input(txs));
    expect(r.figures.rows).toHaveLength(1);
    expect(r.figures.totalMonthlyCents).toBe(1299);
    expect(r.figures.excludedForeignCount).toBe(1);
    expect(r.flat["sub_foreign_excluded"]).toEqual({ unit: "count", value: 1 });
    expect(JSON.stringify(r.calc)).toContain("foreign_excluded");
  });

  test("I3 decision and usage survive a price change; ambiguous prefix adopts nothing", () => {
    const old = series("Netflix", "2026-04", rep(7, 12.99));
    const oldKey = sub(old).key;
    const up = series("Netflix", "2026-04", [...rep(4, 12.99), ...rep(3, 13.99)]);
    const newKey = sub(up).key;
    expect(newKey).not.toBe(oldKey);
    const events = [
      dec("a", "2026-10-01", oldKey, "cancel"),
      use("u", "2026-10-02", oldKey, "2026-09"),
    ];
    const r = computeSubscriptions(input(up, { events }));
    expect(r.figures.rows[0]!.decision).toBe("cancel");
    expect(r.figures.rows[0]!.usage).not.toBe("unknown");
    expect(r.figures.whatIfCancelMonthlyCents).toBe(1399);

    const two = [...up, ...series("Netflix", "2026-04", rep(7, 4.5))];
    const rows = computeSubscriptions(input(two, { events })).figures.rows;
    expect(rows.length).toBe(2);
    expect(rows.every((x) => x.decision === null)).toBe(true);
  });

  test("I4 a lender-named monthly stream is not a subscription", () => {
    const txs = [
      ...series("Netflix", "2026-04", rep(7, 12.99)),
      ...series("Santander Consumer Finance", "2026-04", rep(7, 150)),
    ];
    const r = computeSubscriptions(input(txs));
    expect(r.figures.rows).toHaveLength(1);
    expect(r.figures.whatIfCancelMonthlyCents).toBe(0);
  });

  test("concern 1 'Not mine' on a schedule-stream card removes the row; unrelated fingerprint does not", () => {
    // The first two charges say "uwv", so the schedule detector routes them to
    // another group: the stream card has 7 txs, the subscription 9, and the
    // fingerprints differ.
    const txs = series("Spotify", "2026-02", rep(9, 10.99)).map((t, k) =>
      k < 2 ? { ...t, description: "x uwv" } : t,
    );
    const base = input(txs);
    const view = personalView(base.accounts, base.txs, base.entityProfiles);
    const props = proposeFixedCosts(view.txs, {
      asOf: AS_OF,
      rules: [],
      own: scopedOwn(view.accounts, base.own),
      accounts: view.accounts,
    });
    const card = props.find((p) => p.data.origin === "stream" && p.evidence.length === 7)!;
    expect(card).toBeDefined();
    expect(card.fingerprint).not.toBe(
      fingerprint(detectSubscriptions(txs, { asOf: AS_OF })[0]!.txIds),
    );
    expect(computeSubscriptions(base).figures.rows).toHaveLength(1);
    const r = computeSubscriptions(input(txs, { profile: { removed: [card.fingerprint] } }));
    expect(r.figures.rows).toHaveLength(0);
    const none = computeSubscriptions(input(txs, { profile: { removed: ["zzz"] } }));
    expect(none.figures.rows).toHaveLength(1);
  });

  test("M1 monthsActive counts calendar months", () => {
    const txs = [
      mkTx("Netflix", "2026-03-30", -12.99),
      mkTx("Netflix", "2026-04-29", -12.99),
      mkTx("Netflix", "2026-05-30", -12.99),
      mkTx("Netflix", "2026-06-29", -12.99),
      mkTx("Netflix", "2026-07-30", -12.99),
      mkTx("Netflix", "2026-08-30", -12.99),
      mkTx("Netflix", "2026-09-30", -12.99),
    ];
    expect(computeSubscriptions(input(txs)).figures.rows[0]!.monthsActive).toBe(7);
  });
});

describe("fixed costs are not subscriptions", () => {
  // Merchants and amounts from the synthetic ING statement (lavega-voorbeeld-transacties-ing.csv).
  const fixedSet = (): Tx[] => [
    ...series("Vattenfall Klantenservice", "2026-04", rep(7, 145)),
    ...series("Vitens NV", "2026-04", rep(7, 21.4)),
    ...series("Zilveren Kruis Zorgverzekeringen", "2026-04", rep(7, 284.6)),
    ...series("Centraal Beheer", "2026-04", rep(7, 18.75)),
    ...series("Kinderopvang Het Zonnetje", "2026-04", rep(7, 640)),
  ];
  const keptSet = (): Tx[] => [
    ...series("Netflix International BV", "2026-04", rep(7, 13.99)),
    ...series("Spotify AB", "2026-04", rep(7, 17.99)),
    ...series("Basic-Fit Nederland", "2026-04", rep(7, 29.99)),
    ...series("Ziggo Services BV", "2026-04", rep(7, 62.5)),
    ...series("Simyo", "2026-04", rep(7, 15)),
  ];

  test("excludes energy, water, health insurance, home insurance and childcare", () => {
    const r = computeSubscriptions(input([...fixedSet(), ...keptSet()]));
    const names = r.figures.rows.map((x) => x.name);
    for (const n of ["Vattenfall", "Vitens", "Zilveren Kruis", "Centraal Beheer", "Kinderopvang"])
      expect(names.some((x) => x.startsWith(n))).toBe(false);
    expect(r.figures.excludedFixedCosts.map((x) => x.name)).toEqual([
      "Centraal Beheer",
      "Kinderopvang Het Zonnetje",
      "Vattenfall Klantenservice",
      "Vitens NV",
      "Zilveren Kruis Zorgverzekeringen",
    ]);
  });

  test("keeps Netflix, Spotify, Basic-Fit, Ziggo, Simyo", () => {
    const r = computeSubscriptions(input([...fixedSet(), ...keptSet()]));
    expect(r.figures.rows.map((x) => x.name).sort()).toEqual([
      "Basic-Fit Nederland",
      "Netflix International BV",
      "Simyo",
      "Spotify AB",
      "Ziggo Services BV",
    ]);
  });

  test("user category rule excludes a series", () => {
    const txs = keptSet();
    const plain = computeSubscriptions(input(txs));
    expect(plain.figures.rows.some((x) => x.name.startsWith("Ziggo"))).toBe(true);
    const ruled = computeSubscriptions(
      input(txs, { rules: [{ id: "r1", match: "ziggo", category: "Wonen & energie" }] }),
    );
    expect(ruled.figures.rows.some((x) => x.name.startsWith("Ziggo"))).toBe(false);
    expect(ruled.figures.excludedFixedCosts.map((x) => x.name)).toEqual(["Ziggo Services BV"]);
  });

  test("excluded list carries the name only (a foreign series would carry foreign cents)", () => {
    const r = computeSubscriptions(input(fixedSet()));
    expect(r.figures.excludedFixedCosts).toContainEqual({
      name: "Zilveren Kruis Zorgverzekeringen",
    });
    expect(r.flat.sub_fixed_excluded).toEqual({ unit: "count", value: 5 });
  });

  test("totals exclude them", () => {
    const r = computeSubscriptions(input([...fixedSet(), ...keptSet()]));
    const kept = 1399 + 1799 + 2999 + 6250 + 1500;
    expect(r.figures.totalMonthlyCents).toBe(kept);
    expect(r.figures.totalYearlyCents).toBe(kept * 12);
  });

  test("majority category decides: Netflix with one 'Verzekeringen' charge stays a subscription", () => {
    const txs = series("Netflix", "2026-04", rep(7, 13.99));
    txs[3] = { ...txs[3]!, category: "Verzekeringen" };
    const r = computeSubscriptions(input(txs));
    expect(r.figures.rows.map((x) => x.name)).toEqual(["Netflix"]);
    expect(r.figures.excludedFixedCosts).toEqual([]);
  });

  test("majority fixed category excludes; a tie goes to the most recent transaction", () => {
    const V = "Verzekeringen";
    const A = "Abonnementen";
    const mk = (cats: string[]): Tx[] =>
      series("Acme", "2026-04", rep(cats.length, 20)).map((t, k) => ({ ...t, category: cats[k]! }));
    const run = (cats: string[]) => computeSubscriptions(input(mk(cats))).figures;
    expect(run([A, A, A, A, A, A]).rows).toHaveLength(1);
    expect(run([V, V, V, V, A, A]).rows).toEqual([]);
    expect(run([A, A, A, V, V, V]).rows).toEqual([]);
    expect(run([V, V, V, A, A, A]).rows).toHaveLength(1);
  });

  test("a health insurer is recognised by name even without a category", () => {
    const r = computeSubscriptions(
      input(series("CZ Groep Zorgverzekeraar", "2026-04", rep(7, 130))),
    );
    expect(r.figures.rows).toEqual([]);
    expect(r.figures.excludedFixedCosts).toHaveLength(1);
    const czerny = computeSubscriptions(input(series("Czerny Muziek", "2026-04", rep(7, 12))));
    expect(czerny.figures.rows).toHaveLength(1);
  });
});

import { describe, expect, test } from "vitest";
import { makeRewardsBalance } from "@lavega/core";
import { applyPoints, collectDetails, detailRows, initialState, rowIssues } from "./cardDetails.js";

const nameOf = (id: string) => id.toUpperCase();
const rows = (cardIds: string[], o: Partial<Parameters<typeof detailRows>[0]> = {}) =>
  detailRows({ cardIds, balances: [], rewards: [], nameOf, askPoints: true, ...o });

describe("detailRows", () => {
  test("one row per distinct card, prefilled from the stored balance and points", () => {
    const r = rows(["american-express-gold-card", "american-express-gold-card"], {
      balances: [{ cardId: "american-express-gold-card", balanceCents: 123_400, paysInFull: false, ratePct: 14.9 }],
      rewards: [makeRewardsBalance({ program: "American Express Membership Rewards", points: 8_000, updatedAt: "2026-10-01" })],
    });
    expect(r).toEqual([
      {
        cardId: "american-express-gold-card",
        name: "AMERICAN-EXPRESS-GOLD-CARD",
        balanceCents: 123_400,
        paysInFull: false,
        ratePct: 14.9,
        programName: "American Express Membership Rewards",
        points: 8_000,
      },
    ]);
  });

  test("points are asked once per programme, not at all for cards without one or when they cannot be saved", () => {
    const r = rows(["american-express-gold-card", "american-express-green-card", "abn-amro-creditcard", "other"]);
    expect(r.map((x) => x.programName)).toEqual(["American Express Membership Rewards", null, null, null]);
    expect(rows(["american-express-gold-card"], { askPoints: false })[0]!.programName).toBeNull();
  });
});

describe("rowIssues and collectDetails", () => {
  const init = rows(["american-express-gold-card"])[0]!;
  const state = (o: Partial<ReturnType<typeof initialState>>) => ({ ...initialState(init), ...o });

  test("an empty row is skipped without issues and stores nothing", () => {
    expect(rowIssues(state({}), true)).toEqual([]);
    expect(collectDetails([init], [state({})])).toEqual({ balances: [], points: [] });
  });

  test("a balance needs the paid-in-full answer; a bad balance, rate or points are flagged", () => {
    expect(rowIssues(state({ balance: "1500" }), true)).toEqual(["pays-in-full"]);
    expect(rowIssues(state({ balance: "abc" }), true)).toEqual(["balance"]);
    expect(rowIssues(state({ balance: "1500", paysInFull: false, rate: "x" }), true)).toEqual(["rate"]);
    expect(rowIssues(state({ points: "12 abc" }), true)).toEqual(["points"]);
    expect(rowIssues(state({ points: "12 abc" }), false)).toEqual([]);
  });

  test("a revolving balance stores the rate; paid in full stores none; zero counts as paid in full", () => {
    const rev = collectDetails([init], [state({ balance: "1.500", paysInFull: false, rate: "14,9", points: "12.500" })]);
    expect(rev.balances).toEqual([{ cardId: init.cardId, balanceCents: 150_000, paysInFull: false, ratePct: 14.9 }]);
    expect(rev.points).toEqual([{ program: "American Express Membership Rewards", points: 12_500 }]);
    const full = collectDetails([init], [state({ balance: "800", paysInFull: true, rate: "9" })]);
    expect(full.balances).toEqual([{ cardId: init.cardId, balanceCents: 80_000, paysInFull: true }]);
    const zero = collectDetails([init], [state({ balance: "0" })]);
    expect(zero.balances).toEqual([{ cardId: init.cardId, balanceCents: 0, paysInFull: true }]);
  });

  test("revolving without a rate stores no rate (never guessed)", () => {
    const r = collectDetails([init], [state({ balance: "500", paysInFull: false })]);
    expect(r.balances[0]).not.toHaveProperty("ratePct");
  });
});

describe("applyPoints (S2)", () => {
  const upsert = (list: ReturnType<typeof makeRewardsBalance>[], b: ReturnType<typeof makeRewardsBalance>) => [
    ...list.filter((x) => x.id !== b.id),
    b,
  ];
  const old = makeRewardsBalance({ program: "American Express Membership Rewards", points: 5000, updatedAt: "2026-04-01" });
  const pt = (points: number) => [{ program: "American Express Membership Rewards", points }];

  test("an unchanged number keeps the row and its date; nothing is saved", () => {
    expect(applyPoints([old], pt(5000), "2026-10-27", upsert)).toBeNull();
  });
  test("a changed number is stored with today's date", () => {
    const next = applyPoints([old], pt(6000), "2026-10-27", upsert)!;
    expect(next).toEqual([expect.objectContaining({ points: 6000, updatedAt: "2026-10-27" })]);
  });
  test("a new programme is added", () => {
    expect(applyPoints([], pt(10), "2026-10-27", upsert)).toHaveLength(1);
  });
});

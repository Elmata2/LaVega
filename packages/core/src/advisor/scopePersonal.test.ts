import { describe, expect, it } from "vitest";
import { cleanTxs, historyCoverage, personalView } from "./scopePersonal.js";
import { mkAccount, mkTx, monthly } from "./testkit.js";
import { ownAccounts } from "../views.js";

describe("historyCoverage", () => {
  it("empty list is not sufficient", () => {
    expect(historyCoverage([])).toEqual({ days: 0, sufficient: false });
  });
  it("59 days is not enough, 61 is", () => {
    const a = historyCoverage([mkTx("x", "2026-01-01", -1), mkTx("x", "2026-03-01", -1)]);
    expect(a).toEqual({ days: 59, sufficient: false });
    const b = historyCoverage([mkTx("x", "2026-01-01", -1), mkTx("x", "2026-03-03", -1)]);
    expect(b).toEqual({ days: 61, sufficient: true });
  });
  it("exactly 60 days is enough", () => {
    expect(
      historyCoverage([mkTx("x", "2026-01-01", -1), mkTx("x", "2026-03-02", -1)]).sufficient,
    ).toBe(true);
  });
  it("ignores undated rows", () => {
    expect(historyCoverage([mkTx("x", "", -1)]).days).toBe(0);
  });
});

describe("personalView", () => {
  const priv = mkAccount("A1", { entity: "Prive" });
  const bv = mkAccount("B1", { entity: "Acme BV" });
  const txs = [mkTx("x", "2026-01-01", -1), mkTx("y", "2026-01-02", -1, { accountKey: "B1" })];
  it("no profiles: all accounts and their txs", () => {
    const v = personalView([priv, bv], txs, []);
    expect(v.accounts).toHaveLength(2);
    expect(v.txs).toHaveLength(2);
  });
  it("a business-entity account and its txs are excluded", () => {
    const v = personalView([priv, bv], txs, [{ entity: "Acme BV", scope: "business" }]);
    expect(v.accounts.map((a) => a.key)).toEqual(["A1"]);
    expect(v.txs.map((t) => t.accountKey)).toEqual(["A1"]);
  });
});

describe("cleanTxs", () => {
  const cur = mkAccount("A1", { iban: "NL01INGB0001234567" });
  const card = mkAccount("C1", { name: "Amex creditcard" });
  const own = ownAccounts([cur, card]);
  it("drops an own transfer found by IBAN in the description", () => {
    const t = mkTx("Jan", "2026-01-05", -100, {
      description: "NL01INGB0001234567",
      accountKey: "Z",
    });
    const k = mkTx("Shop", "2026-01-05", -10);
    const own2 = ownAccounts([cur, mkAccount("Z", { iban: "NL99RABO0009999999" })]);
    expect(cleanTxs([t, k], [cur], [], own2)).toEqual([k]);
  });
  it("drops a card settlement only when the card account is in the set", () => {
    const s = mkTx("ING", "2026-01-05", -300, { category: "Creditcard afbetaald" });
    expect(cleanTxs([s], [cur, card], [], own)).toEqual([]);
    expect(cleanTxs([s], [cur], [], own)).toEqual([s]);
  });
  it("keeps ordinary rows", () => {
    const rows = monthly("Landlord", -900, 3);
    expect(cleanTxs(rows, [cur], [], own)).toHaveLength(3);
  });
});

describe("historyCoverage with a malformed date", () => {
  it("skips it instead of throwing", () => {
    const r = historyCoverage([
      mkTx("x", "2026-01-01", -1),
      mkTx("x", "garbage", -1),
      mkTx("x", "2026-03-03", -1),
    ]);
    expect(r).toEqual({ days: 61, sufficient: true });
  });
});

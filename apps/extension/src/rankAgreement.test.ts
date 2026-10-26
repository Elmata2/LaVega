/* Data-only agreement with the plan's card maths. The plan (packages/core/src/plan/cards.ts)
 * and this extension must give the same result on the shared cases. The extension does not
 * depend on @lavega/core, so the cases live in one JSON file that both test suites read. */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { rankCheckout } from "./rank.js";
import type { CheckoutCard } from "./types.js";

type Case = {
  name: string;
  amountCents: number;
  cashbackPct: number;
  feeCentsPerYear: number;
  held: boolean;
  horizonMonths: number;
  expectedNetCents: number;
  extensionNetCents?: number;
  feeBilledPer?: "maand" | "jaar";
  agree: boolean;
  reason?: string;
};

const FIXTURE = new URL(
  "../../../packages/core/src/plan/__fixtures__/cardCases.json",
  import.meta.url,
);
const cases = (JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: Case[] })
  .cases;

const sourced = (value: number) => ({
  value,
  sourceUrl: "https://voorbeeld.nl/voorwaarden",
  checkedAt: "2026-06-15",
  conditions: null,
});

function cardOf(c: Case): CheckoutCard {
  return {
    id: "kaart",
    product: "kaart",
    issuer: "Bank Voorbeeld",
    kind: "creditcard",
    fxFeePct: sourced(0),
    cashbackPct: sourced(c.cashbackPct),
    pointsPerEuro: null,
    fee: {
      value:
        (c.feeBilledPer === "maand"
          ? c.feeCentsPerYear / 12
          : c.feeCentsPerYear) / 100,
      period: c.feeBilledPer ?? "jaar",
      sourceUrl: "https://voorbeeld.nl/tarieven",
      checkedAt: "2026-01-15",
      conditions: null,
    },
  };
}

describe("rankCheckout agrees with the plan on the shared cases", () => {
  it("the fixture has agreeing and documented non-agreeing cases", () => {
    expect(cases.some((c) => c.agree)).toBe(true);
    for (const c of cases.filter((x) => !x.agree))
      expect(c.reason).toBeTruthy();
  });

  for (const c of cases.filter((x) => x.agree)) {
    it(c.name, () => {
      const r = rankCheckout({
        cards: [cardOf(c)],
        heldIds: c.held ? ["kaart"] : [],
        currency: "EUR",
        amountCents: c.amountCents,
        horizonMonths: c.horizonMonths,
        asOf: "2026-10-24",
      });
      const row = (
        c.held
          ? r.mine
          : [...r.openWorthIt, ...r.openBackwards, ...r.openUnknownCost]
      )[0];
      expect(row?.basis).toBe(c.held ? "opbrengst" : "netto");
      expect(row?.resultCents).toBe(c.expectedNetCents);
    });
  }

  for (const c of cases.filter((x) => !x.agree)) {
    it(`${c.name}: differs on purpose`, () => {
      const r = rankCheckout({
        cards: [cardOf(c)],
        heldIds: c.held ? ["kaart"] : [],
        currency: "EUR",
        amountCents: c.amountCents,
        horizonMonths: c.horizonMonths,
        asOf: "2026-10-24",
      });
      expect(
        (c.held
          ? r.mine
          : [...r.openWorthIt, ...r.openBackwards, ...r.openUnknownCost])[0]
          ?.resultCents,
      ).toBe(c.extensionNetCents);
    });
  }
});

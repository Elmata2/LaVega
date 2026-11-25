import { expect, test } from "vitest";
import type { CardNet, CardsFigures } from "@lavega/core";
import { cardsCopy, planFmt } from "./index.js";

const net = (cardKey: string, inAdvice: boolean): CardNet =>
  ({
    cardKey,
    name: `Kaart ${cardKey}`,
    programId: null,
    spendCents: 120_000,
    earnedCents: 1200,
    feeShareCents: 1200,
    cashbackTier: "measured",
    net: null,
    netCents: 0,
    pointsEarned: null,
    pointsValueRange: null,
    inAdvice,
  }) as CardNet;

const figures = (): CardsFigures =>
  ({
    criteria: [],
    sharedCases: true,
    advice: {},
    nets: [net("covered", true), net("open", false)],
    cardInUseKey: null,
    cardableSpendCents: 0,
    notCardableSpendCents: 0,
    months: 0,
    breakEven: [],
    balances: [],
    excludedForeignCount: 0,
  }) as unknown as CardsFigures;

test("#369-9: the explanation prints the per-card line only for a card the advice does not cover", () => {
  for (const l of ["nl", "en"] as const) {
    const fmt = planFmt(l);
    for (const mode of ["simple", "detailed"] as const) {
      const text = cardsCopy[l].explain[mode](figures(), fmt).join("\n");
      expect(text).toContain("Kaart open");
      expect(text).not.toContain("Kaart covered");
    }
  }
});

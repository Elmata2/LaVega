import { expect, test } from "vitest";
import {
  subscriptionPriceIncreases,
  type Subscription,
} from "../subscriptions.js";
import { PLAN_THRESHOLDS } from "./thresholds.js";

test("subscription thresholds equal subscriptionPriceIncreases' constants", () => {
  const sub = {
    changePct: 0.03,
    firstAmountCents: 1000,
    lastAmountCents: 1050,
  } as Subscription;
  expect(subscriptionPriceIncreases([sub])).toHaveLength(1);
  expect(
    subscriptionPriceIncreases([{ ...sub, lastAmountCents: 1049 }]),
  ).toHaveLength(0);
  expect(
    subscriptionPriceIncreases([{ ...sub, changePct: 0.0299 }]),
  ).toHaveLength(0);
  expect(PLAN_THRESHOLDS.subscriptions).toMatchObject({
    increasePctMin: 0.03,
    increaseCentsMin: 50,
  });
});

test("the table holds the specified values", () => {
  expect(PLAN_THRESHOLDS.version).toBe("plan-thresholds-1");
  expect(PLAN_THRESHOLDS.month).toEqual({
    roomShareOnTrack: 0.1,
    history: { minDays: 60 },
  });
  expect(PLAN_THRESHOLDS.spending).toEqual({
    minMonths: 6,
    overLimitMonths: 2,
  });
  expect(PLAN_THRESHOLDS.cards).toEqual({
    betterCardMargin: 0.1,
    horizonMonths: 12,
  });
  expect(PLAN_THRESHOLDS.goals.within12Months).toBe(12);
  expect(PLAN_THRESHOLDS.scenarioRates).toEqual([0, 0.02, 0.04, 0.06]);
});

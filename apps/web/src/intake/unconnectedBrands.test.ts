import { expect, test } from "vitest";
import { emptyProfile, type AdvisorProfileStore } from "@lavega/core";
import { unconnectedBrands } from "./unconnectedBrands";

const AT = "2026-11-01T00:00:00Z";
const field = <T>(value: T) => ({ value, source: "stated" as const, at: AT });
const store = (patch: Record<string, unknown>) =>
  ({
    current: { ...emptyProfile(), ...patch },
    versions: [],
    updatedAt: AT,
  }) as AdvisorProfileStore;

test("lists an unconnected stated bank and one implied by a card, once each", () => {
  expect(
    unconnectedBrands(
      store({
        statedBanks: field(["abn", "other"]),
        statedCards: field(["american-express-gold-card"]),
        statedDebitCards: field(["other"]),
      }),
      [],
    ),
  ).toEqual(["abn", "amex"]);
});

test("empty when all are connected", () => {
  expect(
    unconnectedBrands(store({ statedBanks: field(["ing"]) }), [{ bank: "ING", linkedAt: AT }]),
  ).toEqual([]);
});

test("empty with no stated banks or cards, or no store", () => {
  expect(unconnectedBrands(store({}), [])).toEqual([]);
  expect(unconnectedBrands(null, [])).toEqual([]);
});

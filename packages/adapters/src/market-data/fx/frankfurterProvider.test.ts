import { expect, test } from "vitest";
import { createFrankfurterFxProvider } from "./frankfurterProvider.js";

const ecbPayload = { amount: 1, base: "EUR", date: "2026-08-04", rates: { USD: 1.1515 } };

test("unsupported pair surfaces as null so the lane can 503 instead of serving rate 0", async () => {
  const provider = createFrankfurterFxProvider({ client: { fetchJson: async () => ecbPayload } });

  await expect(provider.get({ from: "EUR", to: "XYZ" })).resolves.toBeNull();
});

test("supported pair returns the cross rate with no problems", async () => {
  const provider = createFrankfurterFxProvider({ client: { fetchJson: async () => ecbPayload } });

  await expect(provider.get({ from: "USD", to: "EUR" })).resolves.toEqual({
    rate: 1 / 1.1515,
    problems: [],
  });
});

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

test("historical rates parse into dated observations", async () => {
  const provider = createFrankfurterFxProvider({
    client: {
      fetchJson: async (url) =>
        url.includes("..")
          ? { base: "EUR", rates: { "2026-08-04": { USD: 1.1 }, "2026-08-05": { USD: 1.2 } } }
          : ecbPayload,
    },
  });
  await expect(provider.getHistoricalRates("2026-08-04", "2026-08-05")).resolves.toEqual({
    rates: [
      { base: "EUR", date: "2026-08-04", rates: { USD: 1.1 } },
      { base: "EUR", date: "2026-08-05", rates: { USD: 1.2 } },
    ],
    problems: [],
  });
});

test("a hung historical request degrades within the configured timeout", async () => {
  const provider = createFrankfurterFxProvider({
    client: { fetchJson: () => new Promise(() => undefined) },
    timeoutMs: 5,
  });

  await expect(provider.getHistoricalRates("2026-08-04", "2026-08-05")).resolves.toEqual({
    rates: [],
    problems: ["Frankfurter historical FX request failed: Frankfurter request timed out after 5ms"],
  });
});

test("cached latest rate expires after cacheTtlMs and refreshes from Frankfurter", async () => {
  let clock = 1_000;
  let calls = 0;
  const provider = createFrankfurterFxProvider({
    now: () => clock,
    cacheTtlMs: 60_000,
    client: {
      fetchJson: async () => {
        calls += 1;
        return {
          amount: 1,
          base: "EUR",
          date: calls === 1 ? "2026-08-04" : "2026-08-05",
          rates: { USD: calls === 1 ? 1.15 : 1.2 },
        };
      },
    },
  });

  const first = await provider.getLatestRate();
  expect(first.rate.rates.USD).toBe(1.15);
  expect(calls).toBe(1);

  clock += 30_000;
  const stillFresh = await provider.getLatestRate();
  expect(stillFresh.rate.rates.USD).toBe(1.15);
  expect(calls).toBe(1);

  clock += 30_000;
  const refreshed = await provider.getLatestRate();
  expect(refreshed.rate.rates.USD).toBe(1.2);
  expect(calls).toBe(2);
});

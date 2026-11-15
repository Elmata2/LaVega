import { expect, test, vi } from "vitest";
import type { FrankfurterFxProvider } from "@lavega/adapters";
import type { FxRateRepository, FxRateRow } from "@lavega/database";
import { createStoredFxProvider } from "./storedFxProvider.js";

const rate = (date: string, usd = 1.1): FxRateRow => ({
  base: "EUR",
  date,
  rates: { USD: usd },
});

function memoryStore(rows: FxRateRow[] = []): FxRateRepository & { rows: FxRateRow[] } {
  return {
    rows,
    async range(_base, from, to) {
      const start = rows.filter((row) => row.date <= from).at(-1)?.date ?? from;
      return rows.filter((row) => row.date >= start && row.date <= to);
    },
    async put(written) {
      for (const row of written) {
        const index = rows.findIndex((existing) => existing.date === row.date);
        if (index >= 0) rows[index] = row;
        else rows.push(row);
      }
      rows.sort((left, right) => left.date.localeCompare(right.date));
    },
  };
}

function frankfurter(rates: FxRateRow[], problems: string[] = []) {
  const getHistoricalRates = vi.fn(async (from: string, to: string) => ({
    rates: rates.filter((row) => row.date >= from && row.date <= to),
    problems,
  }));
  return { getHistoricalRates } as unknown as FrankfurterFxProvider & {
    getHistoricalRates: typeof getHistoricalRates;
  };
}

test("an empty store fetches the whole range once and keeps it", async () => {
  const store = memoryStore();
  const provider = frankfurter([rate("2024-01-05"), rate("2024-01-08")]);
  const fx = createStoredFxProvider(store, provider);

  expect((await fx.getHistoricalRates("2024-01-05", "2024-01-08")).rates).toHaveLength(2);
  expect(await fx.getHistoricalRates("2024-01-05", "2024-01-08")).toEqual({
    rates: [rate("2024-01-05"), rate("2024-01-08")],
    problems: [],
  });
  expect(provider.getHistoricalRates).toHaveBeenCalledOnce();
});

test("a stored start fetches only the days after the last stored rate", async () => {
  const store = memoryStore([rate("2024-01-05"), rate("2024-01-08")]);
  const provider = frankfurter([rate("2024-01-09"), rate("2024-01-10")]);
  const fx = createStoredFxProvider(store, provider);

  const result = await fx.getHistoricalRates("2024-01-06", "2024-01-10");

  expect(provider.getHistoricalRates).toHaveBeenCalledWith("2024-01-09", "2024-01-10");
  expect(result.rates.map((row) => row.date)).toEqual([
    "2024-01-05",
    "2024-01-08",
    "2024-01-09",
    "2024-01-10",
  ]);
  expect(store.rows).toHaveLength(4);
});

test("a failed fetch of new days still returns the stored ones, with the problem", async () => {
  const store = memoryStore([rate("2024-01-05")]);
  const provider = frankfurter([], ["Frankfurter historical FX request failed: timeout"]);
  const fx = createStoredFxProvider(store, provider);

  expect(await fx.getHistoricalRates("2024-01-05", "2024-01-10")).toEqual({
    rates: [rate("2024-01-05")],
    problems: ["Frankfurter historical FX request failed: timeout"],
  });
});

test("storage that fails leaves the provider answering as before", async () => {
  const store = memoryStore();
  store.range = async () => {
    throw new Error("relation investing.fx_rates does not exist");
  };
  const provider = frankfurter([rate("2024-01-05")]);
  const fx = createStoredFxProvider(store, provider);

  expect((await fx.getHistoricalRates("2024-01-05", "2024-01-05")).rates).toEqual([
    rate("2024-01-05"),
  ]);
});

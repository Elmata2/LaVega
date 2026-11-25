import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getLiveEcb, resetLiveFxForTests, RETRY_AFTER_MS } from "./liveFxRate";

const payload = {
  base: "EUR",
  date: "2026-08-14",
  rates: { NZD: 1.9 },
  origins: { NZD: "ecb" },
  layers: { ecb: { status: "live", date: "2026-08-14", count: 1 }, aggregator: null },
};

beforeEach(resetLiveFxForTests);
afterEach(() => {
  vi.unstubAllGlobals();
  resetLiveFxForTests();
});

function stubFetch(answers: Array<"fail" | "ok">) {
  const f = vi.fn(() => {
    const a = answers.shift() ?? "fail";
    return a === "fail"
      ? Promise.reject(new Error("offline"))
      : Promise.resolve({ ok: true, status: 200, json: async () => payload });
  });
  vi.stubGlobal("fetch", f);
  return f;
}

test("after two failed requests a later ask recovers without a reload", async () => {
  const f = stubFetch(["fail", "fail", "ok"]);
  expect(await getLiveEcb(0)).toBeNull();
  expect(await getLiveEcb(1_000)).toBeNull();
  expect(f).toHaveBeenCalledTimes(2);

  expect(await getLiveEcb(2_000)).toBeNull();
  expect(f).toHaveBeenCalledTimes(2);

  const rate = await getLiveEcb(1_000 + RETRY_AFTER_MS);
  expect(f).toHaveBeenCalledTimes(3);
  expect(rate?.rates.NZD).toBe(1.9);
  expect(await getLiveEcb(1_000 + RETRY_AFTER_MS + 1)).toBe(rate);
  expect(f).toHaveBeenCalledTimes(3);
});

test("a failing server is asked at most once per window, never in a loop", async () => {
  const f = stubFetch([]);
  for (let t = 0; t < 10; t++) await getLiveEcb(t * 1_000);
  expect(f).toHaveBeenCalledTimes(2);
  await getLiveEcb(10_000 + RETRY_AFTER_MS);
  await getLiveEcb(10_001 + RETRY_AFTER_MS);
  expect(f).toHaveBeenCalledTimes(3);
});

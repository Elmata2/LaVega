import { expect, test, vi } from "vitest";
import {
  firstProviderResult,
  hasProblems,
  type Provider,
} from "./providerRouter.js";

const provider = <Request, Result>(
  sourceKey: string,
  priority: number,
  result: Result | null | (() => Promise<Result | null>),
): Provider<Request, Result> => ({
  sourceKey,
  priority,
  get: typeof result === "function" ? result as () => Promise<Result | null> : async () => result,
});

test("lane returns first non-null result in priority order with provenance", async () => {
  const called: string[] = [];
  const lane = [
    { ...provider("yahoo", 10, null), get: async () => { called.push("yahoo"); return null; } },
    { ...provider("marketstack", 20, { close: 101 }), get: async () => { called.push("marketstack"); return { close: 101 }; } },
  ];

  await expect(firstProviderResult(lane, { symbol: "ASML" })).resolves.toEqual({ sourceKey: "marketstack", value: { close: 101 } });
  expect(called).toEqual(["marketstack"]);
});

test("lane skips provider errors and continues", async () => {
  const log = vi.fn();
  const lane = [provider("broken", 20, async () => { throw new Error("down"); }), provider("fallback", 10, "ok")];

  await expect(firstProviderResult(lane, {}, log)).resolves.toEqual({ sourceKey: "fallback", value: "ok" });
  expect(log).toHaveBeenCalledWith("broken", expect.any(Error));
});

test("price lane falls through provider problems to a healthy fallback", async () => {
  type PriceResult = { bars: Array<{ close: number }>; problems: string[] };
  const first: Provider<unknown, PriceResult> = { sourceKey: "yahoo", priority: 20, get: async () => ({ bars: [], problems: ["Yahoo blocked"] }) };
  const fallback: Provider<unknown, PriceResult> = { sourceKey: "fallback", priority: 10, get: async () => ({ bars: [{ close: 100 }], problems: [] }) };

  await expect(firstProviderResult([first, fallback], {}, undefined, hasProblems)).resolves.toEqual({
    sourceKey: "fallback",
    value: { bars: [{ close: 100 }], problems: ["Yahoo blocked"] },
  });
});

test("price lane preserves provider problems when all providers fail", async () => {
  const lane = [
    provider<unknown, { bars: unknown[]; problems: string[] }>("yahoo", 20, { bars: [], problems: ["Yahoo blocked"] }),
    provider<unknown, { bars: unknown[]; problems: string[] }>("fallback", 10, { bars: [], problems: ["Fallback unavailable"] }),
  ];

  await expect(firstProviderResult(lane, {}, undefined, hasProblems)).resolves.toEqual({
    sourceKey: "fallback",
    value: { bars: [], problems: ["Yahoo blocked", "Fallback unavailable"] },
  });
});

test("hasProblems reads the problems field without casts", () => {
  expect(hasProblems({ problems: ["blocked"] })).toBe(true);
  expect(hasProblems({ problems: [] })).toBe(false);
  expect(hasProblems({})).toBe(false);
});

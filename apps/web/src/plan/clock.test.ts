import { afterEach, expect, test, vi } from "vitest";
import { nowIso, todayIso } from "./clock";

afterEach(() => vi.useRealTimers());

test("the clock follows the system time", async () => {
  vi.useFakeTimers({ now: new Date("2026-11-02T08:15:00Z") });
  expect(await todayIso()).toBe("2026-11-02");
  expect(await nowIso()).toBe("2026-11-02T08:15:00.000Z");
});

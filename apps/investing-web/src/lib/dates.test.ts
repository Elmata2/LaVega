import { expect, test } from "vitest";
import { longDate, shortDate } from "./dates.js";

test("reads a calendar date as the day it names, wherever the reader sits", () => {
  expect(shortDate("2026-01-02")).toBe("2 jan 2026");
  expect(longDate("2026-01-02")).toBe("2 januari 2026");
  expect(shortDate("2026-01-01")).toBe("1 jan 2026");
});

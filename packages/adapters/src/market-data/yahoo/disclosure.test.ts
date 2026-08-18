import { expect, test } from "vitest";
import { hasSeenYahooFinanceDisclosure, markYahooFinanceDisclosureSeen } from "./disclosure.js";

test("disclosure is shown once per local storage", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } } as unknown as Storage;
  expect(hasSeenYahooFinanceDisclosure(storage)).toBe(false);
  markYahooFinanceDisclosureSeen(storage);
  expect(hasSeenYahooFinanceDisclosure(storage)).toBe(true);
});

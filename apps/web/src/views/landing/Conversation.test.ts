import { expect, test } from "vitest";
import { landingCopy } from "../../landingCopy.js";
import { holdMs } from "./Conversation.js";

const words = (n: number) => Array.from({ length: n }, () => "woord").join(" ");

test("a finished exchange stays at least 5 s", () => {
  expect(holdMs(words(3))).toBe(5000);
});

test("the hold scales with the answer at 300 ms a word", () => {
  expect(holdMs(words(25))).toBe(7500);
});

test("the hold stops at 9 s", () => {
  expect(holdMs(words(60))).toBe(9000);
});

test("every real answer stays long enough to read at about 3.5 words a second", () => {
  for (const locale of ["nl", "en"] as const) {
    for (const t of landingCopy(locale).acts.talks) {
      const n = t.a.trim().split(/\s+/).length;
      expect(holdMs(t.a), t.a).toBeGreaterThanOrEqual(Math.min(9000, (n / 3.5) * 1000));
    }
  }
});

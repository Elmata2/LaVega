import { expect, test } from "vitest";
import { weekdayLabel, weekdayShort } from "./format.js";

test("weekdayLabel: 0 is Monday, 6 is Sunday, in both locales", () => {
  expect(weekdayLabel("nl", 0)).toBe("Maandag");
  expect(weekdayLabel("en", 0)).toBe("Monday");
  expect(weekdayLabel("nl", 6)).toBe("Zondag");
  expect(weekdayLabel("en", 6)).toBe("Sunday");
});

test("weekdayShort: same index, short form", () => {
  expect(weekdayShort("nl", 0)).toBe("ma");
  expect(weekdayShort("en", 0)).toBe("Mon");
  expect(weekdayShort("nl", 6)).toBe("zo");
  expect(weekdayShort("en", 6)).toBe("Sun");
});

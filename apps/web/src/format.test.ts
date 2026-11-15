import { expect, test } from "vitest";
import { formatSignedEuroIn, formatSignedPercentIn, weekdayLabel, weekdayShort } from "./format.js";

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

const MINUS = "\u2212";

test("formatSignedEuroIn: nl carries + and a real minus, zero has no sign", () => {
  expect(formatSignedEuroIn("nl", 5)).toMatch(/^\+€\s5,00$/);
  expect(formatSignedEuroIn("nl", -5)).toMatch(new RegExp(`^${MINUS}€\\s5,00$`));
  expect(formatSignedEuroIn("nl", 0)).toMatch(/^€\s0,00$/);
  expect(formatSignedEuroIn("nl", 1234.5)).toMatch(/^\+€\s1\.234,50$/);
  expect(formatSignedEuroIn("nl", -1234.5)).not.toContain("-");
});

test("formatSignedEuroIn: en carries + and a real minus, zero has no sign", () => {
  expect(formatSignedEuroIn("en", 5)).toBe("+€5.00");
  expect(formatSignedEuroIn("en", -5)).toBe(`${MINUS}€5.00`);
  expect(formatSignedEuroIn("en", 0)).toBe("€0.00");
  expect(formatSignedEuroIn("en", 1234.5)).toBe("+€1,234.50");
  expect(formatSignedEuroIn("en", -1234.5)).toBe(`${MINUS}€1,234.50`);
});

test("formatSignedPercentIn: whole-number percent with + or real minus", () => {
  expect(formatSignedPercentIn("nl", 3)).toBe("+3%");
  expect(formatSignedPercentIn("en", -12)).toBe(`${MINUS}12%`);
  expect(formatSignedPercentIn("en", 0)).toBe("0%");
});

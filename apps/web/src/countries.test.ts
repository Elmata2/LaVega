import { expect, test } from "vitest";
import { COUNTRY_CODES, countryList, countryName, regionLabel, regionsFor } from "./countries.js";

/* Every country, in Dutch, sorted — and a region level only where LaVega
 * actually has one. The point of the tests is the honesty rules: no country
 * silently missing, no name invented, no subdivision list invented either. */

test("the list is ISO 3166-1 alpha-2, complete and without duplicates", () => {
  expect(COUNTRY_CODES.length).toBe(249);
  expect(new Set(COUNTRY_CODES).size).toBe(249);
  expect(COUNTRY_CODES.every((c) => /^[A-Z]{2}$/.test(c))).toBe(true);
  for (const c of ["NL", "BE", "DE", "US", "CA", "GB", "JP", "ZW"]) expect(COUNTRY_CODES).toContain(c);
});

test("names are Dutch, and every code resolves to one", () => {
  expect(countryName("NL")).toBe("Nederland");
  expect(countryName("US")).toBe("Verenigde Staten");
  expect(countryName("DE")).toBe("Duitsland");
  expect(countryList().every((c) => c.name.length > 0)).toBe(true);
});

test("an unresolvable code shows the CODE, never a blank and never a guess", () => {
  // "QQ" is unassigned, so the platform has no name for it. Printing an empty
  // row would be the app pretending the entry does not exist; the code itself
  // is the honest answer.
  expect(countryName("QQ")).toBe("QQ");
  // Not a country code at all: nothing to show, and nothing invented either.
  expect(countryName("")).toBe("");
  expect(countryName("Nederland")).toBe("");
});

test("the list is sorted the way a Dutch reader reads it", () => {
  const names = countryList().map((c) => c.name);
  expect([...names].sort((a, b) => a.localeCompare(b, "nl"))).toEqual(names);
});

test("a region list exists only where it is verified — his Texas/New York case", () => {
  const us = regionsFor("US");
  expect(us).toContain("Texas");
  expect(us).toContain("New York");
  expect(us.length).toBe(51); // 50 states + District of Columbia
  expect(new Set(us).size).toBe(51);
  expect(regionsFor("CA")).toContain("Quebec");
  expect(regionsFor("ca")).toContain("Ontario"); // case is not a different country
});

test("no invented subdivisions: a country we cannot vouch for gets no list", () => {
  expect(regionsFor("NL")).toEqual([]);
  expect(regionsFor("DE")).toEqual([]);
  expect(regionsFor("")).toEqual([]);
});

test("the level is called what it is called there", () => {
  expect(regionLabel("US")).toBe("Staat");
  expect(regionLabel("CA")).toBe("Provincie of territorium");
  expect(regionLabel("NL")).toBe("Regio of staat"); // true everywhere, claims nothing
});

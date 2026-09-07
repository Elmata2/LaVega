import { expect, test } from "vitest";
import { DEFAULT_LOCALE, alternatePath, hreflangLinks, isLandingPath, localeForPath } from "./locale.js";

test("Dutch is the default, and stays the canonical page", () => {
  expect(DEFAULT_LOCALE).toBe("nl");
  expect(localeForPath("/")).toBe("nl");
  expect(hreflangLinks("https://www.lavega.dev").find((l) => l.hreflang === "x-default")?.href)
    .toBe("https://www.lavega.dev/");
});

test("/en and its children are English", () => {
  expect(localeForPath("/en")).toBe("en");
  expect(localeForPath("/en/")).toBe("en");
});

test("a path that merely starts with the letters 'en' is not English", () => {
  // /entiteiten would be Dutch content; matching on a prefix rather than a
  // segment would have handed it the English copy.
  expect(localeForPath("/entiteiten")).toBe("nl");
  expect(localeForPath("/energie")).toBe("nl");
});

test("the vault app has no locale of its own", () => {
  expect(isLandingPath("/app")).toBe(false);
  expect(isLandingPath("/app/overview")).toBe(false);
  expect(isLandingPath("/")).toBe(true);
  expect(isLandingPath("/en")).toBe(true);
  expect(isLandingPath("/en/")).toBe(true);
});

test("the switcher points at the same page in the other language", () => {
  expect(alternatePath("nl")).toBe("/en");
  expect(alternatePath("en")).toBe("/");
});

test("hreflang declares both alternates so the pages do not compete", () => {
  const links = hreflangLinks("https://www.lavega.dev");
  expect(links.map((l) => l.hreflang).sort()).toEqual(["en", "nl", "x-default"]);
  expect(links.find((l) => l.hreflang === "en")?.href).toBe("https://www.lavega.dev/en");
});

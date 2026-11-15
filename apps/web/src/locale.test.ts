// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { landingCopy } from "./landingCopy.js";
import {
  applyDocumentLocale,
  DEFAULT_LOCALE,
  alternatePath,
  hreflangLinks,
  isLandingPath,
  localeForPath,
  LOCALE_COOKIE,
  rememberLocale,
} from "./locale.js";

test("Dutch is the default, and stays the canonical page", () => {
  expect(DEFAULT_LOCALE).toBe("nl");
  expect(localeForPath("/")).toBe("nl");
  expect(
    hreflangLinks("https://www.lavega.dev").find((l) => l.hreflang === "x-default")?.href,
  ).toBe("https://www.lavega.dev/");
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

test("an explicit switcher click is remembered in a cookie", () => {
  const spy = vi.spyOn(document, "cookie", "set");

  rememberLocale("en");
  expect(spy).toHaveBeenCalled();
  let written = spy.mock.calls.at(-1)![0];
  expect(written.startsWith(`${LOCALE_COOKIE}=en;`)).toBe(true);
  expect(written).toContain("Path=/");
  expect(written).toContain("Max-Age=31536000");
  expect(written).toContain("SameSite=Lax");
  // jsdom's default test origin is http:, so the cookie must not claim Secure.
  expect(written).not.toContain("Secure");

  rememberLocale("nl");
  written = spy.mock.calls.at(-1)![0];
  expect(written.startsWith(`${LOCALE_COOKIE}=nl;`)).toBe(true);

  spy.mockRestore();
});

test("the document title and description follow the locale", () => {
  applyDocumentLocale("nl");
  expect(document.documentElement.lang).toBe("nl");
  expect(document.title).toBe(landingCopy("nl").meta.title);
  expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(
    landingCopy("nl").meta.description,
  );

  applyDocumentLocale("en");
  expect(document.documentElement.lang).toBe("en");
  expect(document.title).toBe(landingCopy("en").meta.title);
  expect(document.querySelector('meta[name="description"]')?.getAttribute("content")).toBe(
    landingCopy("en").meta.description,
  );
});

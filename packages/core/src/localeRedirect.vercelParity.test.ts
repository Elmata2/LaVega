// Mirrors the two locale-redirect route objects in scripts/vercel-build.mjs —
// keep both in sync. This test fails if they diverge.
import { expect, test } from "vitest";
import { localeRedirectTarget } from "./localeRedirect.js";
import { LOCALE_REDIRECT_FIXTURES } from "./localeRedirect.fixtures.js";

type CookieCondition = { type: "cookie"; key: string; value?: string };
type HeaderCondition = { type: "header"; key: string; value: string };
type LocaleRedirectRoute = {
  src: string;
  has?: Array<CookieCondition | HeaderCondition>;
  missing?: Array<CookieCondition>;
  status: number;
  headers: { Location: string; Vary: string };
};

const LOCALE_REDIRECT_ROUTES: LocaleRedirectRoute[] = [
  {
    src: "/",
    has: [{ type: "cookie", key: "lavega_locale", value: "^en$" }],
    status: 302,
    headers: { Location: "/en", Vary: "Accept-Language, Cookie" },
  },
  {
    src: "/",
    missing: [{ type: "cookie", key: "lavega_locale" }],
    has: [{ type: "header", key: "accept-language", value: "^[Ee][Nn].*" }],
    status: 302,
    headers: { Location: "/en", Vary: "Accept-Language, Cookie" },
  },
];

function readCookie(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const pair of cookieHeader.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() === name) return pair.slice(eq + 1).trim();
  }
  return null;
}

function evaluateLocaleRoutes(
  routes: LocaleRedirectRoute[],
  request: { cookieHeader: string | null | undefined; acceptLanguage: string | null | undefined },
): "/en" | null {
  for (const route of routes) {
    const hasOk = (route.has ?? []).every((cond) => {
      if (cond.type === "cookie") {
        const value = readCookie(request.cookieHeader, cond.key);
        return value !== null && cond.value !== undefined && new RegExp(cond.value).test(value);
      }
      return (
        request.acceptLanguage !== null &&
        request.acceptLanguage !== undefined &&
        new RegExp(cond.value).test(request.acceptLanguage)
      );
    });
    if (!hasOk) continue;
    const missingOk = (route.missing ?? []).every(
      (cond) => readCookie(request.cookieHeader, cond.key) === null,
    );
    if (!missingOk) continue;
    return route.headers.Location as "/en" | null;
  }
  return null;
}

for (const fx of LOCALE_REDIRECT_FIXTURES) {
  test(fx.name, () => {
    const viaRoutes = evaluateLocaleRoutes(LOCALE_REDIRECT_ROUTES, {
      cookieHeader: fx.cookieHeader,
      acceptLanguage: fx.acceptLanguage,
    });
    const viaFunction = localeRedirectTarget(fx.acceptLanguage, fx.cookieHeader);
    expect(viaRoutes).toBe(viaFunction);
    expect(viaRoutes).toBe(fx.expected);
    expect(viaFunction).toBe(fx.expected);
  });
}

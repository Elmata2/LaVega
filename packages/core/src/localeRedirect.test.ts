import { expect, test } from "vitest";
import { localeRedirectTarget } from "./localeRedirect.js";
import { LOCALE_REDIRECT_FIXTURES } from "./localeRedirect.fixtures.js";

for (const fx of LOCALE_REDIRECT_FIXTURES) {
  test(fx.name, () => {
    expect(localeRedirectTarget(fx.acceptLanguage, fx.cookieHeader)).toBe(fx.expected);
  });
}

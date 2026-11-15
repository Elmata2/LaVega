export type LocaleRedirectFixture = {
  name: string;
  acceptLanguage: string | null | undefined;
  cookieHeader: string | null | undefined;
  expected: "/en" | null;
};

export const LOCALE_REDIRECT_FIXTURES = [
  {
    name: "English device, no cookie",
    acceptLanguage: "en-US,en;q=0.9,nl;q=0.8",
    cookieHeader: undefined,
    expected: "/en",
  },
  {
    name: "Dutch device, no cookie (second tag is en but only the first tag counts)",
    acceptLanguage: "nl-NL,en;q=0.9",
    cookieHeader: undefined,
    expected: null,
  },
  {
    name: "cookie=nl overrides an English device",
    acceptLanguage: "en-US,en;q=0.9",
    cookieHeader: "lavega_locale=nl",
    expected: null,
  },
  {
    name: "cookie=en overrides a Dutch device",
    acceptLanguage: "nl-NL,en;q=0.9",
    cookieHeader: "lavega_locale=en",
    expected: "/en",
  },
  {
    name: "cookie value that's neither en nor nl (garbage)",
    acceptLanguage: "en-US",
    cookieHeader: "lavega_locale=fr",
    expected: null,
  },
  {
    name: "cookie present among other cookies",
    acceptLanguage: undefined,
    cookieHeader: "other=1; lavega_locale=en; another=2",
    expected: "/en",
  },
  {
    name: "no headers at all (bot)",
    acceptLanguage: undefined,
    cookieHeader: undefined,
    expected: null,
  },
  {
    name: "empty Accept-Language header",
    acceptLanguage: "",
    cookieHeader: undefined,
    expected: null,
  },
  {
    name: "case-insensitive Accept-Language",
    acceptLanguage: "EN-us,nl;q=0.5",
    cookieHeader: undefined,
    expected: "/en",
  },
] as const satisfies readonly LocaleRedirectFixture[];

export const LOCALE_COOKIE = "lavega_locale";

/** Where a request for `/` should go, or null to serve Dutch.
 *  A `lavega_locale` cookie always wins (`en` -> "/en", anything else -> null).
 *  Without one, only the FIRST Accept-Language tag decides. No header at all —
 *  what search bots send — also serves Dutch, since that's the page the SEO
 *  plan depends on being indexed. */
export function localeRedirectTarget(
  acceptLanguage: string | null | undefined,
  cookieHeader: string | null | undefined,
): "/en" | null {
  const cookieValue = readCookie(cookieHeader, LOCALE_COOKIE);
  if (cookieValue !== null) return cookieValue === "en" ? "/en" : null;
  const firstTag = firstLanguageTag(acceptLanguage);
  return firstTag !== null && firstTag.toLowerCase().startsWith("en") ? "/en" : null;
}

function readCookie(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const pair of cookieHeader.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() === name) return pair.slice(eq + 1).trim();
  }
  return null;
}

function firstLanguageTag(acceptLanguage: string | null | undefined): string | null {
  if (!acceptLanguage || acceptLanguage.trim() === "") return null;
  const first = acceptLanguage.split(",")[0] ?? "";
  return first.split(";")[0]?.trim() || null;
}

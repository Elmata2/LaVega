/**
 * Two locales for the public landing page, and only the landing page.
 *
 * Dutch is the default and stays the canonical page. That is not a stylistic
 * choice: the acquisition plan rests on one high-intent Dutch search cluster,
 * and an English page that competed with it — or replaced it — would damage the
 * only channel the model depends on. English exists for a different audience
 * (investors, the CEMS network, partners abroad) who reach the site by link,
 * not by search.
 *
 * The app behind the waitlist is Dutch throughout and is untouched by this.
 */

import { landingCopy } from "./landingCopy.js";

export type Locale = "nl" | "en";

export const DEFAULT_LOCALE: Locale = "nl";
export const EN_BASE = "/en";

/** The locale a path asks for. `/en` and anything under it is English. */
export function localeForPath(pathname: string): Locale {
  return pathname === EN_BASE || pathname.startsWith(`${EN_BASE}/`) ? "en" : DEFAULT_LOCALE;
}

/** Is this a landing path at all? `/app/*` is the vault and has no locale. */
export function isLandingPath(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "") || "/";
  return p === "/" || p === EN_BASE;
}

/** The same page in the other language — what the switcher links to. */
export function alternatePath(locale: Locale): string {
  return locale === "en" ? "/" : EN_BASE;
}

/** `<html lang>` has to follow, or a screen reader reads English in Dutch. The
 *  title and meta description follow too — without them a shared or bookmarked
 *  English link still shows the Dutch pitch in the tab. Client-side only: a
 *  crawler that does not run JavaScript still sees index.html's static head. */
export function applyDocumentLocale(locale: Locale): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale;
  const copy = landingCopy(locale);
  document.title = copy.meta.title;
  let meta = document.querySelector('meta[name="description"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "description");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", copy.meta.description);
}

export const LOCALE_COOKIE = "lavega_locale";

/** Persists an explicit switcher click past the visit that made it, so a
 *  choice made once does not have to be repeated on every return to the site. */
export function rememberLocale(locale: Locale): void {
  if (typeof document === "undefined") return;
  const secure =
    typeof location !== "undefined" && location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
}

/**
 * Tell search engines the two pages are alternates, not duplicates.
 *
 * Without this a translated page reads as competing content and can suppress
 * the Dutch one — the exact opposite of what this is for. `x-default` points at
 * Dutch because that is the canonical page.
 */
export function hreflangLinks(origin: string): Array<{ hreflang: string; href: string }> {
  return [
    { hreflang: "nl", href: `${origin}/` },
    { hreflang: "en", href: `${origin}${EN_BASE}` },
    { hreflang: "x-default", href: `${origin}/` },
  ];
}

export function applyHreflang(origin: string): void {
  if (typeof document === "undefined") return;
  for (const old of document.querySelectorAll('link[rel="alternate"][data-lavega-hreflang]'))
    old.remove();
  for (const { hreflang, href } of hreflangLinks(origin)) {
    const link = document.createElement("link");
    link.rel = "alternate";
    link.hreflang = hreflang;
    link.href = href;
    link.setAttribute("data-lavega-hreflang", "");
    document.head.appendChild(link);
  }
}

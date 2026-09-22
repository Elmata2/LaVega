import { useEffect, useState } from "react";
import { LOCALE_COOKIE, rememberLocale, type Locale } from "./locale.js";

/* The language the VAULT APP runs in, as opposed to the public landing page.
 *
 * Both read the same `lavega_locale` cookie, so someone who lands on `/en`
 * and then signs in stays in English without choosing twice. The difference
 * is the fallback: the landing defaults to Dutch because the Dutch page is
 * the canonical one for search, while the app defaults to ENGLISH for anyone
 * whose browser is not Dutch — the app is now used by testers abroad, and a
 * Dutch-only screen is useless to them, whereas an English screen is merely
 * second-best for a Dutch speaker who can switch in one click.
 *
 * The legal pages stay Dutch in both languages. They are the operative
 * documents of a Dutch company and a translation someone relies on is a
 * liability, not a courtesy. */

const LOCALE_EVENT = "lavega:locale";

export function readAppLocale(): Locale {
  try {
    const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]*)`));
    const v = m?.[1]?.trim();
    if (v === "nl" || v === "en") return v;
  } catch {
    /* cookies blocked — fall through to the browser's own languages */
  }
  try {
    const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
    for (const l of langs)
      if (typeof l === "string" && l.toLowerCase().startsWith("nl")) return "nl";
  } catch {
    /* no navigator (SSR, tests) */
  }
  return "en";
}

/** Persist the choice and tell every mounted `useAppLocale` about it, so the
 *  whole app switches language without a reload. */
export function setAppLocale(locale: Locale): void {
  rememberLocale(locale);
  try {
    window.dispatchEvent(new CustomEvent(LOCALE_EVENT, { detail: locale }));
  } catch {
    /* no window — nothing is mounted to notify */
  }
}

export function useAppLocale(): [Locale, (locale: Locale) => void] {
  const [locale, setLocale] = useState<Locale>(readAppLocale);
  useEffect(() => {
    const onChange = () => setLocale(readAppLocale());
    window.addEventListener(LOCALE_EVENT, onChange);
    return () => window.removeEventListener(LOCALE_EVENT, onChange);
  }, []);
  return [locale, setAppLocale];
}

/** Pick one of two values by locale. Copy modules are shaped
 *  `Record<Locale, T>`, so components read `copy[locale]` directly; this is
 *  for the handful of one-off strings that do not earn a copy entry. */
export function pick<T>(locale: Locale, nl: T, en: T): T {
  return locale === "nl" ? nl : en;
}

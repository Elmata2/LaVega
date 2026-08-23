/* Personal SPA paths. Landing stays at `/`. The vault app lives under `/app`
 * with one segment per view so a URL can open Overzicht, Transacties, etc.
 * Legacy `/#app` and `/?eb=…` still enter the app (Root normalises them). */

export type View =
  | "overview"
  | "transactions"
  | "accounts"
  | "rules"
  | "forecast"
  | "optimalisatie"
  | "valuta"
  | "belasting"
  | "facturen"
  | "punten"
  | "koppelingen"
  | "backup"
  | "profiel";

export const APP_BASE = "/app";

const VIEW_BY_SEGMENT: Record<string, View> = {
  overview: "overview",
  transactions: "transactions",
  accounts: "accounts",
  rules: "rules",
  forecast: "forecast",
  optimalisatie: "optimalisatie",
  valuta: "valuta",
  belasting: "belasting",
  facturen: "facturen",
  punten: "punten",
  koppelingen: "koppelingen",
  backup: "backup",
  profiel: "profiel",
};

/** Path for a view. Overview is `/app` (and also `/app/overview`). */
export function pathForView(view: View): string {
  return view === "overview" ? APP_BASE : `${APP_BASE}/${view}`;
}

/** Resolve a pathname to a view, or null if it is not an app path. */
export function viewFromPathname(pathname: string): View | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === APP_BASE || path === `${APP_BASE}/overview`) return "overview";
  if (!path.startsWith(`${APP_BASE}/`)) return null;
  const segment = path.slice(APP_BASE.length + 1).split("/")[0] ?? "";
  return VIEW_BY_SEGMENT[segment] ?? null;
}

/** True when this pathname should mount the vault app (known or unknown /app/…). */
export function isAppPathname(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "") || "/";
  return path === APP_BASE || path.startsWith(`${APP_BASE}/`);
}

/** Rewrite legacy `#app` / `/?eb=` into `/app` paths. Safe to call on every load. */
export function normalizeAppLocation(
  loc: Pick<Location, "pathname" | "search" | "hash"> = window.location,
  replace: (url: string) => void = (url) => window.history.replaceState({}, "", url),
): void {
  const { pathname, search, hash } = loc;
  if (hash === "#app") {
    replace(`${APP_BASE}${search}`);
    return;
  }
  if ((search.includes("eb=") || search.includes("eb_error=")) && !isAppPathname(pathname)) {
    replace(`${APP_BASE}${search}`);
  }
}

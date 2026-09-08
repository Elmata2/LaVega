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

export type PendingEbParams = { session: string | null; error: string | null };

/* The Enable Banking session id (and any eb_error) travel back from the
 * server as a URL query param. That leaves them in browser history and any
 * referrer until something strips the URL, so normalizeAppLocation captures
 * them here the moment they're read and never writes them back to the URL.
 * App.tsx collects them later, once the vault is unlocked, via
 * takePendingEbParams — a one-shot, in-memory handoff that a page reload
 * naturally clears (the URL has already been stripped by then). */
let pendingEbParams: PendingEbParams | null = null;

/** Consume the pending Enable Banking params captured by normalizeAppLocation,
 *  or null if none are pending. Clears them so a re-render never re-processes
 *  the same callback twice. */
export function takePendingEbParams(): PendingEbParams | null {
  const params = pendingEbParams;
  pendingEbParams = null;
  return params;
}

/** Rewrite legacy `#app` into `/app`, and strip `eb=`/`eb_error=` off the URL
 *  immediately (see PendingEbParams above). Safe to call on every load. */
export function normalizeAppLocation(
  loc: Pick<Location, "pathname" | "search" | "hash"> = window.location,
  replace: (url: string) => void = (url) => window.history.replaceState({}, "", url),
): void {
  const { pathname, search, hash } = loc;
  const params = new URLSearchParams(search);
  const ebSession = params.get("eb");
  const ebError = params.get("eb_error");
  const hasEb = ebSession !== null || ebError !== null;
  const legacyHash = hash === "#app";
  if (!hasEb && !legacyHash) return;
  if (hasEb) {
    pendingEbParams = { session: ebSession, error: ebError };
    params.delete("eb");
    params.delete("eb_error");
  }
  const rest = params.toString();
  const target = !legacyHash && isAppPathname(pathname) ? pathname : APP_BASE;
  replace(`${target}${rest ? `?${rest}` : ""}`);
}

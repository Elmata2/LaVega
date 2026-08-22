/* Where the investing app lives.
 *
 * apps/investing-web (served by apps/investing-server) is a separate deploy,
 * not a route inside this SPA — it has no `View` and never will (see
 * moduleRegistry.tsx: a ModuleId is always a View). So the topbar / landing
 * entry is a plain cross-document <a> and all it needs is an origin, or a path.
 *
 * It used to need nothing at all, because the origin was hardcoded to
 * http://127.0.0.1:8790 — the port scripts/rebuild-investing-orbstack.sh
 * publishes on a developer machine. On lavega.dev that link opened a browser
 * error page. The URL is configuration. Production Docker bakes
 * `VITE_INVESTING_URL=/investing` on the all-in-one deploy; override with a full
 * origin when investing runs on its own host. `investingReachable` remains for
 * optional liveness checks. */

export type InvestingEnv = { VITE_INVESTING_URL?: string; DEV?: boolean };

/** Resolve where the investing app is, or null for "don't offer it".
 *
 *  - `VITE_INVESTING_URL` set to an origin (`https://investing.lavega.dev`) or
 *    a same-origin path (`/beleggen`) — that, minus any trailing slash.
 *  - set but blank — off; the link is not rendered at all.
 *  - unset, dev — the local container from rebuild-investing-orbstack.sh.
 *  - unset, production — `/investing` on this origin (served by the all-in-one
 *    Docker image when `INVESTING_MOUNT` is on). */
export function resolveInvestingUrl(env: InvestingEnv): string | null {
  const configured = env.VITE_INVESTING_URL;
  if (configured !== undefined) {
    const trimmed = configured.trim().replace(/\/+$/, "");
    return trimmed === "" ? null : trimmed;
  }
  return env.DEV ? "http://127.0.0.1:8790" : "/investing";
}

export const INVESTING_URL: string | null = resolveInvestingUrl(import.meta.env as InvestingEnv);

/** Is the investing app reachable at `url`? Answers false rather than throwing.
 *
 *  Same origin can be verified properly, and has to be: the SPA's catch-all
 *  route answers 200 with index.html for any unknown path, so only the
 *  investing server's own `{ok:true}` health body counts.
 *
 *  A cross-origin URL cannot be read — the investing server sends no CORS
 *  headers, so the response is opaque and its status is invisible. What remains
 *  visible is the one distinction that matters here: a server answered, versus
 *  the connection was refused. `mode: "no-cors"` resolves in the first case and
 *  rejects in the second. */
export async function investingReachable(
  url: string | null,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<boolean> {
  if (!url) return false;
  const health = `${url}/health`;
  try {
    if (url.startsWith("/")) {
      const res = await fetchImpl(health, { cache: "no-store" });
      if (!res.ok) return false;
      const body = (await res.json()) as { ok?: unknown };
      return body?.ok === true;
    }
    await fetchImpl(health, { mode: "no-cors", cache: "no-store" });
    return true;
  } catch {
    // Connection refused, DNS failure, a mixed-content or private-network block,
    // or index.html where JSON was expected. All of them mean the same thing to
    // the person clicking: there is nothing there.
    return false;
  }
}

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
 * optional liveness checks — read its doc comment before trusting it, because
 * what it can and cannot see is narrower than the name suggests. */

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

/** Does something answer at `url`? Answers false rather than throwing.
 *
 *  Read the name as "the server is up", not "the page works". This checks one
 *  health endpoint and nothing else, and the two are genuinely different
 *  states: the investing SPA once served a fully healthy shell whose <script>
 *  pointed at the wrong path, so `/investing/health` answered
 *  `{ok:true,"service":"investing-server"}` — this function returned true — while
 *  every visitor got a blank page. Nothing reachable from here can see that.
 *  Whether the emitted HTML points at assets that exist is settled at build
 *  time instead, by apps/investing-web/src/base-guard.ts, which the root
 *  Dockerfile runs as a gate; do not re-implement it as a second fetch here.
 *
 *  Also worth knowing before wiring this to anything: it currently has no
 *  caller. NavBar and Landing render the link unconditionally from
 *  INVESTING_URL, so a false here hides nothing today.
 *
 *  Same origin can be verified properly, and has to be: the SPA's catch-all
 *  route answers 200 with index.html for unknown VIEW paths, so only the
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

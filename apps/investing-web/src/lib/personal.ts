/* Where the personal app lives — the mirror of apps/web/src/investing.ts.
 *
 * The personal vault (apps/web) is a separate deploy, not a route inside this
 * SPA, so the way back is a plain cross-document <a> exactly like the way here
 * is. Resolved the same way and for the same reasons, because a link that is
 * hardcoded to one developer's port is a link that opens a browser error page
 * in production — which is what the investing link did before it became
 * configuration.
 *
 *   - `VITE_PERSONAL_URL` set to an origin (`https://www.lavega.dev/app`) or a
 *     same-origin path (`/app`) — that, minus any trailing slash.
 *   - set but blank — off; no link is rendered.
 *   - unset, dev — the personal app's Vite port.
 *   - unset, production — `/app` on this origin, which is where the all-in-one
 *     deploy serves it. */

export type PersonalEnv = { VITE_PERSONAL_URL?: string; DEV?: boolean };

export function resolvePersonalUrl(env: PersonalEnv): string | null {
  const configured = env.VITE_PERSONAL_URL;
  if (configured !== undefined) {
    const trimmed = configured.trim().replace(/\/+$/, "");
    return trimmed === "" ? null : trimmed;
  }
  return env.DEV ? "http://127.0.0.1:5173/app" : "/app";
}

export const PERSONAL_URL: string | null = resolvePersonalUrl(
  import.meta.env as unknown as PersonalEnv,
);

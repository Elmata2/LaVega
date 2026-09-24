// Reads the /app cookie-gate route objects straight out of
// scripts/vercel-build.mjs (between its APP_GATE_ROUTES_START/END markers)
// rather than hand-copying them — real parity, not a copy that can silently
// drift. See packages/core/src/localeRedirect.vercelParity.test.ts for the
// sibling case (a server-only rule being dead on Vercel): requireAppSession
// in ./index.ts is Layer 3 of the /app gate and never runs on Vercel, where
// the static build answers /app straight from the CDN. This is Layer 2, the
// edge funnel gate ahead of that static route — cookie PRESENCE only, not
// validity, so there is no shared production function to import the way
// localeRedirectTarget is (Layer 2 deliberately does not reuse Layer 3's
// real session check).
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { expect, test } from "vitest";

type CookieCondition = { type: "cookie"; key: string };
type AppGateRoute = {
  src: string;
  missing: CookieCondition[];
  status: number;
  headers: { Location: string; Vary: string; "Cache-Control": string };
};
type StaticAppRoute = { src: string; dest: string };

async function readAppGateRoutes(): Promise<AppGateRoute[]> {
  const scriptPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../../../scripts/vercel-build.mjs",
  );
  const source = await readFile(scriptPath, "utf8");
  const start = source.indexOf("// APP_GATE_ROUTES_START");
  const end = source.indexOf("// APP_GATE_ROUTES_END");
  if (start === -1 || end === -1 || end < start)
    throw new Error("appGateCookie.vercelParity: markers not found in scripts/vercel-build.mjs");
  const body = source.slice(start + "// APP_GATE_ROUTES_START".length, end);
  // The markers bound plain JS object literals (no external references), so
  // this is a safe, sandboxed way to get the REAL array vercel-build.mjs
  // ships, not a hand-typed copy of it.
  return new Function(`"use strict"; return [${body}];`)() as AppGateRoute[];
}

const STATIC_APP_ROUTES: StaticAppRoute[] = [
  { src: "/app/(.*)", dest: "/index.html" },
  { src: "/app", dest: "/index.html" },
];

function readCookie(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const pair of cookieHeader.split(";")) {
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    if (pair.slice(0, eq).trim() === name) return pair.slice(eq + 1).trim();
  }
  return null;
}

/** What scripts/vercel-build.mjs's `routes` array does with these route
 *  objects, for a request to `pathname` carrying `cookieHeader`: "bounce" if
 *  a gate route's `src` matches and its cookie is missing, else "serve" once
 *  a static route's `src` matches. Routes are evaluated in array order, the
 *  same as Vercel's routing engine. */
function evaluateAppRoutes(
  routes: Array<AppGateRoute | StaticAppRoute>,
  request: { pathname: string; cookieHeader: string | null | undefined },
): "bounce" | "serve" | "unmatched" {
  const matches = (src: string) => new RegExp(`^${src}$`).test(request.pathname);
  for (const route of routes) {
    if (!matches(route.src)) continue;
    if ("missing" in route) {
      const stillMissing = route.missing.every(
        (cond) => readCookie(request.cookieHeader, cond.key) === null,
      );
      if (!stillMissing) continue; // cookie present — this gate route does not apply, keep looking
      return "bounce";
    }
    return "serve";
  }
  return "unmatched";
}

// Proven empirically against better-auth 1.7.1's getCookies() with the exact
// options apps/server/src/auth.ts passes (baseURL from authBaseUrl(), the
// pinned advanced.defaultCookieAttributes, no cookiePrefix override): an
// https baseURL — true for every Vercel deployment, prod or preview, since
// VERCEL_URL is always an https hostname — makes better-auth prefix the
// cookie name with "__Secure-". A plain http baseURL (local dev) does not.
const APP_SESSION_COOKIE = "__Secure-better-auth.session_token";

test("scripts/vercel-build.mjs gates /app on the real better-auth session cookie name", async () => {
  const routes = await readAppGateRoutes();
  for (const route of routes) expect(route.missing).toEqual([{ type: "cookie", key: APP_SESSION_COOKIE }]);
});

test("the missing-cookie bounce is ordered ahead of the static /app route, for both /app and /app/(.*)", async () => {
  const routes = [...(await readAppGateRoutes()), ...STATIC_APP_ROUTES];
  const gateIndex = (src: string) => routes.findIndex((r) => "missing" in r && r.src === src);
  const staticIndex = (src: string) => routes.findIndex((r) => !("missing" in r) && r.src === src);
  expect(gateIndex("/app")).toBeGreaterThanOrEqual(0);
  expect(gateIndex("/app/(.*)")).toBeGreaterThanOrEqual(0);
  expect(gateIndex("/app")).toBeLessThan(staticIndex("/app"));
  expect(gateIndex("/app/(.*)")).toBeLessThan(staticIndex("/app/(.*)"));
});

test("no session cookie at all bounces /app to /", async () => {
  const routes = [...(await readAppGateRoutes()), ...STATIC_APP_ROUTES];
  expect(evaluateAppRoutes(routes, { pathname: "/app", cookieHeader: undefined })).toBe("bounce");
});

test("no session cookie at all bounces a deep /app/<view> path to /", async () => {
  const routes = [...(await readAppGateRoutes()), ...STATIC_APP_ROUTES];
  expect(
    evaluateAppRoutes(routes, { pathname: "/app/transacties", cookieHeader: undefined }),
  ).toBe("bounce");
});

test("other cookies present but not the session cookie still bounces", async () => {
  const routes = [...(await readAppGateRoutes()), ...STATIC_APP_ROUTES];
  expect(
    evaluateAppRoutes(routes, { pathname: "/app", cookieHeader: "lavega_locale=nl; other=1" }),
  ).toBe("bounce");
});

test("the session cookie present, even with a garbage value, serves the static shell (presence, not validity)", async () => {
  const routes = [...(await readAppGateRoutes()), ...STATIC_APP_ROUTES];
  expect(
    evaluateAppRoutes(routes, {
      pathname: "/app",
      cookieHeader: `${APP_SESSION_COOKIE}=not-a-real-token`,
    }),
  ).toBe("serve");
  expect(
    evaluateAppRoutes(routes, {
      pathname: "/app/transacties",
      cookieHeader: `${APP_SESSION_COOKIE}=not-a-real-token`,
    }),
  ).toBe("serve");
});

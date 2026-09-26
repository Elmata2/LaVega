import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { EbConfig } from "./config.js";
import type { FxHistoryResponse } from "./fxHistory.js";

// Deterministic — doesn't depend on whether a real (git-ignored) config.json
// happens to exist on disk. loadConfig's own "missing/placeholder file"
// behavior is unit-tested in config.test.ts.
const { loadConfigMock } = vi.hoisted(() => ({ loadConfigMock: vi.fn<() => EbConfig>() }));

vi.mock("./config.js", async () => {
  const actual = await vi.importActual<typeof import("./config.js")>("./config.js");
  return { ...actual, loadConfig: loadConfigMock };
});

/* The /app gate asks auth.js whether this request carries a verified session,
 * same mocking pattern as apiGuard.test.ts — a test can be "logged in"
 * without a Neon database. */
const { verifiedSessionMock } = vi.hoisted(() => ({ verifiedSessionMock: vi.fn() }));
vi.mock("./auth.js", async () => {
  const actual = await vi.importActual<typeof import("./auth.js")>("./auth.js");
  return { ...actual, verifiedSession: verifiedSessionMock };
});

// getFxHistory hits the network (ECB via Frankfurter); mocked so the 503 and
// 200 paths of the route are deterministic and don't depend on the real
// service being up.
const { getFxHistoryMock } = vi.hoisted(() => ({
  getFxHistoryMock: vi.fn<() => Promise<FxHistoryResponse | null>>(),
}));

vi.mock("./fxHistory.js", async () => {
  const actual = await vi.importActual<typeof import("./fxHistory.js")>("./fxHistory.js");
  return { ...actual, getFxHistory: getFxHistoryMock };
});

const { app, isStaticAssetPath } = await import("./index.js");

beforeEach(() => {
  verifiedSessionMock.mockResolvedValue(null); // nobody is logged in
  delete process.env.LAVEGA_ALLOW_UNAUTHENTICATED;
});

afterEach(() => {
  loadConfigMock.mockReset();
  getFxHistoryMock.mockReset();
  verifiedSessionMock.mockReset();
  delete process.env.LAVEGA_ALLOW_UNAUTHENTICATED;
});

test("GET /health returns ok:true", async () => {
  const res = await app.request("/health");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

test("GET /api/eb/status reports configured:false and applicationId:null when not configured", async () => {
  loadConfigMock.mockReturnValue({
    configured: false,
    applicationId: null,
    privateKey: null,
    privateKeyFile: null,
    redirectUrl: "http://localhost:8787/api/eb/callback",
    psuType: "business",
    keySource: "missing",
    keyShape: { kind: "none", length: 0 },
  });
  const res = await app.request("/api/eb/status");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    configured: false,
    applicationId: null,
    privateKey: "missing",
    privateKeyShape: { kind: "none", length: 0 },
  });
});

test("GET /api/eb/status masks the applicationId when configured", async () => {
  loadConfigMock.mockReturnValue({
    configured: true,
    applicationId: "abcd1234efgh5678",
    privateKey: null,
    privateKeyFile: "./key.pem",
    redirectUrl: "http://localhost:8787/api/eb/callback",
    psuType: "business",
    keySource: "file",
    keyShape: { kind: "none", length: 0 },
  });
  const res = await app.request("/api/eb/status");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    configured: true,
    applicationId: "abcd1234…",
    privateKey: "file",
    privateKeyShape: { kind: "none", length: 0 },
  });
});

test("GET /api/rates returns a valid rates payload with open CORS", async () => {
  const res = await app.request("/api/rates");
  expect(res.status).toBe(200);
  expect(res.headers.get("access-control-allow-origin")).toBe("*");
  const body = await res.json();
  expect(typeof body.asOf).toBe("string");
  expect(Array.isArray(body.rates)).toBe(true);
  expect(body.rates[0]).toMatchObject({
    bank: expect.any(String),
    ratePct: expect.any(Number),
    freeWithdrawal: expect.any(Boolean),
  });
});

/* --- /api/fx/history's Cache-Control must track the outcome, not be blanket.
 * A malformed request or an ECB outage used to get the same hour-long
 * cacheable header as a real success, so a cache could serve a stale error
 * for up to an hour after the caller fixed their request or ECB recovered. --- */

test("GET /api/fx/history with an invalid currency is a 400 with Cache-Control: no-store", async () => {
  const res = await app.request("/api/fx/history?currency=XX&from=2026-08-01");
  expect(res.status).toBe(400);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(getFxHistoryMock).not.toHaveBeenCalled();
});

test("GET /api/fx/history when getFxHistory fails is a 503 with Cache-Control: no-store", async () => {
  getFxHistoryMock.mockResolvedValue(null);
  const res = await app.request("/api/fx/history?currency=HUF&from=2026-08-01");
  expect(res.status).toBe(503);
  expect(res.headers.get("cache-control")).toBe("no-store");
});

test("GET /api/fx/history on success still returns Cache-Control: public, max-age=3600", async () => {
  getFxHistoryMock.mockResolvedValue({
    base: "EUR",
    currency: "HUF",
    rates: { "2026-08-03": 363.98 },
  });
  const res = await app.request("/api/fx/history?currency=HUF&from=2026-08-01");
  expect(res.status).toBe(200);
  expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
});

/* --- Dev CORS. Without this, an agent call from Vite on :5173 is blocked by the
 * browser, App.tsx's status fetch falls into its catch, and the app reports "deze
 * server heeft geen AI-sleutel" while the server answers configured:true to curl.
 * That cost a real debugging round. --- */

test("a loopback origin gets CORS on the agent routes, and nobody else does", async () => {
  const allowed = await app.request("/api/agent/status", {
    headers: { Origin: "http://localhost:5174" },
  });
  expect(allowed.headers.get("access-control-allow-origin")).toBe("http://localhost:5174");
  expect(allowed.headers.get("vary")).toBe("Origin");

  // These routes spend the owner's Mistral key, so an open policy would let
  // any page on the internet spend it. Only loopback is echoed back.
  const stranger = await app.request("/api/agent/status", {
    headers: { Origin: "https://evil.example.com" },
  });
  expect(stranger.headers.get("access-control-allow-origin")).toBeNull();
});

test("the JSON preflight is answered, or the real POST never runs", async () => {
  const pre = await app.request("/api/agent/travel-facts", {
    method: "OPTIONS",
    headers: { Origin: "http://localhost:5173", "Access-Control-Request-Method": "POST" },
  });
  expect(pre.status).toBe(204);
  expect(pre.headers.get("access-control-allow-methods")).toContain("POST");
});

/* --- The static fallback used to answer everything with 200 + index.html. ---
 *
 * That is how the /investing blank page survived every check we had: the page's
 * <script> asked for /assets/index-DQzV9ttd.js, the personal SPA's catch-all
 * had no such file, and it replied with its own index.html at 200 text/html.
 * A module request answered with markup does not run and does not complain, so
 * /health was green, /investing/health was green, /investing/ was green, and the
 * one request that mattered was green too. Cloudflare then cached the HTML under
 * the .js URL for four hours. */

test("a missing asset is a 404, not the SPA shell with a 200", async () => {
  const res = await app.request("/assets/index-DQzV9ttd.js");
  expect(res.status).toBe(404);
  expect(res.headers.get("content-type") ?? "").not.toContain("text/html");
});

test("a missing stylesheet or source map is a 404 too", async () => {
  for (const path of ["/assets/index-CLKdSLqH.css", "/assets/app.js.map", "/vendor/chart.mjs"]) {
    const res = await app.request(path);
    expect(res.status, path).toBe(404);
  }
});

test("an SPA view path is not treated as a missing file", async () => {
  // Whether this ends as index.html or as Hono's own 404 depends on whether the
  // checkout has a built apps/web/dist, so what is pinned here is the routing
  // decision rather than the file outcome: the asset guard must not answer.
  const res = await app.request("/app/rekeningen");
  expect(await res.text()).not.toBe("Not Found");
});

/* --- /app is gated on a verified session; everyone else is bounced to `/`,
 * where sign-in now lives. --- */

test("GET /app with no session redirects to /", async () => {
  const res = await app.request("/app");
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/");
});

test("GET /app/rekeningen with no session redirects to /", async () => {
  const res = await app.request("/app/rekeningen");
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/");
});

test("GET /app with a verified session is not redirected", async () => {
  verifiedSessionMock.mockResolvedValue({ user: { id: "u1" } });
  const res = await app.request("/app");
  // apps/web/dist does not exist in this test environment, so this cannot
  // assert 200 — see "an SPA view path is not treated as a missing file" above.
  expect(res.status).not.toBe(302);
});

/* --- What /app answers depends on the session cookie, so a shared cache must
 * be told that, or it serves one visitor's answer to the next. --- */

test("the /app bounce is marked uncacheable and varying on the cookie", async () => {
  const res = await app.request("/app");
  expect(res.status).toBe(302);
  expect(res.headers.get("vary")).toBe("Cookie");
  expect(res.headers.get("cache-control")).toBe("private, no-store");
});

test("/app served to a signed-in visitor still varies on the cookie", async () => {
  verifiedSessionMock.mockResolvedValue({ user: { id: "u1" } });
  const res = await app.request("/app");
  expect(res.headers.get("vary")).toBe("Cookie");
});

test("routes other than /app are unaffected by the session gate", async () => {
  for (const path of ["/en", "/assets/index-DQzV9ttd.js", "/api/rates"]) {
    const res = await app.request(path);
    expect(res.status, path).not.toBe(302);
  }
});

test("LAVEGA_ALLOW_UNAUTHENTICATED=1 bypasses the /app gate", async () => {
  process.env.LAVEGA_ALLOW_UNAUTHENTICATED = "1";
  const res = await app.request("/app");
  expect(res.status).not.toBe(302);
});

test("isStaticAssetPath asks for a file extension, not merely for a dot", () => {
  // Everything Vite emits is under /assets/, whatever it is called.
  expect(isStaticAssetPath("/assets/index-DQzV9ttd.js")).toBe(true);
  expect(isStaticAssetPath("/assets/logo-a1b2c3")).toBe(true);
  expect(isStaticAssetPath("/favicon.ico")).toBe(true);
  expect(isStaticAssetPath("/service-worker.js")).toBe(true);
  expect(isStaticAssetPath("/fonts/Inter.woff2")).toBe(true);

  // Views must keep reaching index.html. The dotted ticker is the reason this is
  // an extension allowlist and not "does the path contain a dot": the investing
  // SPA routes /positions/:symbol, and BRK.B is a real symbol.
  expect(isStaticAssetPath("/app/rekeningen")).toBe(false);
  expect(isStaticAssetPath("/investing/positions/BRK.B")).toBe(false);
  expect(isStaticAssetPath("/privacy")).toBe(false);
  expect(isStaticAssetPath("/")).toBe(false);
});

test("GET / redirects an English device to /en", async () => {
  const res = await app.request("/", {
    headers: { "Accept-Language": "en-US,en;q=0.9,nl;q=0.8" },
  });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/en");
  expect(res.headers.get("vary")).toBe("Accept-Language, Cookie");
});

test("GET / does not redirect a Dutch device", async () => {
  const res = await app.request("/", { headers: { "Accept-Language": "nl-NL,en;q=0.9" } });
  expect(res.status).not.toBe(302);
  expect(res.headers.get("location")).toBeNull();
});

test("GET / a lavega_locale=nl cookie overrides an English device", async () => {
  const res = await app.request("/", {
    headers: { Cookie: "lavega_locale=nl", "Accept-Language": "en-US,en;q=0.9" },
  });
  expect(res.status).not.toBe(302);
  expect(res.headers.get("location")).toBeNull();
});

test("GET / a lavega_locale=en cookie overrides a Dutch device", async () => {
  const res = await app.request("/", {
    headers: { Cookie: "lavega_locale=en", "Accept-Language": "nl-NL,en;q=0.9" },
  });
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toBe("/en");
  expect(res.headers.get("vary")).toBe("Accept-Language, Cookie");
});

test("GET / with no headers at all does not redirect", async () => {
  const res = await app.request("/");
  expect(res.status).not.toBe(302);
  expect(res.headers.get("location")).toBeNull();
});

test("GET /en is never redirected back to Dutch", async () => {
  const res = await app.request("/en", { headers: { "Accept-Language": "nl-NL,en;q=0.9" } });
  expect(res.status).not.toBe(302);
  expect(res.headers.get("location")).toBeNull();
});

test("the redirect response still carries the global secureHeaders", async () => {
  const res = await app.request("/", {
    headers: { "Accept-Language": "en-US,en;q=0.9" },
  });
  expect(res.status).toBe(302);
  expect(res.headers.get("x-frame-options")).toBe("DENY");
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
});

/* THE ROUTES MUST EXIST EVEN WITH NO DATABASE AT MODULE LOAD.
 *
 * This is the bug that shipped, and nothing caught it because every other test
 * injects fakes straight into registerEbRoutes/registerN8nRoutes and never
 * exercises the real wiring in index.ts.
 *
 * `753b48e` made `runtimeDatabase()` read an AsyncLocalStorage scope that
 * `withRuntimeDatabase` establishes around `app.fetch`. The dependency
 * factories ran at module load, where there is no scope, so they returned null
 * and `if (deps) register...` skipped EVERY Enable Banking and n8n route.
 *
 * It hid because apiGuard answers 401 before routing: a route that does not
 * exist is indistinguishable from one you are not signed in for. The single
 * public route in either family, /api/n8n/status, is what exposed it — in
 * production it returned Hono's own 404.
 *
 * So this asserts existence, not behaviour: a 404 here means the route is gone
 * again. Anything else — 401, 503, 200 — means it is registered and answering
 * for its own reasons. */
test("the eb and n8n routes are registered even though module load has no request scope", async () => {
  for (const path of ["/api/n8n/status", "/api/n8n/queue", "/api/eb/aspsps", "/api/eb/accounts"]) {
    const res = await app.request(path);
    expect(res.status, `${path} is not registered`).not.toBe(404);
  }
});

/* The one in that family that can answer without a session, so it is the one
 * that can prove registration rather than merely not-404. */
test("the n8n status route answers a boolean without a database", async () => {
  const res = await app.request("/api/n8n/status");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ configured: expect.any(Boolean) });
});

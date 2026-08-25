import { afterEach, expect, test, vi } from "vitest";
import type { EbConfig } from "./config.js";

// Deterministic — doesn't depend on whether a real (git-ignored) config.json
// happens to exist on disk. loadConfig's own "missing/placeholder file"
// behavior is unit-tested in config.test.ts.
const { loadConfigMock } = vi.hoisted(() => ({ loadConfigMock: vi.fn<() => EbConfig>() }));

vi.mock("./config.js", async () => {
  const actual = await vi.importActual<typeof import("./config.js")>("./config.js");
  return { ...actual, loadConfig: loadConfigMock };
});

const { app, isStaticAssetPath } = await import("./index.js");

afterEach(() => {
  loadConfigMock.mockReset();
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
  });
  const res = await app.request("/api/eb/status");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ configured: false, applicationId: null });
});

test("GET /api/eb/status masks the applicationId when configured", async () => {
  loadConfigMock.mockReturnValue({
    configured: true,
    applicationId: "abcd1234efgh5678",
    privateKey: null,
    privateKeyFile: "./key.pem",
    redirectUrl: "http://localhost:8787/api/eb/callback",
    psuType: "business",
  });
  const res = await app.request("/api/eb/status");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ configured: true, applicationId: "abcd1234…" });
});

test("GET /api/rates returns a valid rates payload with open CORS", async () => {
  const res = await app.request("/api/rates");
  expect(res.status).toBe(200);
  expect(res.headers.get("access-control-allow-origin")).toBe("*");
  const body = await res.json();
  expect(typeof body.asOf).toBe("string");
  expect(Array.isArray(body.rates)).toBe(true);
  expect(body.rates[0]).toMatchObject({ bank: expect.any(String), ratePct: expect.any(Number), freeWithdrawal: expect.any(Boolean) });
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

  // These routes spend the owner's Anthropic key, so an open policy would let
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

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

const { app } = await import("./index.js");

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

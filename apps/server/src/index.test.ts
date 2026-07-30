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
    privateKeyFile: "./key.pem",
    redirectUrl: "http://localhost:8787/api/eb/callback",
    psuType: "business",
  });
  const res = await app.request("/api/eb/status");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ configured: true, applicationId: "abcd1234…" });
});

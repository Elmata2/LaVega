import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { isPublicApiPath } from "./apiGuard.js";

/* The guard asks auth.js whether this request carries a verified session.
 * Mocked so a test can be "logged in" without a Neon database. */
const { verifiedSessionMock } = vi.hoisted(() => ({ verifiedSessionMock: vi.fn() }));
vi.mock("./auth.js", async () => {
  const actual = await vi.importActual<typeof import("./auth.js")>("./auth.js");
  return { ...actual, verifiedSession: verifiedSessionMock };
});

const { app } = await import("./index.js");

beforeEach(() => {
  verifiedSessionMock.mockResolvedValue(null); // nobody is logged in
  delete process.env.LAVEGA_ALLOW_UNAUTHENTICATED;
});

afterEach(() => {
  verifiedSessionMock.mockReset();
  delete process.env.LAVEGA_ALLOW_UNAUTHENTICATED;
});

test("an anonymous POST to /api/agent/chat is refused with 401", async () => {
  const res = await app.request("/api/agent/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [] }),
  });
  expect(res.status).toBe(401);
});

test("an anonymous POST to /api/eb/auth is refused with 401", async () => {
  const res = await app.request("/api/eb/auth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "ING", country: "NL" }),
  });
  expect(res.status).toBe(401);
});

test("a verified session is let through to the route", async () => {
  verifiedSessionMock.mockResolvedValue({ user: { id: "u1" } });
  const res = await app.request("/api/agent/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [] }),
  });
  expect(res.status).not.toBe(401);
});

test("public data routes stay open without a session", async () => {
  expect((await app.request("/api/fx/rate")).status).toBe(200);
  expect((await app.request("/api/eb/status")).status).toBe(200);
  expect((await app.request("/api/agent/status")).status).toBe(200);
});

test("/api/auth/* stays open — it is how you log in", async () => {
  const res = await app.request("/api/auth/get-session");
  expect(res.status).not.toBe(401);
});

test("/api/card-terms/ingest keeps its own shared-secret auth, not the session guard", async () => {
  // No session, no ingest token configured: the route's own 503 must be what
  // answers, proving the session guard did not swallow the machine endpoint.
  const res = await app.request("/api/card-terms/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ terms: [] }),
  });
  expect(res.status).toBe(503);
});

test("/api/cron/investing-sync and /api/investing/health pass the guard without a session — each carries its own auth", async () => {
  for (const path of ["/api/cron/investing-sync", "/api/investing/health"]) {
    expect(isPublicApiPath(path)).toBe(true);
    const res = await app.request(path);
    expect(await res.text()).not.toContain('{"error":"unauthorized"}');
  }
});

test("LAVEGA_ALLOW_UNAUTHENTICATED=1 opens the guard for local development", async () => {
  process.env.LAVEGA_ALLOW_UNAUTHENTICATED = "1";
  const res = await app.request("/api/agent/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [] }),
  });
  expect(res.status).not.toBe(401);
});

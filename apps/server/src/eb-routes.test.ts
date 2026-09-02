import { Hono } from "hono";
import { beforeEach, expect, test, vi } from "vitest";
import type { EbConfig } from "./config.js";

/* eb-routes.ts had no test file at all, which is the likeliest reason the
 * unvalidated OAuth `state` survived: the callback created a state, deleted it,
 * and never once read it back. */

const { loadConfigMock, ebMock } = vi.hoisted(() => ({
  loadConfigMock: vi.fn<() => EbConfig>(),
  ebMock: vi.fn(),
}));

vi.mock("./config.js", async () => {
  const actual = await vi.importActual<typeof import("./config.js")>("./config.js");
  return { ...actual, loadConfig: loadConfigMock };
});
vi.mock("./eb-client.js", async () => {
  const actual = await vi.importActual<typeof import("./eb-client.js")>("./eb-client.js");
  return { ...actual, eb: ebMock };
});

const { registerEbRoutes, PENDING_TTL_MS, SESSION_TTL_MS } = await import("./eb-routes.js");
import type { EbFlowStore, EbSession, PendingAuth } from "./eb-routes.js";

/* A store that behaves like the Neon one: shared across "instances", one-shot
 * on consume, and scoped per user on read. `signedInAs` stands in for the
 * session, so a test can change who is calling. */
function fakeStore() {
  const pending = new Map<string, PendingAuth>();
  const sessions = new Map<string, { userId: string; payload: EbSession }>();
  const store: EbFlowStore = {
    async startAuth(state, entry) { pending.set(state, entry); },
    async consumeAuth(state) {
      const entry = pending.get(state);
      if (!entry) return null;
      pending.delete(state); // one-shot, exactly like DELETE ... RETURNING
      return entry;
    },
    async sweepAuth() {},
    async putSession(userId, sessionId, payload) { sessions.set(sessionId, { userId, payload }); },
    async getSession(userId, sessionId) {
      const row = sessions.get(sessionId);
      return row && row.userId === userId ? row.payload : null; // RLS, in miniature
    },
    async deleteSession(userId, sessionId) {
      const row = sessions.get(sessionId);
      if (row?.userId === userId) sessions.delete(sessionId);
    },
  };
  return { store, pending, sessions };
}

let signedInAs: string | null = "user-123";
const { store, pending, sessions } = fakeStore();
const app = new Hono();
registerEbRoutes(app, { store, tenantId: async () => signedInAs });

beforeEach(() => {
  signedInAs = "user-123";
  pending.clear();
  sessions.clear();
  ebMock.mockReset();
  loadConfigMock.mockReset();
  loadConfigMock.mockReturnValue({
    configured: true,
    applicationId: "app-1",
    privateKey: "key",
    privateKeyFile: null,
    redirectUrl: "http://localhost:8787/api/eb/callback",
    psuType: "business",
  });
});

/** Start a real authorisation and return the `state` the server issued. */
async function issueState(): Promise<string> {
  ebMock.mockResolvedValueOnce({ url: "https://bank.example/authorize" });
  const res = await app.request("/api/eb/auth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "ING", country: "NL" }),
  });
  expect(res.status).toBe(200);
  const sent = ebMock.mock.calls[0]![3] as { state: string };
  return sent.state;
}

test("a callback whose state this server never issued does not exchange the code", async () => {
  const res = await app.request("/api/eb/callback?code=attacker-code&state=never-issued");
  expect(ebMock).not.toHaveBeenCalled();
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toContain("eb_error");
});

test("a callback with no state at all does not exchange the code", async () => {
  const res = await app.request("/api/eb/callback?code=attacker-code");
  expect(ebMock).not.toHaveBeenCalled();
  expect(res.status).toBe(302);
  expect(res.headers.get("location")).toContain("eb_error");
});

test("a callback carrying a state this server issued is exchanged", async () => {
  const state = await issueState();
  ebMock.mockResolvedValueOnce({ session_id: "sess-1", accounts: [], aspsp: { name: "ING" } });
  const res = await app.request(`/api/eb/callback?code=real-code&state=${state}`);
  expect(ebMock).toHaveBeenCalledTimes(2);
  expect(ebMock.mock.calls[1]![2]).toBe("/sessions");
  expect(res.headers.get("location")).toBe("/?eb=sess-1");
});

test("a state is one-shot — replaying the same callback is refused", async () => {
  const state = await issueState();
  ebMock.mockResolvedValueOnce({ session_id: "sess-1", accounts: [], aspsp: { name: "ING" } });
  await app.request(`/api/eb/callback?code=real-code&state=${state}`);
  ebMock.mockClear();

  const replay = await app.request(`/api/eb/callback?code=real-code&state=${state}`);
  expect(ebMock).not.toHaveBeenCalled();
  expect(replay.headers.get("location")).toContain("eb_error");
});

test("an error from the bank still short-circuits before any exchange", async () => {
  const res = await app.request("/api/eb/callback?error=access_denied&error_description=Geweigerd");
  expect(ebMock).not.toHaveBeenCalled();
  expect(res.headers.get("location")).toContain("Geweigerd");
});


/* The reason this store moved out of process memory at all. */

test("the state survives the flow crossing serverless instances", async () => {
  // /auth ran in one function instance; the bank's redirect lands on another.
  // Everything either route knows is in the shared store, never in module scope.
  const state = await issueState();
  // A second registration standing in for a different function instance: same
  // shared store, and deliberately NO session, the way the bank's redirect
  // arrives when the cookie does not survive the cross-site hop.
  const coldInstance = new Hono();
  registerEbRoutes(coldInstance, { store, tenantId: async () => null });

  ebMock.mockResolvedValueOnce({ session_id: "sess-1", accounts: [], aspsp: { name: "ING" } });
  const res = await coldInstance.request(`/api/eb/callback?code=real-code&state=${state}`);

  // No session on this instance, and it still completes — the state carried the
  // identity. Under the old in-memory Map this redirected to eb_error.
  expect(res.headers.get("location")).toBe("/?eb=sess-1");
});

test("the exchanged session belongs to the user who started the flow", async () => {
  const state = await issueState(); // started by user-123
  ebMock.mockResolvedValueOnce({ session_id: "sess-1", accounts: [{ uid: "a1" }], aspsp: { name: "ING" } });
  await app.request(`/api/eb/callback?code=real-code&state=${state}`);

  expect(sessions.get("sess-1")?.userId).toBe("user-123");
});

test("another signed-in user cannot collect someone else's bank session", async () => {
  const state = await issueState(); // user-123
  ebMock.mockResolvedValueOnce({ session_id: "sess-1", accounts: [{ uid: "a1" }], aspsp: { name: "ING" } });
  await app.request(`/api/eb/callback?code=real-code&state=${state}`);
  ebMock.mockClear();

  signedInAs = "user-999";
  const res = await app.request("/api/eb/accounts?session_id=sess-1");

  expect(res.status).toBe(404);
  expect(ebMock).not.toHaveBeenCalled(); // no bank call made on their behalf
  // And it is still there for its rightful owner.
  expect(sessions.has("sess-1")).toBe(true);
});

test("starting an authorisation requires being signed in", async () => {
  signedInAs = null;
  const res = await app.request("/api/eb/auth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "ING", country: "NL" }),
  });
  expect(res.status).toBe(401);
  expect(ebMock).not.toHaveBeenCalled();
});

test("collecting accounts requires being signed in", async () => {
  signedInAs = null;
  const res = await app.request("/api/eb/accounts?session_id=sess-1");
  expect(res.status).toBe(401);
});

test("the TTLs are still finite", () => {
  expect(PENDING_TTL_MS).toBeGreaterThan(0);
  expect(SESSION_TTL_MS).toBeGreaterThan(PENDING_TTL_MS);
});

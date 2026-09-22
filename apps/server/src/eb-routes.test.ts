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

const { registerEbRoutes, PENDING_TTL_MS, SESSION_TTL_MS, CONSENT_DAYS, EB_REFRESH_PER_MINUTE } =
  await import("./eb-routes.js");
import { createRateLimiter } from "./agent/rateLimit.js";
import type { EbFlowStore, EbSession, PendingAuth } from "./eb-routes.js";

/* A store that behaves like the Neon one: shared across "instances", one-shot
 * on consume, and scoped per user on read. `signedInAs` stands in for the
 * session, so a test can change who is calling. */
function fakeStore() {
  const pending = new Map<string, PendingAuth>();
  const sessions = new Map<string, { userId: string; payload: EbSession; createdAt: string }>();
  const sweepSessionCalls: Array<{ userId: string; ttlMs: number }> = [];
  const store: EbFlowStore = {
    async startAuth(state, entry) {
      pending.set(state, entry);
    },
    async consumeAuth(state) {
      const entry = pending.get(state);
      if (!entry) return null;
      pending.delete(state); // one-shot, exactly like DELETE ... RETURNING
      return entry;
    },
    async sweepAuth() {},
    async sweepSessions(userId, ttlMs) {
      sweepSessionCalls.push({ userId, ttlMs });
      return 0;
    },
    async putSession(userId, sessionId, payload) {
      sessions.set(sessionId, {
        userId,
        payload,
        createdAt: sessions.get(sessionId)?.createdAt ?? new Date().toISOString(),
      });
    },
    async listSessions(userId) {
      /* Gefilterd op userId in JS. DAT BEWIJST DE ECHTE AFSCHERMING NIET — die
       * zit in `user_id = $1` plus RLS op de tabel, en wordt getest in
       * packages/database tegen een echte Postgres. Deze nep-store bestaat om
       * het GEDRAG van de routes te testen, niet de query. */
      return [...sessions.entries()]
        .filter(([, v]) => v.userId === userId)
        .map(([sessionId, v]) => ({ sessionId, payload: v.payload, createdAt: v.createdAt }));
    },
    async getSession(userId, sessionId) {
      const row = sessions.get(sessionId);
      return row && row.userId === userId ? row.payload : null; // RLS, in miniature
    },
    async deleteSession(userId, sessionId) {
      const row = sessions.get(sessionId);
      if (row?.userId === userId) sessions.delete(sessionId);
    },
  };
  return { store, pending, sessions, sweepSessionCalls };
}

let signedInAs: string | null = "user-123";
const { store, pending, sessions, sweepSessionCalls } = fakeStore();
const app = new Hono();
/* Een ruime limiet voor de suite, zodat de VOLGORDE van de tests niet bepaalt
 * of de laatste er nog in past; de limiet zelf heeft zijn eigen test met zijn
 * eigen app hieronder. */
registerEbRoutes(app, {
  store,
  tenantId: async () => signedInAs,
  refreshLimit: createRateLimiter(1000, 60_000),
});

beforeEach(() => {
  signedInAs = "user-123";
  pending.clear();
  sessions.clear();
  sweepSessionCalls.length = 0;
  ebMock.mockReset();
  loadConfigMock.mockReset();
  loadConfigMock.mockReturnValue({
    configured: true,
    applicationId: "app-1",
    privateKey: "key",
    privateKeyFile: null,
    redirectUrl: "http://localhost:8787/api/eb/callback",
    psuType: "business",
    keySource: "env",
    keyShape: { kind: "pem", length: 10 },
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
  ebMock.mockResolvedValueOnce({
    session_id: "sess-1",
    accounts: [{ uid: "a1" }],
    aspsp: { name: "ING" },
  });
  await app.request(`/api/eb/callback?code=real-code&state=${state}`);

  expect(sessions.get("sess-1")?.userId).toBe("user-123");
});

test("another signed-in user cannot collect someone else's bank session", async () => {
  const state = await issueState(); // user-123
  ebMock.mockResolvedValueOnce({
    session_id: "sess-1",
    accounts: [{ uid: "a1" }],
    aspsp: { name: "ING" },
  });
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

test("starting an authorisation sweeps that user's own stale eb_sessions", async () => {
  // eb_sessions is RLS-scoped per user (0004_eb_grants.sql, FORCE ROW LEVEL
  // SECURITY) — there is no table-wide sweep for it the way sweepAuth does for
  // eb_pending_auth. Instead it is swept per-tenant here, the one request that
  // already runs as the signed-in user. SESSION_TTL_MS is reused because that
  // is already the freshness window getSession enforces on read — a session
  // this stale is unreachable either way.
  await issueState();
  expect(sweepSessionCalls).toEqual([{ userId: "user-123", ttlMs: SESSION_TTL_MS }]);
});

test("a country that is not two letters never reaches the Enable Banking URL (L2)", async () => {
  for (const country of ["NL&psu_type=business", "N", "nl#", "NLD"]) {
    const list = await app.request(`/api/eb/aspsps?country=${encodeURIComponent(country)}`);
    expect(list.status).toBe(400);
    const start = await app.request("/api/eb/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "ING", country }),
    });
    expect(start.status).toBe(400);
  }
  expect(ebMock).not.toHaveBeenCalled();
});

test("aspsps with psu_type=personal in the query overrides the configured default", async () => {
  ebMock.mockResolvedValueOnce({ aspsps: [] });
  await app.request("/api/eb/aspsps?country=NL&psu_type=personal");
  expect(ebMock.mock.calls[0]![2]).toBe("/aspsps?country=NL&psu_type=personal");
});

test("aspsps with no psu_type in the query falls back to the configured default", async () => {
  ebMock.mockResolvedValueOnce({ aspsps: [] });
  await app.request("/api/eb/aspsps?country=NL");
  expect(ebMock.mock.calls[0]![2]).toBe("/aspsps?country=NL&psu_type=business");
});

test("aspsps with an invalid psu_type in the query is rejected before the bank call", async () => {
  const res = await app.request("/api/eb/aspsps?country=NL&psu_type=corporate");
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "Ongeldig type rekening." });
  expect(ebMock).not.toHaveBeenCalled();
});

test("auth with psuType personal in the body overrides the configured default", async () => {
  ebMock.mockResolvedValueOnce({ url: "https://bank.example/authorize" });
  await app.request("/api/eb/auth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "ING", country: "NL", psuType: "personal" }),
  });
  const sent = ebMock.mock.calls[0]![3] as { psu_type: string };
  expect(sent.psu_type).toBe("personal");
});

/* ══════ VERVERSEN ════════════════════════════════════════════════════════════
 *
 * "Enable Banking ververst niet — mijn saldo is van het moment dat ik koppelde."
 * Twee oorzaken, allebei hier: de sessie werd WEGGEGOOID zodra de eerste fetch
 * slaagde ("one-shot: data delivered"), en de rij leefde sowieso maar een uur
 * terwijl de toestemming 89 dagen geldt. Er viel dus niets te verversen MET. */

/** Connect a bank and leave the session standing, as the callback does. */
async function connect(sessionId: string, aspsp: string, validUntil?: string) {
  const state = await issueState();
  ebMock.mockResolvedValueOnce({
    session_id: sessionId,
    accounts: [{ uid: `${sessionId}-acc` }],
    aspsp: { name: aspsp },
  });
  await app.request(`/api/eb/callback?code=real-code&state=${state}`);
  if (validUntil) {
    const row = sessions.get(sessionId)!;
    sessions.set(sessionId, { ...row, payload: { ...row.payload, validUntil } });
  }
  ebMock.mockReset();
}

/** Balances + transactions for one account, as the bank answers them. */
function mockOneAccountFetch(balance: string) {
  ebMock.mockResolvedValueOnce({ balances: [{ amount: balance }] });
  ebMock.mockResolvedValueOnce({ transactions: [] });
}

test("a session survives being read, so the same bank can be read again", async () => {
  await connect("sess-1", "ING");
  mockOneAccountFetch("100");
  const first = await app.request("/api/eb/accounts?session_id=sess-1");
  expect(first.status).toBe(200);
  // DIT is de regressietest: vroeger was de rij hier weg en gaf de tweede
  // lezing 404 "koppel de bank opnieuw".
  expect(sessions.has("sess-1")).toBe(true);
  mockOneAccountFetch("250");
  const second = await app.request("/api/eb/accounts?session_id=sess-1");
  expect(second.status).toBe(200);
  const body = (await second.json()) as { items: Array<{ balances: Array<{ amount: string }> }> };
  expect(body.items[0].balances[0].amount).toBe("250");
});

test("the consent window, not an hour, is what bounds a connection", () => {
  // 89 dagen toestemming; de rij mag daar niet vóór verdwijnen.
  expect(SESSION_TTL_MS).toBeGreaterThan(CONSENT_DAYS * 24 * 60 * 60 * 1000);
});

test("refresh re-reads every live connection the caller has", async () => {
  await connect("sess-1", "ING");
  await connect("sess-2", "bunq");
  mockOneAccountFetch("100");
  mockOneAccountFetch("200");
  const res = await app.request("/api/eb/refresh", { method: "POST" });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { refreshed: Array<{ aspsp: string }>; expired: string[] };
  expect(body.refreshed.map((r) => r.aspsp).sort()).toEqual(["ING", "bunq"]);
  expect(body.expired).toEqual([]);
});

test("an expired consent is NAMED, and never hides the bank that still works", async () => {
  await connect("sess-1", "ING", "2020-01-01T00:00:00.000Z"); // long dead
  await connect("sess-2", "bunq");
  mockOneAccountFetch("200");
  const res = await app.request("/api/eb/refresh", { method: "POST" });
  const body = (await res.json()) as {
    refreshed: Array<{ aspsp: string }>;
    expired: string[];
  };
  expect(body.expired).toEqual(["ING"]);
  expect(body.refreshed.map((r) => r.aspsp)).toEqual(["bunq"]);
});

test("one bank failing does not take the other down with it", async () => {
  await connect("sess-1", "ING");
  await connect("sess-2", "bunq");
  ebMock.mockRejectedValueOnce(new Error("bank is down"));
  mockOneAccountFetch("200");
  const res = await app.request("/api/eb/refresh", { method: "POST" });
  const body = (await res.json()) as {
    refreshed: Array<{ aspsp: string }>;
    failed: Array<{ aspsp: string }>;
  };
  expect(body.failed.map((f) => f.aspsp)).toEqual(["ING"]);
  expect(body.refreshed.map((r) => r.aspsp)).toEqual(["bunq"]);
});

test("refresh is scoped to the caller, and never touches another user's bank", async () => {
  await connect("sess-1", "ING");
  signedInAs = "someone-else";
  const res = await app.request("/api/eb/refresh", { method: "POST" });
  expect(await res.json()).toEqual({ refreshed: [], expired: [], failed: [] });
  // Niet alleen een leeg antwoord: de bank is ook niet gebeld.
  expect(ebMock).not.toHaveBeenCalled();
  expect(sessions.has("sess-1")).toBe(true); // en niets van hem is opgeruimd
});



/* ── Wat de securityreview van 22 september blootlegde ───────────────────── */

test("reconnecting the same bank supersedes the old consent instead of stacking", async () => {
  await connect("sess-1", "ING");
  await connect("sess-2", "ING");
  // Eén levende rij per bank: zonder dit belt verversen de bank twee keer voor
  // hetzelfde antwoord, en drie keer na de derde herkoppeling.
  expect([...sessions.keys()]).toEqual(["sess-2"]);
});

test("a second bank is not superseded by the first — only the same bank is", async () => {
  await connect("sess-1", "ING");
  await connect("sess-2", "bunq");
  expect([...sessions.keys()].sort()).toEqual(["sess-1", "sess-2"]);
});

test("a session stored before validUntil existed expires on its own age, not never", async () => {
  await connect("sess-1", "ING");
  const row = sessions.get("sess-1")!;
  // Zoals elke rij van vóór deze wijziging: geen validUntil, en oud.
  const { validUntil: _dropped, ...withoutExpiry } = row.payload;
  sessions.set("sess-1", {
    ...row,
    payload: withoutExpiry,
    createdAt: new Date(Date.now() - (CONSENT_DAYS + 1) * 86_400_000).toISOString(),
  });
  const res = await app.request("/api/eb/refresh", { method: "POST" });
  const body = (await res.json()) as { expired: string[] };
  expect(body.expired).toEqual(["ING"]);
  expect(ebMock).not.toHaveBeenCalled(); // en de bank is niet lastiggevallen
});

test("a bank that rejects our credentials is reported as expired, not as a failure", async () => {
  await connect("sess-1", "ING");
  const refused = Object.assign(new Error("Enable Banking 401: consent revoked"), { status: 401 });
  ebMock.mockRejectedValueOnce(refused);
  const res = await app.request("/api/eb/refresh", { method: "POST" });
  const body = (await res.json()) as { expired: string[]; failed: unknown[] };
  expect(body.expired).toEqual(["ING"]);
  expect(body.failed).toEqual([]);
});

test("a dead consent is pruned, so it is not retried on every refresh", async () => {
  await connect("sess-1", "ING", "2020-01-01T00:00:00.000Z");
  await app.request("/api/eb/refresh", { method: "POST" });
  expect(sessions.has("sess-1")).toBe(false);
});

test("the bank's own words never reach the browser", async () => {
  await connect("sess-1", "ING");
  // Twee echte gevallen: 400 bytes van de bank, en het pad naar onze sleutel.
  ebMock.mockRejectedValueOnce(new Error("Enable Banking 502: <html>upstream said a lot</html>"));
  const res = await app.request("/api/eb/refresh", { method: "POST" });
  const text = await res.text();
  expect(text).not.toMatch(/upstream said a lot|<html>/);
  expect(text).not.toMatch(/\/Users\/|\.pem|BEGIN/);
  expect(JSON.parse(text).failed).toEqual([{ aspsp: "ING", error: "unreachable" }]);
});

test("refresh is rate limited, because it spends the bank's quota on every press", async () => {
  const strict = new Hono();
  const own = fakeStore();
  registerEbRoutes(strict, {
    store: own.store,
    tenantId: async () => "user-123",
    refreshLimit: createRateLimiter(2, 60_000),
  });
  expect((await strict.request("/api/eb/refresh", { method: "POST" })).status).toBe(200);
  expect((await strict.request("/api/eb/refresh", { method: "POST" })).status).toBe(200);
  const third = await strict.request("/api/eb/refresh", { method: "POST" });
  expect(third.status).toBe(429);
  expect((await third.json()).code).toBe("eb-rate-limited");
  // En de standaardlimiet is een getal dat een mens niet raakt.
  expect(EB_REFRESH_PER_MINUTE).toBeGreaterThanOrEqual(3);
});

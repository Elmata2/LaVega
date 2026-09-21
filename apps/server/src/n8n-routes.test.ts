import { Hono } from "hono";
import { beforeEach, expect, test, vi } from "vitest";

/* THE ONE RULE THIS SUITE EXISTS TO PROVE: a request's own `key` (query,
 * header, body — anywhere) never reaches n8n. queueKey comes exclusively from
 * the session's own row in personal.n8n_forwarding, looked up server-side.
 * Reading the wrong partition doesn't just misinform, it drains and deletes
 * someone else's queue (packages/core/src/n8n/queue.js's drainQueue). */

type N8nQueueConfig = { configured: boolean; url: string | null; token: string | null };

const { loadN8nQueueConfigMock } = vi.hoisted(() => ({
  loadN8nQueueConfigMock: vi.fn<() => N8nQueueConfig>(),
}));

vi.mock("./config.js", async () => {
  const actual = await vi.importActual<typeof import("./config.js")>("./config.js");
  return { ...actual, loadN8nQueueConfig: loadN8nQueueConfigMock };
});

const { registerN8nRoutes } = await import("./n8n-routes.js");

/** Records every URL and header set the fake n8n endpoint was called with. */
function fakeFetchQueue(status: number, body: unknown) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const impl = (async (input: string | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    for (const [key, value] of new Headers(init?.headers).entries()) headers[key] = value;
    calls.push({ url: input.toString(), headers });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return { impl, calls };
}

type N8nForwardingWrite =
  | { status: "stored"; localPart: string }
  | { status: "invalid" }
  | { status: "taken" };

let signedInAs: string | null = "user-123";
const localParts = new Map<string, string>();
const getLocalPartCalls: string[] = [];
async function getLocalPart(userId: string): Promise<string | null> {
  getLocalPartCalls.push(userId);
  return localParts.get(userId) ?? null;
}

let setLocalPartResult: N8nForwardingWrite = { status: "stored", localPart: "ale-7f3a" };
const setLocalPartCalls: Array<{ userId: string; localPart: string }> = [];
async function setLocalPart(userId: string, localPart: string): Promise<N8nForwardingWrite> {
  setLocalPartCalls.push({ userId, localPart });
  return setLocalPartResult;
}

beforeEach(() => {
  signedInAs = "user-123";
  localParts.clear();
  localParts.set("user-123", "ale");
  getLocalPartCalls.length = 0;
  setLocalPartCalls.length = 0;
  setLocalPartResult = { status: "stored", localPart: "ale-7f3a" };
  loadN8nQueueConfigMock.mockReset();
  loadN8nQueueConfigMock.mockReturnValue({
    configured: true,
    url: "https://n8n.example/webhook/invoice-queue",
    token: "shh-shared-secret",
  });
});

function buildApp(fetchImpl: typeof fetch) {
  const app = new Hono();
  registerN8nRoutes(app, { tenantId: async () => signedInAs, getLocalPart, setLocalPart, fetchImpl });
  return app;
}

/* The question this exists to answer, which was previously unanswerable from
 * outside: apiGuard 401s an unauthenticated caller before the handler's config
 * check runs, so a missing credential and a missing session look identical.
 * That came up on three separate deploys. */
test("the status route reports whether the server has a credential, never what it is", async () => {
  const app = buildApp(fakeFetchQueue(200, { invoices: [], notices: [] }).impl);

  loadN8nQueueConfigMock.mockReturnValue({ configured: false, url: null, token: null });
  expect(await (await app.request("/api/n8n/status")).json()).toEqual({ configured: false });

  loadN8nQueueConfigMock.mockReturnValue({
    configured: true,
    url: "https://n8n.example/webhook/q",
    token: "sekrit-value",
  });
  const res = await app.request("/api/n8n/status");
  const body = await res.text();
  expect(res.status).toBe(200);
  expect(JSON.parse(body)).toEqual({ configured: true });
  /* The whole point: a boolean, never the credential. */
  expect(body).not.toContain("sekrit-value");
  expect(body).not.toContain("n8n.example");
});

/* It must answer without a session, or it cannot answer the question it exists
 * for — the caller who cannot sign in is exactly who needs to know. */
test("the status route needs no session", async () => {
  const app = new Hono();
  registerN8nRoutes(app, {
    tenantId: async () => null,
    getLocalPart,
    setLocalPart,
    fetchImpl: fakeFetchQueue(200, { invoices: [], notices: [] }).impl,
  });
  loadN8nQueueConfigMock.mockReturnValue({ configured: true, url: "https://x/y", token: "t" });
  expect(await (await app.request("/api/n8n/status")).json()).toEqual({ configured: true });
});

test("a request's own ?key= is never sent to n8n — the session's own local part always wins", async () => {
  const { impl, calls } = fakeFetchQueue(200, { invoices: [] });
  const app = buildApp(impl);

  await app.request("/api/n8n/queue?key=someone-elses-local-part");

  expect(calls).toHaveLength(1);
  const url = new URL(calls[0]!.url);
  expect(url.searchParams.get("key")).toBe("ale");
});

test("no session: 401, and n8n is never called", async () => {
  signedInAs = null;
  const { impl, calls } = fakeFetchQueue(200, { invoices: [] });
  const app = buildApp(impl);

  const res = await app.request("/api/n8n/queue");

  expect(res.status).toBe(401);
  expect(calls).toHaveLength(0);
  expect((await res.json()).code).toBe("n8n-queue-unauthenticated");
});

test("no address on file: 200 with an explicitly-flagged empty queue, and n8n is never called", async () => {
  // This is the fallback-to-OWNER_KEY prevention: a brand new user with no row
  // in personal.n8n_forwarding must never trigger a keyless fetch, because
  // queue.js falls back to OWNER_KEY when no key is given — that would hand a
  // new user the owner's own invoices.
  signedInAs = "user-without-address";
  const { impl, calls } = fakeFetchQueue(200, { invoices: [] });
  const app = buildApp(impl);

  const res = await app.request("/api/n8n/queue");

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ invoices: [], notices: [], noAddress: true });
  expect(calls).toHaveLength(0);
});

test("server not configured: 503, and n8n is never called", async () => {
  loadN8nQueueConfigMock.mockReturnValue({ configured: false, url: null, token: null });
  const { impl, calls } = fakeFetchQueue(200, { invoices: [] });
  const app = buildApp(impl);

  const res = await app.request("/api/n8n/queue");

  expect(res.status).toBe(503);
  expect(calls).toHaveLength(0);
  expect((await res.json()).code).toBe("n8n-not-configured");
});

test("n8n-URL on the server is malformed: 503 with code n8n-misconfigured-url, and n8n is never called", async () => {
  loadN8nQueueConfigMock.mockReturnValue({
    configured: true,
    url: "not-a-valid-url",
    token: "shh-shared-secret",
  });
  const { impl, calls } = fakeFetchQueue(200, { invoices: [] });
  const app = buildApp(impl);

  const res = await app.request("/api/n8n/queue");

  expect(res.status).toBe(503);
  expect(calls).toHaveLength(0);
  expect(await res.json()).toEqual({
    error: "De n8n-URL op de server is ongeldig.",
    code: "n8n-misconfigured-url",
  });
});

test("n8n answering 401 (bad shared token) comes back as this route's 502, not 401", async () => {
  // 401 from THIS route means "you're signed out of LaVega". Passing n8n's own
  // 401 straight through would mislabel an operator misconfiguration (the
  // shared token) as the end user's own session lapsing.
  const { impl } = fakeFetchQueue(401, { error: "bad token" });
  const app = buildApp(impl);

  const res = await app.request("/api/n8n/queue");

  expect(res.status).toBe(502);
  expect(await res.json()).toEqual({
    error: "n8n antwoordde met status 401.",
    code: "n8n-upstream-error",
  });
});

test("n8n unreachable (fetch itself throws): 502 with code n8n-unreachable", async () => {
  const impl = (async () => {
    throw new Error("network down");
  }) as typeof fetch;
  const app = buildApp(impl);

  const res = await app.request("/api/n8n/queue");

  expect(res.status).toBe(502);
  expect(await res.json()).toEqual({ error: "Kon n8n niet bereiken.", code: "n8n-unreachable" });
});

test("n8n responds 200 with an unreadable (non-JSON) body: 502 with code n8n-unreadable", async () => {
  const impl = (async () =>
    new Response("not json", { status: 200, headers: { "content-type": "text/plain" } })) as typeof fetch;
  const app = buildApp(impl);

  const res = await app.request("/api/n8n/queue");

  expect(res.status).toBe(502);
  expect(await res.json()).toEqual({ error: "Onleesbaar antwoord van n8n.", code: "n8n-unreadable" });
});

test("the x-lavega-token header sent to n8n is the server's configured secret, never anything from the request", async () => {
  const { impl, calls } = fakeFetchQueue(200, { invoices: [] });
  const app = buildApp(impl);

  await app.request("/api/n8n/queue", { headers: { "x-lavega-token": "attacker-supplied" } });

  expect(calls[0]!.headers["x-lavega-token"]).toBe("shh-shared-secret");
});

test("a healthy response relays n8n's JSON body unchanged", async () => {
  const body = { invoices: [{ id: "inv-1" }], notices: [{ kind: "info" }] };
  const { impl } = fakeFetchQueue(200, body);
  const app = buildApp(impl);

  const res = await app.request("/api/n8n/queue");

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual(body);
});

test("GET /api/n8n/forward-address with no session: 401, and neither store function is called", async () => {
  signedInAs = null;
  const { impl } = fakeFetchQueue(200, {});
  const app = buildApp(impl);

  const res = await app.request("/api/n8n/forward-address");

  expect(res.status).toBe(401);
  expect(getLocalPartCalls).toHaveLength(0);
  expect(setLocalPartCalls).toHaveLength(0);
  expect((await res.json()).code).toBe("n8n-forward-address-read-unauthenticated");
});

test("GET /api/n8n/forward-address with a recorded local part: 200 with that local part", async () => {
  const { impl } = fakeFetchQueue(200, {});
  const app = buildApp(impl);

  const res = await app.request("/api/n8n/forward-address");

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ localPart: "ale" });
});

test("GET /api/n8n/forward-address with no address on file: 200 with a null local part", async () => {
  signedInAs = "user-without-address";
  const { impl } = fakeFetchQueue(200, {});
  const app = buildApp(impl);

  const res = await app.request("/api/n8n/forward-address");

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ localPart: null });
});

test("POST /api/n8n/forward-address with no session: 401", async () => {
  signedInAs = null;
  const { impl } = fakeFetchQueue(200, {});
  const app = buildApp(impl);

  const res = await app.request("/api/n8n/forward-address", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ localPart: "ale" }),
  });

  expect(res.status).toBe(401);
  expect((await res.json()).code).toBe("n8n-forward-address-write-unauthenticated");
});

test("POST /api/n8n/forward-address where setLocalPart reports invalid: 400", async () => {
  setLocalPartResult = { status: "invalid" };
  const { impl } = fakeFetchQueue(200, {});
  const app = buildApp(impl);

  const res = await app.request("/api/n8n/forward-address", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ localPart: "not valid" }),
  });

  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({
    error: "Dat is geen geldig lokaal deel van een e-mailadres.",
    code: "n8n-address-invalid",
  });
});

test("POST /api/n8n/forward-address where setLocalPart reports taken: 409, distinguishable from every other failure mode", async () => {
  setLocalPartResult = { status: "taken" };
  const { impl } = fakeFetchQueue(200, {});
  const app = buildApp(impl);

  const res = await app.request("/api/n8n/forward-address", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ localPart: "already-taken" }),
  });

  expect(res.status).toBe(409);
  expect([400, 401, 502, 503]).not.toContain(res.status);
  expect(await res.json()).toEqual({
    error: "Dit adres is al bij een ander account in gebruik.",
    code: "n8n-address-taken",
  });
});

test("POST /api/n8n/forward-address success: 200 with the stored local part echoed back", async () => {
  setLocalPartResult = { status: "stored", localPart: "ale-7f3a" };
  const { impl } = fakeFetchQueue(200, {});
  const app = buildApp(impl);

  const res = await app.request("/api/n8n/forward-address", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ localPart: "Ale" }),
  });

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ localPart: "ale-7f3a" });
});

test("POST /api/n8n/forward-address passes the body's localPart to setLocalPart unmodified, with no route-side re-validation or re-normalisation", async () => {
  const { impl } = fakeFetchQueue(200, {});
  const app = buildApp(impl);

  await app.request("/api/n8n/forward-address", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ localPart: "  Weird-Casing_Input  " }),
  });

  expect(setLocalPartCalls).toHaveLength(1);
  expect(setLocalPartCalls[0]).toEqual({ userId: "user-123", localPart: "  Weird-Casing_Input  " });
});

import { afterEach, beforeEach, expect, test } from "vitest";

/* These tests drive the REAL app from index.ts through the REAL guard. That is
 * the point: the acceptance evidence says a missing token is 401 and a read
 * token cannot call a write tool, and both are decided by the middleware and
 * route together, not by a unit of either in isolation. */
const ENV_KEYS = [
  "DATABASE_URL",
  "MCP_API_TOKEN",
  "MCP_TENANT_ID",
  "MCP_USER_EMAIL",
  "LAVEGA_ALLOW_UNAUTHENTICATED",
] as const;
const saved = new Map<string, string | undefined>();
for (const key of ENV_KEYS) saved.set(key, process.env[key]);

const { app } = await import("../index.js");

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const useEnvToken = () => {
  process.env.MCP_API_TOKEN = "test-token";
  process.env.MCP_TENANT_ID = "user-1";
};

const rpc = (method: string, params?: unknown) => ({
  jsonrpc: "2.0",
  id: 1,
  method,
  ...(params === undefined ? {} : { params }),
});

const post = (body: unknown, token?: string) =>
  app.request("/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  });

test("a request with no token is 401 with a Bearer challenge", async () => {
  const res = await post(rpc("tools/list"));
  expect(res.status).toBe(401);
  expect(res.headers.get("www-authenticate")).toContain("Bearer");
});

test("a wrong token is 401, not local-tenant data", async () => {
  useEnvToken();
  const res = await post(rpc("tools/list"), "not-the-token");
  expect(res.status).toBe(401);
});

test("the pnpm-dev escape hatch does not open /mcp: no token is still 401", async () => {
  process.env.LAVEGA_ALLOW_UNAUTHENTICATED = "1";
  const res = await post(rpc("tools/list"));
  expect(res.status).toBe(401);
});

test("an env token with no tenant configured is 401", async () => {
  process.env.MCP_API_TOKEN = "test-token";
  const res = await post(rpc("tools/list"), "test-token");
  expect(res.status).toBe(401);
});

test("a valid token can initialize and gets a session id and negotiated revision", async () => {
  useEnvToken();
  const res = await post(rpc("initialize", { protocolVersion: "2025-06-18" }), "test-token");
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    result: { protocolVersion: string; serverInfo: { name: string } };
  };
  expect(body.result.protocolVersion).toBe("2025-06-18");
  expect(body.result.serverInfo.name).toBe("lavega-investing");
  expect(res.headers.get("mcp-session-id")).toBeTruthy();
});

test("tools/list for an external read token equals the seeded read registry", async () => {
  useEnvToken();
  const res = await post(rpc("tools/list"), "test-token");
  expect(res.status).toBe(200);
  const body = (await res.json()) as { result: { tools: Array<{ name: string }> } };
  expect(body.result.tools.map((entry) => entry.name)).toEqual([
    "get_positions",
    "get_portfolio_value",
    "get_trades",
    "get_price",
    "get_fundamentals",
    "get_sector_exposure",
    "get_risk",
    "get_agent_memory",
  ]);
});

test("a read token cannot call a write tool by name; the dispatch refuses it", async () => {
  useEnvToken();
  const res = await post(rpc("tools/call", { name: "apply_rule", arguments: {} }), "test-token");
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    error: { code: number; message: string };
    result?: unknown;
  };
  expect(body.error.code).toBe(-32602);
  expect(body.error.message).toBe("Unknown tool");
  expect(body.result).toBeUndefined();
});

test("GET /mcp with a valid token is 405 with an Allow header; this endpoint is POST-only JSON-RPC", async () => {
  useEnvToken();
  const res = await app.request("/mcp", { headers: { authorization: "Bearer test-token" } });
  expect(res.status).toBe(405);
  expect(res.headers.get("allow")).toBe("POST");
});

test("GET /mcp without a token is 401, so the method is not revealed before auth", async () => {
  const res = await app.request("/mcp");
  expect(res.status).toBe(401);
});

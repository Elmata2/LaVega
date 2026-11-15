import { Schema } from "effect";
import { expect, test, vi } from "vitest";
import {
  agentToolListJson,
  buildAgentTools,
  DEFAULT_AGENT_TOOL_CAPS,
  type AgentToolDefinition,
  type CappedAgentToolResult,
} from "@lavega/core";
import type { McpAuditEntry } from "@lavega/database";
import { handleMcpRequest, mcpRouteDependencies, MCP_SERVER_INFO } from "./routes.js";
import type { McpRouteDependencies } from "./routes.js";
import { createMcpSessionStore } from "./sessions.js";
import { createRulePreviewStore } from "./previewTokens.js";
import { createInvestingWriteTools } from "@lavega/investing-server/src/tools/writeTools.js";
import { createMcpRateLimiter } from "./rateLimit.js";
import type { McpTokenIdentity } from "./tokens.js";

const identity: McpTokenIdentity = { tokenId: "token-1", tenantId: "user-1", scopes: ["read"] };

const noArguments = { type: "object" as const, properties: {}, additionalProperties: false };

const tool = (
  name: string,
  handler: (input: Record<string, unknown>) => Promise<unknown>,
  scope: "read" | "write" = "read",
): AgentToolDefinition => ({
  name,
  description: `${name} description that carries data semantics for the model`,
  schema: noArguments,
  scope,
  handler,
});

const registry = (): AgentToolDefinition[] => [
  tool("get_positions", async () => ({
    presentationCurrency: "EUR",
    positions: [{ symbol: "AAPL" }],
  })),
  tool("get_many", async () => ({ rows: Array.from({ length: 300 }, (_, index) => ({ index })) })),
  tool(
    "write_something",
    async () => {
      throw new Error("a write path must never run");
    },
    "write",
  ),
  tool("get_bad_input", async () => {
    Schema.decodeUnknownSync(Schema.Struct({ symbol: Schema.String }))({ symbol: 7 });
    return {};
  }),
  tool("get_crash", async () => {
    throw new Error("postgres://secret: hunter2 SELECT * FROM investing.api_tokens");
  }),
];

const deps = (overrides: Partial<McpRouteDependencies> = {}): McpRouteDependencies => ({
  createTools: () => registry(),
  audit: vi.fn(async () => undefined),
  sessions: createMcpSessionStore(),
  rateLimit: createMcpRateLimiter({ max: 100 }),
  previewTokens: createRulePreviewStore(),
  checkBudget: async () => ({ ok: true }),
  now: () => 1_000,
  ...overrides,
});

const call = (
  body: unknown,
  options: { deps?: McpRouteDependencies; headers?: Record<string, string> } = {},
): Promise<Response> => {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  return handleMcpRequest(
    new Request("http://local/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", ...options.headers },
      body: raw,
    }),
    identity,
    "http://local",
    options.deps ?? deps(),
  );
};

const rpc = (method: string, params?: unknown, id: unknown = 1) => ({
  jsonrpc: "2.0",
  id,
  method,
  ...(params === undefined ? {} : { params }),
});

test("initialize negotiates a supported revision and issues a session id", async () => {
  const res = await call(rpc("initialize", { protocolVersion: "2025-03-26" }));
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    jsonrpc: string;
    id: number;
    result: { protocolVersion: string; capabilities: unknown; serverInfo: unknown };
  };
  expect(body.jsonrpc).toBe("2.0");
  expect(body.id).toBe(1);
  expect(body.result.protocolVersion).toBe("2025-03-26");
  expect(body.result.serverInfo).toEqual(MCP_SERVER_INFO);
  expect(res.headers.get("mcp-session-id")).toBeTruthy();
  expect(res.headers.get("mcp-protocol-version")).toBe("2025-03-26");
});

test("initialize with an unknown revision falls back to this server's version", async () => {
  const res = await call(rpc("initialize", { protocolVersion: "1999-01-01" }));
  const body = (await res.json()) as { result: { protocolVersion: string } };
  expect(body.result.protocolVersion).toBe("2025-06-18");
});

test("tools/list equals the registry for the caller, not a second copy", async () => {
  const res = await call(rpc("tools/list"));
  const body = (await res.json()) as { result: { tools: unknown[] } };
  const expected = agentToolListJson(buildAgentTools(registry(), { scopes: ["read"] }));
  expect(body.result).toEqual(expected);
  expect((body.result.tools as Array<{ name: string }>).map((entry) => entry.name)).toEqual([
    "get_positions",
    "get_many",
    "get_bad_input",
    "get_crash",
  ]);
});

test("a read token calling a write tool by name is refused at dispatch", async () => {
  const res = await call(rpc("tools/call", { name: "write_something", arguments: {} }));
  const body = (await res.json()) as {
    error: { code: number; message: string; data: { hint: string } };
    result?: unknown;
  };
  expect(body.error.code).toBe(-32602);
  expect(body.error.message).toBe("Unknown tool");
  expect(body.result).toBeUndefined();
});

test("an unknown tool name is refused the same way as a hidden one", async () => {
  const res = await call(rpc("tools/call", { name: "delete_everything", arguments: {} }));
  const body = (await res.json()) as { error: { code: number } };
  expect(body.error.code).toBe(-32602);
});

test("tools/call returns the tool payload as text and structured content", async () => {
  const res = await call(rpc("tools/call", { name: "get_positions", arguments: {} }));
  const body = (await res.json()) as {
    result: {
      content: Array<{ type: string; text: string }>;
      structuredContent: unknown;
      isError: boolean;
      _meta: { truncated: boolean; totalRows: number };
    };
  };
  expect(body.result.isError).toBe(false);
  expect(body.result.structuredContent).toEqual({
    presentationCurrency: "EUR",
    positions: [{ symbol: "AAPL" }],
  });
  expect(JSON.parse(body.result.content[0]!.text)).toEqual(body.result.structuredContent);
  expect(body.result._meta.truncated).toBe(false);
});

test("a response over the row cap is truncated and marked, not streamed whole", async () => {
  const res = await call(rpc("tools/call", { name: "get_many", arguments: {} }));
  const body = (await res.json()) as {
    result: {
      content: Array<{ text: string }>;
      structuredContent: { rows: unknown[] };
      _meta: { truncated: boolean; keptRows: number; totalRows: number; bytes: number };
    };
  };
  expect(body.result._meta.truncated).toBe(true);
  expect(body.result._meta.totalRows).toBe(300);
  expect(body.result._meta.keptRows).toBe(DEFAULT_AGENT_TOOL_CAPS.maxRows);
  expect(body.result.structuredContent.rows).toHaveLength(DEFAULT_AGENT_TOOL_CAPS.maxRows);
  expect(body.result.content[0]!.text).toContain("[truncated:");
});

test("a schema failure is error-as-data with a retry hint and no decoder text", async () => {
  const res = await call(rpc("tools/call", { name: "get_bad_input", arguments: {} }));
  const body = (await res.json()) as {
    result: {
      isError: boolean;
      structuredContent: { error: string; hint: string };
      content: Array<{ text: string }>;
    };
  };
  expect(body.result.isError).toBe(true);
  expect(body.result.structuredContent.error).toBe("invalid_arguments");
  expect(body.result.content[0]!.text).not.toContain("Expected string");
});

test("a crashing tool leaks no internal detail across the boundary", async () => {
  const res = await call(rpc("tools/call", { name: "get_crash", arguments: {} }));
  const text = await res.text();
  expect(text).not.toContain("hunter2");
  expect(text).not.toContain("SELECT");
  expect(text).not.toContain("postgres://");
  const body = JSON.parse(text) as {
    result: { isError: boolean; structuredContent: { error: string; hint: string } };
  };
  expect(body.result.isError).toBe(true);
  expect(body.result.structuredContent).toEqual({
    error: "tool_failed",
    hint: "The tool could not answer. Retry once; do not keep retrying the same call.",
  });
});

test("a notification without an id is accepted with 202 and no body", async () => {
  const res = await call({ jsonrpc: "2.0", method: "notifications/initialized" });
  expect(res.status).toBe(202);
  expect(await res.text()).toBe("");
});

test("an unknown method is -32601 with a safe hint", async () => {
  const res = await call(rpc("resources/list"));
  const body = (await res.json()) as { error: { code: number; data: { hint: string } } };
  expect(body.error.code).toBe(-32601);
  expect(body.error.data.hint).toContain("initialize");
});

test("malformed JSON is -32700 and a malformed request is -32600", async () => {
  const parse = await call("{not json");
  expect(parse.status).toBe(400);
  expect(((await parse.json()) as { error: { code: number } }).error.code).toBe(-32700);

  const invalid = await call({ jsonrpc: "1.0", id: 2, method: "tools/list" });
  expect(invalid.status).toBe(400);
  expect(((await invalid.json()) as { error: { code: number } }).error.code).toBe(-32600);
});

test("a batch is refused: this endpoint serves one JSON-RPC object per request", async () => {
  const res = await call([rpc("tools/list")]);
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error: { code: number } }).error.code).toBe(-32600);
});

test("a session id for another token identity is refused with 404", async () => {
  const sessions = createMcpSessionStore();
  const issued = sessions.issue(identity, 1_000);
  const res = await handleMcpRequest(
    new Request("http://local/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", "mcp-session-id": issued },
      body: JSON.stringify(rpc("tools/list")),
    }),
    { ...identity, tokenId: "token-2" },
    "http://local",
    deps({ sessions }),
  );
  expect(res.status).toBe(404);
});

test("a valid session id from initialize is accepted on the next call", async () => {
  const depsWithSession = deps();
  const initialized = await call(rpc("initialize", {}), { deps: depsWithSession });
  const sessionId = initialized.headers.get("mcp-session-id")!;
  const res = await call(rpc("tools/list"), {
    deps: depsWithSession,
    headers: { "mcp-session-id": sessionId },
  });
  expect(res.status).toBe(200);
});

test("the per-token rate limit answers 429 with Retry-After", async () => {
  const limited = deps({ rateLimit: createMcpRateLimiter({ max: 1 }) });
  expect((await call(rpc("tools/list"), { deps: limited })).status).toBe(200);
  const second = await call(rpc("tools/list"), { deps: limited });
  expect(second.status).toBe(429);
  expect(second.headers.get("retry-after")).toBe("60");
});

test("every call is audited with method, tool and outcome", async () => {
  const audit = vi.fn(async (_entry: McpAuditEntry) => undefined);
  const depsWithAudit = deps({ audit });
  await call(rpc("tools/list"), { deps: depsWithAudit });
  await call(rpc("tools/call", { name: "get_positions", arguments: {} }), { deps: depsWithAudit });
  await call(rpc("tools/call", { name: "write_something", arguments: {} }), {
    deps: depsWithAudit,
  });
  await call(rpc("tools/call", { name: "get_crash", arguments: {} }), { deps: depsWithAudit });
  expect(audit.mock.calls.map((entry) => entry[0])).toEqual([
    expect.objectContaining({ method: "tools/list", tool: null, outcome: "ok" }),
    expect.objectContaining({ method: "tools/call", tool: "get_positions", outcome: "ok" }),
    expect.objectContaining({ method: "tools/call", tool: "write_something", outcome: "refused" }),
    expect.objectContaining({ method: "tools/call", tool: "get_crash", outcome: "error" }),
  ]);
});

test("production wiring reads only the investing app under the token's tenant", () => {
  const wiring = mcpRouteDependencies();
  const tools = wiring.createTools(identity, "http://local");
  expect(tools.map((entry) => entry.name)).toContain("get_positions");
  expect(tools.every((entry) => entry.scope === "read")).toBe(true);
});

test("a tool result is a CappedAgentToolResult, so caps are always part of the contract", async () => {
  const res = await call(rpc("tools/call", { name: "get_positions", arguments: {} }));
  const body = (await res.json()) as { result: { _meta: CappedAgentToolResult } };
  expect(body.result._meta).toMatchObject({ truncated: false, keptRows: 1, totalRows: 1 });
});

/* WS5.4/WS5.7 (#299): the write pair through the real registry, and the spend
 * gate on every tool call. */

const writeIdentity: McpTokenIdentity = {
  tokenId: "token-write",
  tenantId: "user-1",
  scopes: ["write"],
};

const writeCall = (
  body: unknown,
  deps: McpRouteDependencies,
  token: McpTokenIdentity = writeIdentity,
): Promise<Response> =>
  handleMcpRequest(
    new Request("http://local/mcp", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    token,
    "http://local",
    deps,
  );

test("a write token previews a rule, changes nothing, then applies it once", async () => {
  const previewTokens = createRulePreviewStore();
  const applyPreview = vi.fn(async () => undefined);
  const writeTools = createInvestingWriteTools({
    recordValuation: async ({ date, totalCents, citation }) => ({
      applied: true as const,
      date,
      totalCents,
      citation,
    }),
    currentEntries: async () => [{ broker: "trading212", account: "ISA", wrapper: "unknown" }],
    storePreview: async ({ entries, changes, ttlMs }) => {
      const issued = previewTokens.issue({
        tenantId: "user-1",
        tokenId: "token-write",
        entries,
        changes,
        now: 1_000,
        ...(ttlMs === undefined ? {} : { ttlMs }),
      });
      return { previewToken: issued.previewToken, expiresAt: issued.expiresAt };
    },
    applyPreview: async (previewToken) => {
      const stored = previewTokens.consume({
        previewToken,
        tenantId: "user-1",
        tokenId: "token-write",
        now: 2_000,
      });
      if (!stored) throw new Error("Preview token is unknown, used or expired");
      await applyPreview();
      return { applied: true as const, entries: [...stored.entries] };
    },
  });
  const routeDeps = deps({
    createTools: () => writeTools,
    previewTokens,
    checkBudget: async () => ({ ok: true }),
  });

  const previewResponse = await writeCall(
    rpc("tools/call", {
      name: "preview_rule",
      arguments: { entries: [{ broker: "trading212", account: "ISA", wrapper: "isa" }] },
    }),
    routeDeps,
  );
  const preview = (await previewResponse.json()) as {
    result: {
      isError: boolean;
      structuredContent: { applied: boolean; valid: boolean; previewToken: string };
    };
  };
  expect(preview.result.isError).toBe(false);
  expect(preview.result.structuredContent).toMatchObject({ applied: false, valid: true });
  expect(applyPreview).not.toHaveBeenCalled();

  const apply = (await (
    await writeCall(
      rpc("tools/call", {
        name: "apply_rule",
        arguments: { previewToken: preview.result.structuredContent.previewToken },
      }),
      routeDeps,
    )
  ).json()) as { result: { isError: boolean; structuredContent: { applied: boolean } } };
  expect(apply.result.isError).toBe(false);
  expect(apply.result.structuredContent).toMatchObject({ applied: true });
  expect(applyPreview).toHaveBeenCalledTimes(1);

  // The token is single-use: a second apply changes nothing.
  const replay = (await (
    await writeCall(
      rpc("tools/call", {
        name: "apply_rule",
        arguments: { previewToken: preview.result.structuredContent.previewToken },
      }),
      routeDeps,
    )
  ).json()) as { result: { isError: boolean; structuredContent: { applied: boolean } } };
  expect(replay.result.structuredContent.applied).toBe(false);
  expect(applyPreview).toHaveBeenCalledTimes(1);
});

test("the spend gate refuses every tool call before dispatch", async () => {
  const handler = vi.fn(async () => ({ ok: true }));
  const routeDeps = deps({
    createTools: () => [tool("get_positions", handler)],
    checkBudget: async () => ({ ok: false, scope: "day" }),
  });

  const res = await writeCall(
    rpc("tools/call", { name: "get_positions", arguments: {} }),
    routeDeps,
    identity,
  );

  expect(handler).not.toHaveBeenCalled();
  const body = (await res.json()) as {
    result: { isError: boolean; structuredContent: { error: string; hint: string } };
  };
  expect(body.result.isError).toBe(true);
  expect(body.result.structuredContent.error).toBe("budget_exhausted");
  expect(body.result.structuredContent.hint).toContain("Nothing was executed");
});

test("an unreadable spend gate fails closed with safe error data", async () => {
  const handler = vi.fn(async () => ({ ok: true }));
  const routeDeps = deps({
    createTools: () => [tool("get_positions", handler)],
    checkBudget: async () => ({ ok: false, scope: "unavailable" }),
  });

  const res = await writeCall(
    rpc("tools/call", { name: "get_positions", arguments: {} }),
    routeDeps,
    identity,
  );

  expect(handler).not.toHaveBeenCalled();
  const body = (await res.json()) as {
    result: { structuredContent: { error: string; hint: string } };
  };
  expect(body.result.structuredContent.error).toBe("budget_unavailable");
});

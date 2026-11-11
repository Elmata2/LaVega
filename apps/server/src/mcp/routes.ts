/*
 * The `/mcp` endpoint: JSON-RPC 2.0 over HTTP for external agents
 * (#285, ADR 0012; plan §3 WS5.2).
 *
 * Sure source: `app/controllers/mcp_controller.rb` at pinned commit 562fe09
 * (methods, notification handling, session id, protocol echo, error-as-data).
 * This is the mount point ADR 0012 chose: `apps/server`, the process that
 * already owns auth and tenant resolution. The standalone investing server
 * never mounts it, because that server has no auth and resolves a local tenant.
 *
 * The trust boundary in one sentence: the bearer token names the tenant, the
 * registry is built FROM that token's scopes, and the only thing a tool may do
 * is a GET on an allowlisted read path of the investing app.
 */

import type { Hono } from "hono";
import {
  agentToolListJson,
  buildAgentTools,
  capAgentToolResult,
  findAgentTool,
  type AgentToolDefinition,
  type AgentToolScope,
  type CappedAgentToolResult,
} from "@lavega/core";
import { createInvestingReadTools } from "@lavega/investing-server/src/tools/investingTools.js";
import type { McpAuditEntry } from "@lavega/database";
import { MCP_PATH, mcpIdentity } from "../apiGuard.js";
import { recordMcpAudit, type McpAuditSink } from "./audit.js";
import { createMcpInvestingRead } from "./investingRead.js";
import {
  isJsonRpcId,
  jsonRpcError,
  jsonRpcResult,
  JSON_RPC_CODES,
  MCP_PROTOCOL_VERSION,
  negotiateProtocolVersion,
  type JsonRpcId,
} from "./protocol.js";
import {
  createMcpRateLimiter,
  MCP_RATE_LIMIT_DEFAULT_PER_MINUTE,
  type McpRateLimiter,
} from "./rateLimit.js";
import { createMcpSessionStore, type McpSessionStore } from "./sessions.js";
import type { McpTokenIdentity } from "./tokens.js";

export const MCP_SERVER_INFO = { name: "lavega-investing", version: "1.0.0" } as const;

const MCP_INSTRUCTIONS =
  "Read-only LaVega investing data for the token's own account. Money is a decimal amount in the portfolio's presentation currency; a null value means unknown, not zero. Never ask for a tenant id: the token names it.";

export type McpRouteDependencies = {
  /** Build the caller's registry. Handlers must be bound to the caller's tenant. */
  createTools(identity: McpTokenIdentity, origin: string): readonly AgentToolDefinition[];
  audit: McpAuditSink;
  sessions: McpSessionStore;
  rateLimit: McpRateLimiter;
  now?: () => number;
  serverInfo?: { name: string; version: string };
};

/** Production wiring. Tests replace the pieces they need to observe. */
export function mcpRouteDependencies(
  overrides: Partial<McpRouteDependencies> = {},
): McpRouteDependencies {
  const configured = Number(
    process.env.MCP_RATE_LIMIT_PER_MINUTE ?? MCP_RATE_LIMIT_DEFAULT_PER_MINUTE,
  );
  return {
    createTools: (identity, origin) =>
      createInvestingReadTools(createMcpInvestingRead(identity.tenantId, origin)),
    audit: recordMcpAudit,
    sessions: createMcpSessionStore(),
    rateLimit: createMcpRateLimiter({
      max: Number.isFinite(configured) ? configured : MCP_RATE_LIMIT_DEFAULT_PER_MINUTE,
    }),
    ...overrides,
  };
}

const responseHeaders = (): Record<string, string> => ({
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
});

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...responseHeaders(), ...headers },
  });
}

const acceptedResponse = () => new Response(null, { status: 202, headers: responseHeaders() });

const objectParams = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Echo the negotiated protocol revision when the client states one. */
const protocolEcho = (request: Request): Record<string, string> => {
  const requested = request.headers.get("mcp-protocol-version");
  return requested ? { "Mcp-Protocol-Version": negotiateProtocolVersion(requested) } : {};
};

/** A successful tool result: text for every client, structured content when the payload is an object. */
function toolCallSuccess(name: string, capped: CappedAgentToolResult): Record<string, unknown> {
  const json = JSON.stringify(capped.value) ?? "null";
  const text = capped.truncated
    ? `${json}\n[truncated: response cap reached — ${capped.keptRows} of ${capped.totalRows} rows returned, ${capped.bytes} bytes]`
    : json;
  return {
    content: [{ type: "text", text }],
    ...(isPlainObject(capped.value) ? { structuredContent: capped.value } : {}),
    _meta: {
      tool: name,
      truncated: capped.truncated,
      totalRows: capped.totalRows,
      keptRows: capped.keptRows,
      bytes: capped.bytes,
    },
    isError: false,
  };
}

/**
 * A failed tool call. Sure's pattern: errors are RESULT DATA with a hint, and
 * the boundary sends a generic message — never the exception, SQL or a path.
 */
function toolCallFailure(name: string, error: unknown): Record<string, unknown> {
  const schemaError = (error as { _tag?: unknown } | null)?._tag === "SchemaError";
  const payload = schemaError
    ? {
        error: "invalid_arguments",
        hint: "Check the argument names and types against tools/list, then retry once.",
      }
    : {
        error: "tool_failed",
        hint: "The tool could not answer. Retry once; do not keep retrying the same call.",
      };
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
    _meta: { tool: name, error: payload.error },
    isError: true,
  };
}

const toolCallResult = (name: string, capped: CappedAgentToolResult): Record<string, unknown> =>
  toolCallSuccess(name, capped);

function visibleTools(
  tools: readonly AgentToolDefinition[],
  scopes: readonly AgentToolScope[],
): readonly AgentToolDefinition[] {
  return buildAgentTools(tools, { scopes });
}

/**
 * Handle one authenticated `/mcp` POST. Split from the Hono route so the
 * protocol can be tested without a server, and so the guard's authentication
 * is the only path to a caller identity.
 */
export async function handleMcpRequest(
  request: Request,
  identity: McpTokenIdentity,
  origin: string,
  deps: McpRouteDependencies,
): Promise<Response> {
  const now = deps.now ?? (() => Date.now());
  const startedAt = now();
  const audit = async (
    method: string,
    tool: string | null,
    outcome: McpAuditEntry["outcome"],
  ): Promise<void> => {
    /* Audit is a side effect; a failed insert must never change the answer. */
    await deps
      .audit({ tokenId: identity.tokenId, method, tool, durationMs: now() - startedAt, outcome })
      .catch(() => undefined);
  };

  if (!deps.rateLimit.consume(identity.tokenId, startedAt)) {
    return jsonResponse(
      429,
      {
        error: "rate_limited",
        hint: "The per-token limit is one minute's quota; wait, then retry.",
      },
      { "Retry-After": "60" },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    await audit("unknown", null, "refused");
    return jsonResponse(400, jsonRpcError(null, JSON_RPC_CODES.parseError, "Parse error"));
  }
  if (!isPlainObject(payload)) {
    await audit("unknown", null, "refused");
    return jsonResponse(
      400,
      jsonRpcError(null, JSON_RPC_CODES.invalidRequest, "Invalid Request"),
    );
  }

  const method = typeof payload.method === "string" ? payload.method : "";
  if (payload.jsonrpc !== "2.0" || method === "") {
    await audit(method || "unknown", null, "refused");
    return jsonResponse(
      400,
      jsonRpcError(
        isJsonRpcId(payload.id) ? payload.id : null,
        JSON_RPC_CODES.invalidRequest,
        "Invalid Request",
      ),
    );
  }

  /* No `id` member = notification: 202 and no body, exactly as Sure answers.
   * The request is not dispatched, because a notification expects no result. */
  if (!("id" in payload)) {
    await audit(method, null, "ok");
    return acceptedResponse();
  }
  if (!isJsonRpcId(payload.id)) {
    await audit(method, null, "refused");
    return jsonResponse(
      400,
      jsonRpcError(null, JSON_RPC_CODES.invalidRequest, "Invalid Request"),
    );
  }
  const id: JsonRpcId = payload.id;
  const params = objectParams(payload.params);

  /* A session id that is present must belong to THIS token's identity, or a
   * leaked id would be usable from another token. Unknown/expired is a 404, the
   * MCP transport's answer for a session the client must re-initialize. */
  const sessionId = request.headers.get("mcp-session-id");
  if (method !== "initialize" && sessionId && !deps.sessions.matches(sessionId, identity, startedAt)) {
    await audit(method, null, "refused");
    return jsonResponse(
      404,
      jsonRpcError(id, JSON_RPC_CODES.invalidRequest, "Session not found"),
    );
  }

  const tools = deps.createTools(identity, origin);

  switch (method) {
    case "initialize": {
      const protocolVersion = negotiateProtocolVersion(params.protocolVersion);
      const issued = deps.sessions.issue(identity, startedAt);
      await audit(method, null, "ok");
      return jsonResponse(
        200,
        jsonRpcResult(id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: deps.serverInfo ?? MCP_SERVER_INFO,
          instructions: MCP_INSTRUCTIONS,
        }),
        { "Mcp-Session-Id": issued, "Mcp-Protocol-Version": protocolVersion },
      );
    }

    case "tools/list": {
      const list = agentToolListJson(visibleTools(tools, identity.scopes));
      await audit(method, null, "ok");
      return jsonResponse(200, jsonRpcResult(id, list), protocolEcho(request));
    }

    case "tools/call": {
      const name = typeof params.name === "string" ? params.name : "";
      if (!name) {
        await audit(method, null, "refused");
        return jsonResponse(
          200,
          jsonRpcError(id, JSON_RPC_CODES.invalidParams, "Invalid params", {
            hint: "tools/call needs {name, arguments}.",
          }),
        );
      }
      /* Dispatch looks the tool up in the SAME filtered array `tools/list`
       * returned, so a hidden write or preview tool is refused by name. */
      const tool = findAgentTool(visibleTools(tools, identity.scopes), name);
      if (!tool) {
        await audit(method, name, "refused");
        return jsonResponse(
          200,
          jsonRpcError(id, JSON_RPC_CODES.invalidParams, "Unknown tool", {
            hint: "Call tools/list. A tool outside this token's scopes is not callable by name.",
          }),
          protocolEcho(request),
        );
      }
      const args = objectParams(params.arguments);
      try {
        const value = await tool.handler(args);
        const capped = capAgentToolResult(value);
        await audit(method, name, "ok");
        return jsonResponse(200, jsonRpcResult(id, toolCallResult(name, capped)), protocolEcho(request));
      } catch (error) {
        await audit(method, name, "error");
        return jsonResponse(
          200,
          jsonRpcResult(id, toolCallFailure(name, error)),
          protocolEcho(request),
        );
      }
    }

    default: {
      await audit(method, null, "refused");
      return jsonResponse(
        200,
        jsonRpcError(id, JSON_RPC_CODES.methodNotFound, "Method not found", {
          hint: "Supported: initialize, tools/list, tools/call.",
        }),
        protocolEcho(request),
      );
    }
  }
}

/**
 * Mount `/mcp`. The route requires an identity set by `apiGuard`, which runs
 * before it; a route reached without one is refused rather than trusted.
 */
export function registerMcpRoutes<T extends Hono>(app: T, deps: McpRouteDependencies): T {
  app.all(MCP_PATH, async (c) => {
    if (c.req.method !== "POST") {
      c.header("Allow", "POST");
      return c.json({ error: "method not allowed" }, 405);
    }
    const identity = mcpIdentity(c);
    if (!identity) {
      const response = c.json({ error: "unauthorized" }, 401);
      response.headers.set("WWW-Authenticate", 'Bearer realm="lavega-mcp"');
      return response;
    }
    return handleMcpRequest(c.req.raw, identity, new URL(c.req.url).origin, deps);
  });
  return app;
}

/** Exposed for the docs generator and tests: the revision this server prefers. */
export { MCP_PROTOCOL_VERSION };

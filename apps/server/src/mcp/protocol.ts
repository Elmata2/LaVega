/*
 * Ported from Sure (we-promise/sure) commit 562fe09 — AGPL-3.0 — independently
 * reimplemented for LaVega; changed 2026-11-11.
 *
 * JSON-RPC 2.0 over HTTP, as MCP's Streamable HTTP transport defines it
 * (#285, ADR 0012 §7).
 *
 * Sure source: `app/controllers/mcp_controller.rb` at pinned commit 562fe09.
 * Sure accepts two protocol revisions, answers a notification without an `id`
 * with 202 and an empty body, and maps every other method to -32601. The safe
 * messages here are the LaVega version of Sure's "generic message at the MCP
 * boundary so internal SQL or storage details never cross the trust boundary".
 */

/** The version this server speaks first. */
export const MCP_PROTOCOL_VERSION = "2025-06-18";

/** Accepted client revisions, newest first. An unknown revision negotiates down. */
export const MCP_SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26"] as const;

export const JSON_RPC_CODES = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const;

export type JsonRpcId = string | number | null;

export type JsonRpcErrorBody = {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly error: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
};

export type JsonRpcResultBody = {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly result: unknown;
};

/** Echo a supported revision; anything else falls back to this server's version. */
export function negotiateProtocolVersion(requested: unknown): string {
  return typeof requested === "string" &&
    (MCP_SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
    ? requested
    : MCP_PROTOCOL_VERSION;
}

export function jsonRpcResult(id: JsonRpcId, result: unknown): JsonRpcResultBody {
  return { jsonrpc: "2.0", id, result };
}

export function jsonRpcError(
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcErrorBody {
  return {
    jsonrpc: "2.0",
    id,
    error: data === undefined ? { code, message } : { code, message, data },
  };
}

/** A caller can send any JSON value as `id`; only string, number and null are legal. */
export function isJsonRpcId(value: unknown): value is JsonRpcId {
  return value === null || typeof value === "string" || typeof value === "number";
}

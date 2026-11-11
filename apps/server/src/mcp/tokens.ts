/*
 * Bearer-token authentication for `/mcp` (ADR 0012 §2, §3).
 *
 * Sure source: `app/controllers/mcp_controller.rb` at pinned commit 562fe09.
 * Sure tries a Doorkeeper OAuth token first, then a static `MCP_API_TOKEN`
 * compared in constant time. LaVega keeps the hashed-table path as the main
 * one and the env pair as the single-user, no-database fallback.
 *
 * Two rules this module exists to enforce:
 *
 *   1. A token resolves to a TENANT. Missing, unknown, expired or revoked =>
 *      null, never a local fallback. The caller turns null into 401.
 *   2. The env fallback is for an install with NO database. When DATABASE_URL
 *      is set, the hashed table is the only authority, so a stray env token
 *      cannot bypass revocation.
 */

import { createHash } from "node:crypto";
import { isAgentToolScope, type AgentToolScope } from "@lavega/core";
import { createMcpTokenRepository } from "@lavega/database";
import { runtimeDatabase } from "@lavega/investing-server/src/credentialStore.js";
import { secretsMatch } from "../secrets.js";

export type McpTokenIdentity = {
  /** The token row id, or the literal 'env'. Recorded in the audit. */
  readonly tokenId: string;
  /** The account this token acts for. Every tool runs under this value. */
  readonly tenantId: string;
  readonly scopes: readonly AgentToolScope[];
};

/** The digest a token row stores. Raw tokens never reach the database. */
export function hashMcpToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/** A `Bearer` credential from the Authorization header, or null. */
export function mcpBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

/**
 * The environment fallback: `MCP_API_TOKEN` plus the tenant it acts for.
 *
 * `MCP_TENANT_ID` is the documented name. `MCP_USER_EMAIL` is accepted as an
 * alias because ADR 0012 names it, and on a no-database install an operator may
 * have set only that — but a self-host install should set `MCP_TENANT_ID` to the
 * tenant its stores use (`local` for the file-backed single-tenant runtime).
 *
 * A token WITHOUT a tenant configured resolves to nothing: 401, not local data.
 *
 * Two env tokens exist because the plan keeps write behind a SEPARATE credential
 * (WS5.4): `MCP_API_TOKEN` is read-only, `MCP_WRITE_API_TOKEN` carries the write
 * scope. They must differ; the read token is checked first, so an operator who
 * sets one value for both gets the read-only identity.
 */
export function envMcpTokenIdentity(raw: string): McpTokenIdentity | null {
  /* The table is the only authority once there is a database; see the header. */
  if (process.env.DATABASE_URL?.trim()) return null;
  const tenantId = process.env.MCP_TENANT_ID?.trim() || process.env.MCP_USER_EMAIL?.trim() || "";
  if (!tenantId) return null;
  const readToken = process.env.MCP_API_TOKEN?.trim();
  if (readToken && secretsMatch(raw, readToken))
    return { tokenId: "env", tenantId, scopes: ["read"] };
  const writeToken = process.env.MCP_WRITE_API_TOKEN?.trim();
  if (writeToken && secretsMatch(raw, writeToken))
    /* A write token also reads: its previews are described from the reads. */
    return { tokenId: "env-write", tenantId, scopes: ["read", "write"] };
  return null;
}

/** Resolve one raw bearer token to its tenant and scopes. Null = 401. */
export type McpTokenResolver = (raw: string) => Promise<McpTokenIdentity | null>;

export const resolveMcpToken: McpTokenResolver = async (raw) => {
  const fromEnv = envMcpTokenIdentity(raw);
  if (fromEnv) return fromEnv;

  const database = runtimeDatabase();
  if (!database) return null;
  const repository = createMcpTokenRepository(database);
  const now = new Date();
  const row = await repository.resolve(hashMcpToken(raw), now);
  if (!row) return null;
  /* A stored row with no recognized scope authenticates nothing. This also
   * makes 'read_write' from a copy-pasted Sure token a 401 rather than a
   * surprise write scope. */
  const scopes = row.scopes.filter(isAgentToolScope);
  if (scopes.length === 0) return null;
  /* Best-effort: a failed touch must not fail an otherwise valid call. */
  void repository.touch(row.id, now).catch(() => undefined);
  return { tokenId: row.id, tenantId: row.userId, scopes };
};

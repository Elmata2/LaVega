import type { Database } from "./index.js";

/*
 * Ported from Sure (we-promise/sure) commit 562fe09 — AGPL-3.0 — independently
 * reimplemented for LaVega; changed 2026-11-11.
 *
 * Read-only MCP tokens and their audit rows (#285, ADR 0012).
 *
 * Sure source: `app/controllers/mcp_controller.rb` at pinned commit 562fe09.
 * Sure stores a Doorkeeper OAuth token and reads the active user; LaVega keeps
 * its own smaller shape: a SHA-256 digest, the account the token acts for, and
 * an explicit scope allowlist. The token itself is never stored, so a database
 * read cannot replay it.
 *
 * Both statements run OUTSIDE a tenant transaction on purpose: the token is what
 * names the tenant, so there is no `app.user_id` to scope by yet. See
 * 0027_mcp_tokens.sql for why neither table carries RLS.
 */

export type McpTokenRow = {
  /** The row's id, recorded in the audit. */
  readonly id: string;
  /** The account the token acts for; this is the tenant every tool runs under. */
  readonly userId: string;
  /** Raw scopes from the row; the caller parses them with `isAgentToolScope`. */
  readonly scopes: readonly string[];
};

export type McpAuditEntry = {
  /** Token row id, or the literal 'env' for the no-database fallback. */
  readonly tokenId: string;
  readonly method: string;
  readonly tool: string | null;
  readonly durationMs: number;
  readonly outcome: "ok" | "refused" | "error";
};

export type McpTokenRepository = {
  /** The live token row for this digest, or null when unknown, expired or revoked. */
  resolve(tokenHash: string, at: Date): Promise<McpTokenRow | null>;
  /** Record use. Best-effort: a failed touch must not fail the call. */
  touch(id: string, at: Date): Promise<void>;
  /** One audit row per call. */
  audit(entry: McpAuditEntry): Promise<void>;
  /** Insert a new token digest. The raw token never reaches this module. */
  create(input: {
    userId: string;
    tokenHash: string;
    label: string | null;
    scopes: readonly string[];
  }): Promise<string>;
  /** Revoke by row id; false when the row does not exist or was already revoked. */
  revoke(id: string, at: Date): Promise<boolean>;
};

export function createMcpTokenRepository(db: Database): McpTokenRepository {
  return {
    async resolve(tokenHash, at) {
      const result = (await db.http.query(
        `SELECT id, user_id, scopes
           FROM investing.api_tokens
          WHERE token_hash = $1
            AND revoked_at IS NULL
            AND (expires_at IS NULL OR expires_at > $2::timestamptz)`,
        [tokenHash, at.toISOString()],
      )) as unknown as { rows: Array<{ id: string; user_id: string; scopes: string[] }> };
      const row = result.rows[0];
      return row ? { id: row.id, userId: row.user_id, scopes: row.scopes } : null;
    },

    async touch(id, at) {
      await db.http.query(
        `UPDATE investing.api_tokens SET last_used_at = $2::timestamptz WHERE id = $1::uuid`,
        [id, at.toISOString()],
      );
    },

    async audit(entry) {
      await db.http.query(
        `INSERT INTO investing.mcp_audit (token_id, method, tool, duration_ms, outcome)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          entry.tokenId,
          entry.method,
          entry.tool,
          Math.max(0, Math.round(entry.durationMs)),
          entry.outcome,
        ],
      );
    },

    async create(input) {
      const result = (await db.http.query(
        `INSERT INTO investing.api_tokens (user_id, token_hash, label, scopes)
         VALUES ($1, $2, $3, $4::text[])
         RETURNING id`,
        [input.userId, input.tokenHash, input.label, [...input.scopes]],
      )) as unknown as { rows: Array<{ id: string }> };
      const id = result.rows[0]?.id;
      if (!id) throw new Error("api_tokens insert returned no id");
      return id;
    },

    async revoke(id, at) {
      const result = (await db.http.query(
        `UPDATE investing.api_tokens
            SET revoked_at = $2::timestamptz
          WHERE id = $1::uuid AND revoked_at IS NULL
          RETURNING id`,
        [id, at.toISOString()],
      )) as unknown as { rows: Array<{ id: string }> };
      return result.rows.length > 0;
    },
  };
}

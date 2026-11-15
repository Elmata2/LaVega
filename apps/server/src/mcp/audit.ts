/*
 * Audit trail for `/mcp` (ADR 0012 §6: "an audit row per call").
 *
 * With a database the row lands in `investing.mcp_audit` (migration 0027);
 * without one — the self-hosted single-user path — the same fields go to stdout
 * as one JSON line, so the operator still has the trail. Neither path stores
 * the raw bearer token or an argument value.
 */

import { createMcpTokenRepository, type McpAuditEntry } from "@lavega/database";
import { runtimeDatabase } from "@lavega/investing-server/src/credentialStore.js";

export type McpAuditSink = (entry: McpAuditEntry) => Promise<void>;

export const recordMcpAudit: McpAuditSink = async (entry) => {
  const database = runtimeDatabase();
  if (database) {
    /* A failed audit insert must not fail the call it audits: the call already
     * happened, and a 500 here would tell the caller the tool failed when it
     * did not. */
    await createMcpTokenRepository(database)
      .audit(entry)
      .catch((error: unknown) => {
        console.error("[mcp] audit row not written", error instanceof Error ? error.message : error);
      });
    return;
  }
  console.info(JSON.stringify({ event: "mcp.call", ...entry }));
};

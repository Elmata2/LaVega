import type { QueryResultRow } from "@neondatabase/serverless";
import { requireUserId, withTenantStatement, type Database } from "./connection.js";
import { isoDate } from "./sharedPrices.js";

export type AgentRunRow = {
  id: string;
  agentId?: string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "done" | "error";
  summary: string | null;
  error: string | null;
  result?: unknown;
};

export const AGENT_RUN_STALE_MS = 15 * 60_000;

const AGENT_STATUS_TO_COLUMN = { running: "running", done: "succeeded", error: "failed" } as const;
const AGENT_STATUS_FROM_COLUMN: Record<string, AgentRunRow["status"]> = {
  running: "running",
  queued: "running",
  succeeded: "done",
  failed: "error",
  cancelled: "error",
};

/** Only the latest run per user is kept; this is operational state, not history. */
export function createAgentRunRepository(
  db: Database,
  userId: string | undefined | null,
  options: { staleAfterMs?: number; now?: () => number } = {},
) {
  const tenantId = requireUserId(userId);
  const staleAfterMs = options.staleAfterMs ?? AGENT_RUN_STALE_MS;
  const now = options.now ?? (() => Date.now());
  return {
    async get(): Promise<AgentRunRow | null> {
      return withTenantStatement(db, tenantId, async (client) => {
        const result = await client.query<QueryResultRow>(
          "SELECT run_id, status, run_result, started_at, finished_at FROM investing.agent_runs",
        );
        const row = result.rows[0];
        if (!row) return null;
        const runResult = (row.run_result ?? {}) as {
          agentId?: string | null;
          summary?: string | null;
          error?: string | null;
          result?: unknown;
        };
        const startedAt = isoDate(row.started_at) ?? new Date(0).toISOString();
        let status: AgentRunRow["status"] = AGENT_STATUS_FROM_COLUMN[row.status as string] ?? "error";
        let error = runResult.error ?? null;
        if (
          status === "running" &&
          staleAfterMs > 0 &&
          now() - Date.parse(startedAt) > staleAfterMs
        ) {
          status = "error";
          error = error ?? "Agent run timed out";
        }
        return {
          id: row.run_id as string,
          agentId: runResult.agentId ?? undefined,
          startedAt,
          finishedAt: isoDate(row.finished_at),
          status,
          summary: runResult.summary ?? null,
          error,
          result: runResult.result,
        };
      });
    },
    async start(record: AgentRunRow): Promise<boolean> {
      return withTenantStatement(db, tenantId, async (client) => {
        const staleBefore = new Date(now() - staleAfterMs).toISOString();
        const result = await client.query(
          `INSERT INTO investing.agent_runs (user_id, run_id, status, run_result, started_at, finished_at)
           VALUES (current_setting('app.user_id'), $1, $2, $3::jsonb, $4, $5)
           ON CONFLICT (user_id) DO UPDATE SET
             run_id = EXCLUDED.run_id,
             status = EXCLUDED.status,
             run_result = EXCLUDED.run_result,
             started_at = EXCLUDED.started_at,
             finished_at = EXCLUDED.finished_at,
             updated_at = CURRENT_TIMESTAMP
           WHERE investing.agent_runs.started_at < EXCLUDED.started_at
              OR (
                investing.agent_runs.started_at <= EXCLUDED.started_at
                AND investing.agent_runs.status IN ('running', 'queued')
                AND investing.agent_runs.started_at < $6::timestamptz
              )
           RETURNING run_id`,
          [
            record.id,
            AGENT_STATUS_TO_COLUMN[record.status],
            JSON.stringify({
              agentId: record.agentId,
              summary: record.summary,
              error: record.error,
              result: record.result,
            }),
            record.startedAt,
            record.finishedAt,
            staleBefore,
          ],
        );
        return result.rows.length > 0;
      });
    },
    async finish(record: AgentRunRow): Promise<boolean> {
      return withTenantStatement(db, tenantId, async (client) => {
        const result = await client.query(
          "UPDATE investing.agent_runs SET status = $2, run_result = $3::jsonb, finished_at = $4, updated_at = CURRENT_TIMESTAMP WHERE run_id = $1 AND status IN ('running', 'queued') RETURNING run_id",
          [
            record.id,
            AGENT_STATUS_TO_COLUMN[record.status],
            JSON.stringify({
              agentId: record.agentId,
              summary: record.summary,
              error: record.error,
              result: record.result,
            }),
            record.finishedAt,
          ],
        );
        return result.rows.length > 0;
      });
    },
  };
}

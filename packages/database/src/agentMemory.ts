import type { QueryResultRow } from "@neondatabase/serverless";
import {
  decryptBlob,
  encryptBlob,
  requireUserId,
  withTenant,
  withTenantStatement,
  type Database,
} from "./index.js";

/*
 * Portfolio agent memory (ADR 0007, migration 0020). Terms follow the
 * investing glossary in docs/CONTEXT.md. Threads and observations belong to
 * one agent; theses, goals and risk tolerance are shared by all agents.
 *
 * Free text is sealed with encryptBlob before it reaches Neon, so every filter
 * here is on a plain column: agent, symbol, status or time.
 */

export const RISK_TOLERANCES = ["conservative", "balanced", "aggressive"] as const;
export type RiskTolerance = (typeof RISK_TOLERANCES)[number];

export type ThesisStatus = "active" | "dormant";
/** Why the owner holds it, what they think it is worth, why they bought, and
 *  what would prove them wrong. Only `why` is required. */
export type ThesisBody = {
  why: string;
  worth: string | null;
  entry: string | null;
  wrongIf: string | null;
};
export type Thesis = ThesisBody & { symbol: string; status: ThesisStatus; updatedAt: string };

export type Goal = {
  id: string;
  /** Null for a portfolio-wide goal. */
  symbol: string | null;
  text: string;
  /** The thread it was agreed in; null once that thread is deleted. */
  sourceThreadId: string | null;
  updatedAt: string;
};

export type Observation = {
  id: string;
  agentId: string;
  threadId: string;
  symbol: string | null;
  text: string;
  createdAt: string;
};

export type ThreadSummary = {
  id: string;
  agentId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

/** What every chat turn reads before the model is called. */
export type MemorySummary = {
  riskTolerance: RiskTolerance | null;
  goals: Goal[];
  /** Theses of the holdings the message names, plus every dormant thesis of
   *  a symbol held again. Never a dormant thesis of a symbol not held. */
  theses: Thesis[];
};

export type RecallQuery =
  | { kind: "theses"; symbol?: string }
  | { kind: "goals"; symbol?: string }
  | { kind: "observations"; agentId: string; symbol?: string; since?: string }
  | { kind: "threads"; agentId: string; since?: string };

export type RecallResult =
  | { kind: "theses"; theses: Thesis[] }
  | { kind: "goals"; goals: Goal[] }
  | { kind: "observations"; observations: Observation[] }
  | { kind: "threads"; threads: ThreadSummary[] };

export type LetterObservation = { title: string; body: string; figures: string[] };

/** The portfolio letter (Munger-03): one per broker-sync snapshot. */
export type PortfolioLetter = {
  id: string;
  snapshotHash: string;
  holdingsHash: string;
  createdAt: string;
  verdict: string;
  /** At most three. */
  observations: LetterObservation[];
};

export type AgentMemoryExport = {
  riskTolerance: RiskTolerance | null;
  threads: Array<ThreadSummary & { messages: unknown[] }>;
  theses: Thesis[];
  goals: Goal[];
  observations: Observation[];
  letters: PortfolioLetter[];
};

export type AgentMemoryRepository = {
  /**
   * One statement. `held` is every symbol the owner holds now, `named` the
   * held symbols this turn is about. With `closeUnheld`, an active thesis of a
   * symbol no longer held turns dormant in the same statement.
   */
  summary(input: { held: string[]; named: string[]; closeUnheld: boolean }): Promise<MemorySummary>;
  /** Creates the thread on first use. Refuses a thread of another agent. */
  appendMessages(
    threadId: string,
    agentId: string,
    title: string,
    messages: readonly unknown[],
  ): Promise<void>;
  listThreads(agentId: string): Promise<ThreadSummary[]>;
  getThread(threadId: string): Promise<(ThreadSummary & { messages: unknown[] }) | null>;
  /** Deletes its messages and observations. Theses and goals stay. */
  deleteThread(threadId: string): Promise<boolean>;
  /** The owner confirmed it: stores it and makes it active. */
  confirmThesis(symbol: string, body: ThesisBody): Promise<Thesis>;
  /** Changes the text of an existing thesis and keeps its status. */
  editThesis(symbol: string, body: ThesisBody): Promise<Thesis | null>;
  listTheses(): Promise<Thesis[]>;
  confirmGoal(input: {
    symbol: string | null;
    text: string;
    sourceThreadId: string | null;
  }): Promise<Goal>;
  editGoal(id: string, input: { symbol: string | null; text: string }): Promise<Goal | null>;
  listGoals(): Promise<Goal[]>;
  addObservation(input: {
    agentId: string;
    threadId: string;
    symbol: string | null;
    text: string;
  }): Promise<Observation>;
  recall(query: RecallQuery, limit: number): Promise<RecallResult>;
  getRiskTolerance(): Promise<RiskTolerance | null>;
  setRiskTolerance(value: RiskTolerance | null): Promise<void>;
  latestLetter(): Promise<PortfolioLetter | null>;
  /** Stores the letter unless one exists for its snapshot; returns the stored one. */
  saveLetter(letter: Omit<PortfolioLetter, "createdAt">): Promise<PortfolioLetter>;
  exportAll(): Promise<AgentMemoryExport>;
};

const SUMMARY_GOALS = 20;

const iso = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString();
const normalizeSymbol = (symbol: string): string => symbol.trim().toUpperCase();
const open = <T>(blob: unknown): T => decryptBlob<T>(blob as Buffer);

export function isRiskTolerance(value: unknown): value is RiskTolerance {
  return (RISK_TOLERANCES as readonly unknown[]).includes(value);
}

function thesisRow(row: QueryResultRow): Thesis {
  return {
    symbol: row.symbol as string,
    status: row.status as ThesisStatus,
    ...open<ThesisBody>(row.body_blob),
    updatedAt: iso(row.updated_at),
  };
}

function goalRow(row: QueryResultRow): Goal {
  return {
    id: row.id as string,
    symbol: (row.symbol as string | null) ?? null,
    text: open<string>(row.body_blob),
    sourceThreadId: (row.source_thread_id as string | null) ?? null,
    updatedAt: iso(row.updated_at),
  };
}

function observationRow(row: QueryResultRow): Observation {
  return {
    id: row.id as string,
    agentId: row.agent_id as string,
    threadId: row.thread_id as string,
    symbol: (row.symbol as string | null) ?? null,
    text: open<string>(row.body_blob),
    createdAt: iso(row.created_at),
  };
}

function threadRow(row: QueryResultRow): ThreadSummary {
  return {
    id: row.id as string,
    agentId: row.agent_id as string,
    title: open<string>(row.title_blob),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function letterRow(row: QueryResultRow): PortfolioLetter {
  const { verdict, observations } = open<Pick<PortfolioLetter, "verdict" | "observations">>(
    row.body_blob,
  );
  return {
    id: row.id as string,
    snapshotHash: row.snapshot_hash as string,
    holdingsHash: row.holdings_hash as string,
    createdAt: iso(row.created_at),
    verdict,
    observations,
  };
}

const THESIS_COLUMNS = "symbol, status, body_blob, updated_at";
const GOAL_COLUMNS = "id, symbol, body_blob, source_thread_id, updated_at";
const OBSERVATION_COLUMNS = "id, agent_id, thread_id, symbol, body_blob, created_at";
const LETTER_COLUMNS = "id, snapshot_hash, holdings_hash, body_blob, created_at";
const THREAD_COLUMNS = "id, agent_id, title_blob, created_at, updated_at";

export function createAgentMemoryRepository(
  db: Database,
  userId: string | undefined | null,
): AgentMemoryRepository {
  const tenantId = requireUserId(userId);
  const one = <R extends QueryResultRow>(text: string, params: unknown[] = []) =>
    withTenantStatement(db, tenantId, (client) => client.query<R>(text, params));

  return {
    async summary({ held, named, closeUnheld }) {
      const heldSymbols = held.map(normalizeSymbol);
      const namedSymbols = named.map(normalizeSymbol);
      /* The UPDATE and the SELECTs share one snapshot, so the rows below show
       * the status from before this statement. That is harmless: only theses
       * of held symbols are selected, and only unheld ones are closed. */
      const result = await one(
        `WITH closed AS (
           UPDATE investing.theses SET status = 'dormant', updated_at = CURRENT_TIMESTAMP
           WHERE $3::boolean AND status = 'active' AND NOT (symbol = ANY($1::text[]))
           RETURNING symbol
         )
         SELECT 'risk' AS kind, risk_tolerance AS value, NULL::text AS symbol, NULL::text AS status,
                NULL::bytea AS body_blob, NULL::uuid AS id, NULL::uuid AS source_thread_id,
                updated_at
           FROM investing.preferences
         UNION ALL
         (SELECT 'goal', NULL, symbol, NULL, body_blob, id, source_thread_id, updated_at
            FROM investing.goals ORDER BY updated_at DESC LIMIT ${SUMMARY_GOALS})
         UNION ALL
         SELECT 'thesis', NULL, symbol, status, body_blob, NULL, NULL, updated_at
           FROM investing.theses
          WHERE symbol = ANY($1::text[]) AND (symbol = ANY($2::text[]) OR status = 'dormant')`,
        [heldSymbols, namedSymbols, closeUnheld],
      );
      const summary: MemorySummary = { riskTolerance: null, goals: [], theses: [] };
      for (const row of result.rows) {
        if (row.kind === "risk")
          summary.riskTolerance = isRiskTolerance(row.value) ? row.value : null;
        else if (row.kind === "goal") summary.goals.push(goalRow(row));
        else summary.theses.push(thesisRow(row));
      }
      return summary;
    },

    async appendMessages(threadId, agentId, title, messages) {
      if (messages.length === 0) throw new Error("appendMessages needs at least one message");
      /* One statement: the thread upsert and the messages share a round trip.
       * A thread id of another agent upserts nothing, so nothing is added. */
      const result = await one(
        `WITH thread AS (
           INSERT INTO investing.agent_threads (user_id, id, agent_id, title_blob)
           VALUES (current_setting('app.user_id'), $1, $2, $3)
           ON CONFLICT (user_id, id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP
           WHERE investing.agent_threads.agent_id = EXCLUDED.agent_id
           RETURNING id
         )
         INSERT INTO investing.agent_messages (user_id, thread_id, seq, message_blob)
         SELECT current_setting('app.user_id'), thread.id,
                COALESCE((SELECT max(seq) FROM investing.agent_messages WHERE thread_id = $1), 0)
                  + added.ordinal,
                added.blob
           FROM thread, unnest($4::bytea[]) WITH ORDINALITY AS added(blob, ordinal)
         RETURNING seq`,
        [threadId, agentId, encryptBlob(title), messages.map((message) => encryptBlob(message))],
      );
      if (result.rows.length !== messages.length)
        throw new Error("Thread belongs to another agent");
    },

    async listThreads(agentId) {
      const result = await one(
        `SELECT ${THREAD_COLUMNS} FROM investing.agent_threads
          WHERE agent_id = $1 ORDER BY updated_at DESC`,
        [agentId],
      );
      return result.rows.map(threadRow);
    },

    async getThread(threadId) {
      const result = await one(
        `SELECT t.id, t.agent_id, t.title_blob, t.created_at, t.updated_at, m.message_blob
           FROM investing.agent_threads t
           LEFT JOIN investing.agent_messages m ON m.user_id = t.user_id AND m.thread_id = t.id
          WHERE t.id = $1 ORDER BY m.seq`,
        [threadId],
      );
      const first = result.rows[0];
      if (!first) return null;
      return {
        ...threadRow(first),
        messages: result.rows
          .filter((row) => row.message_blob != null)
          .map((row) => open<unknown>(row.message_blob)),
      };
    },

    async deleteThread(threadId) {
      const result = await one("DELETE FROM investing.agent_threads WHERE id = $1 RETURNING id", [
        threadId,
      ]);
      return result.rows.length > 0;
    },

    async confirmThesis(symbol, body) {
      const result = await one(
        `INSERT INTO investing.theses (user_id, symbol, status, body_blob)
         VALUES (current_setting('app.user_id'), $1, 'active', $2)
         ON CONFLICT (user_id, symbol) DO UPDATE
           SET status = 'active', body_blob = EXCLUDED.body_blob, updated_at = CURRENT_TIMESTAMP
         RETURNING ${THESIS_COLUMNS}`,
        [normalizeSymbol(symbol), encryptBlob(body)],
      );
      return thesisRow(result.rows[0]!);
    },

    async editThesis(symbol, body) {
      const result = await one(
        `UPDATE investing.theses SET body_blob = $2, updated_at = CURRENT_TIMESTAMP
          WHERE symbol = $1 RETURNING ${THESIS_COLUMNS}`,
        [normalizeSymbol(symbol), encryptBlob(body)],
      );
      return result.rows[0] ? thesisRow(result.rows[0]) : null;
    },

    async listTheses() {
      const result = await one(
        `SELECT ${THESIS_COLUMNS} FROM investing.theses ORDER BY status, symbol`,
      );
      return result.rows.map(thesisRow);
    },

    async confirmGoal({ symbol, text, sourceThreadId }) {
      const result = await one(
        `INSERT INTO investing.goals (user_id, symbol, body_blob, source_thread_id)
         VALUES (current_setting('app.user_id'), $1, $2, $3)
         RETURNING ${GOAL_COLUMNS}`,
        [symbol === null ? null : normalizeSymbol(symbol), encryptBlob(text), sourceThreadId],
      );
      return goalRow(result.rows[0]!);
    },

    async editGoal(id, { symbol, text }) {
      const result = await one(
        `UPDATE investing.goals SET symbol = $2, body_blob = $3, updated_at = CURRENT_TIMESTAMP
          WHERE id = $1 RETURNING ${GOAL_COLUMNS}`,
        [id, symbol === null ? null : normalizeSymbol(symbol), encryptBlob(text)],
      );
      return result.rows[0] ? goalRow(result.rows[0]) : null;
    },

    async listGoals() {
      const result = await one(
        `SELECT ${GOAL_COLUMNS} FROM investing.goals ORDER BY updated_at DESC`,
      );
      return result.rows.map(goalRow);
    },

    async addObservation({ agentId, threadId, symbol, text }) {
      const result = await one(
        `INSERT INTO investing.agent_observations (user_id, agent_id, thread_id, symbol, body_blob)
         VALUES (current_setting('app.user_id'), $1, $2, $3, $4)
         RETURNING ${OBSERVATION_COLUMNS}`,
        [agentId, threadId, symbol === null ? null : normalizeSymbol(symbol), encryptBlob(text)],
      );
      return observationRow(result.rows[0]!);
    },

    async recall(query, limit) {
      const symbol = "symbol" in query && query.symbol ? normalizeSymbol(query.symbol) : null;
      const since = "since" in query && query.since ? query.since : null;
      switch (query.kind) {
        case "theses": {
          /* Agents never read a dormant thesis; the turn summary shows one
           * only when its symbol is held again. */
          const result = await one(
            `SELECT ${THESIS_COLUMNS} FROM investing.theses
              WHERE status = 'active' AND ($1::text IS NULL OR symbol = $1)
              ORDER BY symbol LIMIT $2`,
            [symbol, limit],
          );
          return { kind: "theses", theses: result.rows.map(thesisRow) };
        }
        case "goals": {
          const result = await one(
            `SELECT ${GOAL_COLUMNS} FROM investing.goals
              WHERE $1::text IS NULL OR symbol = $1
              ORDER BY updated_at DESC LIMIT $2`,
            [symbol, limit],
          );
          return { kind: "goals", goals: result.rows.map(goalRow) };
        }
        case "observations": {
          const result = await one(
            `SELECT ${OBSERVATION_COLUMNS} FROM investing.agent_observations
              WHERE agent_id = $1 AND ($2::text IS NULL OR symbol = $2)
                AND ($3::timestamptz IS NULL OR created_at >= $3)
              ORDER BY created_at DESC LIMIT $4`,
            [query.agentId, symbol, since, limit],
          );
          return { kind: "observations", observations: result.rows.map(observationRow) };
        }
        case "threads": {
          const result = await one(
            `SELECT ${THREAD_COLUMNS} FROM investing.agent_threads
              WHERE agent_id = $1 AND ($2::timestamptz IS NULL OR updated_at >= $2)
              ORDER BY updated_at DESC LIMIT $3`,
            [query.agentId, since, limit],
          );
          return { kind: "threads", threads: result.rows.map(threadRow) };
        }
      }
    },

    async getRiskTolerance() {
      const result = await one("SELECT risk_tolerance FROM investing.preferences");
      const value: unknown = result.rows[0]?.risk_tolerance;
      return isRiskTolerance(value) ? value : null;
    },

    async setRiskTolerance(value) {
      await one(
        `INSERT INTO investing.preferences (user_id, risk_tolerance)
         VALUES (current_setting('app.user_id'), $1)
         ON CONFLICT (user_id) DO UPDATE
           SET risk_tolerance = EXCLUDED.risk_tolerance, updated_at = CURRENT_TIMESTAMP`,
        [value],
      );
    },

    async latestLetter() {
      const result = await one(
        `SELECT ${LETTER_COLUMNS} FROM investing.portfolio_letters
          ORDER BY created_at DESC LIMIT 1`,
      );
      return result.rows[0] ? letterRow(result.rows[0]) : null;
    },

    async saveLetter(letter) {
      const result = await one(
        `WITH inserted AS (
           INSERT INTO investing.portfolio_letters
             (user_id, id, snapshot_hash, holdings_hash, body_blob)
           VALUES (current_setting('app.user_id'), $1, $2, $3, $4)
           ON CONFLICT (user_id, snapshot_hash) DO NOTHING
           RETURNING ${LETTER_COLUMNS}
         )
         SELECT * FROM inserted
         UNION ALL
         SELECT ${LETTER_COLUMNS} FROM investing.portfolio_letters
          WHERE snapshot_hash = $2 AND NOT EXISTS (SELECT 1 FROM inserted)`,
        [
          letter.id,
          letter.snapshotHash,
          letter.holdingsHash,
          encryptBlob({ verdict: letter.verdict, observations: letter.observations }),
        ],
      );
      return letterRow(result.rows[0]!);
    },

    async exportAll() {
      return withTenant(db, tenantId, async (client) => {
        const risk = await client.query("SELECT risk_tolerance FROM investing.preferences");
        const threads = await client.query(
          `SELECT ${THREAD_COLUMNS} FROM investing.agent_threads ORDER BY created_at`,
        );
        const messages = await client.query(
          "SELECT thread_id, message_blob FROM investing.agent_messages ORDER BY thread_id, seq",
        );
        const theses = await client.query(
          `SELECT ${THESIS_COLUMNS} FROM investing.theses ORDER BY symbol`,
        );
        const goals = await client.query(
          `SELECT ${GOAL_COLUMNS} FROM investing.goals ORDER BY updated_at`,
        );
        const observations = await client.query(
          `SELECT ${OBSERVATION_COLUMNS} FROM investing.agent_observations ORDER BY created_at`,
        );
        const letters = await client.query(
          `SELECT ${LETTER_COLUMNS} FROM investing.portfolio_letters ORDER BY created_at`,
        );
        const byThread = new Map<string, unknown[]>();
        for (const row of messages.rows) {
          const list = byThread.get(row.thread_id as string) ?? [];
          list.push(open<unknown>(row.message_blob));
          byThread.set(row.thread_id as string, list);
        }
        const riskValue: unknown = risk.rows[0]?.risk_tolerance;
        return {
          riskTolerance: isRiskTolerance(riskValue) ? riskValue : null,
          threads: threads.rows.map((row) => ({
            ...threadRow(row),
            messages: byThread.get(row.id as string) ?? [],
          })),
          theses: theses.rows.map(thesisRow),
          goals: goals.rows.map(goalRow),
          observations: observations.rows.map(observationRow),
          letters: letters.rows.map(letterRow),
        };
      });
    },
  };
}

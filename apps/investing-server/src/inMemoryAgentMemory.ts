import { randomUUID } from "node:crypto";
import type {
  AgentMemoryExport,
  AgentMemoryRepository,
  Goal,
  MemorySummary,
  Observation,
  PortfolioLetter,
  RecallQuery,
  RecallResult,
  RiskTolerance,
  Thesis,
  ThesisMigrationPlanInput,
  ThesisMigrationResult,
  ThreadSummary,
} from "@lavega/database";

type StoredThread = ThreadSummary & { messages: unknown[] };

type TenantMemoryState = {
  riskTolerance: RiskTolerance | null;
  theses: Map<string, Thesis>;
  goals: Map<string, Goal>;
  threads: Map<string, StoredThread>;
  observations: Observation[];
  letters: PortfolioLetter[];
};

const normalizeSymbol = (symbol: string): string => symbol.trim().toUpperCase();

function createTenantState(): TenantMemoryState {
  return {
    riskTolerance: null,
    theses: new Map(),
    goals: new Map(),
    threads: new Map(),
    observations: [],
    letters: [],
  };
}

/**
 * In-memory AgentMemoryRepository for standalone dev-fixture mode
 * (`INVESTING_DEV_FIXTURE=1` without Neon). Never used in production.
 */
export function createInMemoryAgentMemoryStore(): (tenantId: string) => AgentMemoryRepository {
  const tenants = new Map<string, TenantMemoryState>();
  const stateFor = (tenantId: string): TenantMemoryState => {
    let state = tenants.get(tenantId);
    if (!state) {
      state = createTenantState();
      tenants.set(tenantId, state);
    }
    return state;
  };

  return (tenantId: string): AgentMemoryRepository => {
    const state = stateFor(tenantId);

    return {
      async summary({ held, named, heldKeys = [], namedKeys = [], closeUnheld }): Promise<MemorySummary> {
        const heldSet = new Set(held.map(normalizeSymbol));
        const heldKeySet = new Set(heldKeys);
        const namedSet = new Set(named.map(normalizeSymbol));
        const namedKeySet = new Set(namedKeys);
        const now = new Date().toISOString();

        if (closeUnheld) {
          for (const [key, thesis] of state.theses) {
            const isHeld =
              heldSet.has(thesis.symbol) ||
              (thesis.instrumentKey !== null && heldKeySet.has(thesis.instrumentKey));
            if (thesis.status === "active" && !isHeld) {
              state.theses.set(key, { ...thesis, status: "dormant", updatedAt: now });
            }
          }
        }

        const theses = [...state.theses.values()].filter((thesis) => {
          const isNamed =
            namedSet.has(thesis.symbol) ||
            (thesis.instrumentKey !== null && namedKeySet.has(thesis.instrumentKey));
          const isHeld =
            heldSet.has(thesis.symbol) ||
            (thesis.instrumentKey !== null && heldKeySet.has(thesis.instrumentKey));
          return (thesis.status === "active" && isNamed) || (thesis.status === "dormant" && isHeld);
        });

        return {
          riskTolerance: state.riskTolerance,
          goals: [...state.goals.values()].slice(0, 20),
          theses,
        };
      },

      async appendMessages(threadId, agentId, title, messages): Promise<void> {
        const now = new Date().toISOString();
        const existing = state.threads.get(threadId);
        if (existing) {
          if (existing.agentId !== agentId) {
            throw new Error(`Thread ${threadId} belongs to another agent`);
          }
          existing.messages = [...existing.messages, ...messages];
          existing.updatedAt = now;
          return;
        }
        state.threads.set(threadId, {
          id: threadId,
          agentId,
          title,
          createdAt: now,
          updatedAt: now,
          messages: [...messages],
        });
      },

      async listThreads(agentId): Promise<ThreadSummary[]> {
        return [...state.threads.values()]
          .filter((thread) => thread.agentId === agentId)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map(({ messages: _messages, ...summary }) => summary);
      },

      async getThread(threadId): Promise<StoredThread | null> {
        const thread = state.threads.get(threadId);
        return thread ? { ...thread, messages: [...thread.messages] } : null;
      },

      async deleteThread(threadId): Promise<boolean> {
        const existed = state.threads.delete(threadId);
        if (!existed) return false;
        state.observations = state.observations.filter((obs) => obs.threadId !== threadId);
        for (const [id, goal] of state.goals) {
          if (goal.sourceThreadId === threadId) {
            state.goals.set(id, { ...goal, sourceThreadId: null });
          }
        }
        return true;
      },

      async confirmThesis(symbol, body, instrumentKey = null): Promise<Thesis> {
        const key = normalizeSymbol(symbol);
        const thesis: Thesis = {
          symbol: key,
          status: "active",
          instrumentKey,
          reviewRequired: false,
          ...body,
          updatedAt: new Date().toISOString(),
        };
        state.theses.set(key, thesis);
        return thesis;
      },

      async applyThesisMigration(plan: ThesisMigrationPlanInput): Promise<ThesisMigrationResult> {
        let updated = 0;
        let merged = 0;
        let reviewed = 0;
        const now = new Date().toISOString();

        for (const assignment of plan.assignments) {
          const thesis = state.theses.get(normalizeSymbol(assignment.symbol));
          if (thesis) {
            state.theses.set(thesis.symbol, {
              ...thesis,
              instrumentKey: assignment.instrumentKey,
              updatedAt: now,
            });
            updated += 1;
          }
        }
        for (const merge of plan.merges) {
          for (const sym of merge.mergedSymbols) {
            if (state.theses.delete(normalizeSymbol(sym))) merged += 1;
          }
        }
        for (const review of plan.reviews) {
          for (const sym of review.symbols) {
            const thesis = state.theses.get(normalizeSymbol(sym));
            if (thesis) {
              state.theses.set(thesis.symbol, { ...thesis, reviewRequired: true, updatedAt: now });
              reviewed += 1;
            }
          }
        }
        return { updated, merged, reviewed };
      },

      async editThesis(symbol, body): Promise<Thesis | null> {
        const key = normalizeSymbol(symbol);
        const existing = state.theses.get(key);
        if (!existing) return null;
        const updated: Thesis = {
          ...existing,
          ...body,
          updatedAt: new Date().toISOString(),
        };
        state.theses.set(key, updated);
        return updated;
      },

      async listTheses(): Promise<Thesis[]> {
        return [...state.theses.values()];
      },

      async confirmGoal({ symbol, text, sourceThreadId }): Promise<Goal> {
        const goal: Goal = {
          id: randomUUID(),
          symbol: symbol ? normalizeSymbol(symbol) : null,
          text,
          sourceThreadId,
          updatedAt: new Date().toISOString(),
        };
        state.goals.set(goal.id, goal);
        return goal;
      },

      async editGoal(id, { symbol, text }): Promise<Goal | null> {
        const existing = state.goals.get(id);
        if (!existing) return null;
        const updated: Goal = {
          ...existing,
          symbol: symbol ? normalizeSymbol(symbol) : null,
          text,
          updatedAt: new Date().toISOString(),
        };
        state.goals.set(id, updated);
        return updated;
      },

      async listGoals(): Promise<Goal[]> {
        return [...state.goals.values()];
      },

      async addObservation({ agentId, threadId, symbol, text }): Promise<Observation> {
        const observation: Observation = {
          id: randomUUID(),
          agentId,
          threadId,
          symbol: symbol ? normalizeSymbol(symbol) : null,
          text,
          createdAt: new Date().toISOString(),
        };
        state.observations.push(observation);
        return observation;
      },

      async recall(query: RecallQuery, limit: number): Promise<RecallResult> {
        if (query.kind === "theses") {
          const sym = query.symbol ? normalizeSymbol(query.symbol) : undefined;
          const theses = [...state.theses.values()]
            .filter((t) => !sym || t.symbol === sym)
            .slice(0, limit);
          return { kind: "theses", theses };
        }
        if (query.kind === "goals") {
          const sym = query.symbol ? normalizeSymbol(query.symbol) : undefined;
          const goals = [...state.goals.values()]
            .filter((g) => !sym || g.symbol === sym)
            .slice(0, limit);
          return { kind: "goals", goals };
        }
        if (query.kind === "observations") {
          const sym = query.symbol ? normalizeSymbol(query.symbol) : undefined;
          const observations = state.observations
            .filter(
              (o) =>
                o.agentId === query.agentId &&
                (!sym || o.symbol === sym) &&
                (!query.since || o.createdAt >= query.since),
            )
            .slice(0, limit);
          return { kind: "observations", observations };
        }
        const threads = [...state.threads.values()]
          .filter(
            (t) =>
              t.agentId === query.agentId && (!query.since || t.updatedAt >= query.since),
          )
          .slice(0, limit)
          .map(({ messages: _messages, ...summary }) => summary);
        return { kind: "threads", threads };
      },

      async getRiskTolerance(): Promise<RiskTolerance | null> {
        return state.riskTolerance;
      },

      async setRiskTolerance(value): Promise<void> {
        state.riskTolerance = value;
      },

      async latestLetter(): Promise<PortfolioLetter | null> {
        return state.letters.at(-1) ?? null;
      },

      async saveLetter(letter): Promise<PortfolioLetter> {
        const existing = state.letters.find((item) => item.snapshotHash === letter.snapshotHash);
        if (existing) return existing;
        const saved: PortfolioLetter = { ...letter, createdAt: new Date().toISOString() };
        state.letters.push(saved);
        return saved;
      },

      async exportAll(): Promise<AgentMemoryExport> {
        return {
          riskTolerance: state.riskTolerance,
          threads: [...state.threads.values()],
          theses: [...state.theses.values()],
          goals: [...state.goals.values()],
          observations: [...state.observations],
          letters: [...state.letters],
        };
      },
    };
  };
}

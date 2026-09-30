import { jsonSchema, tool, type ToolSet } from "ai";
import {
  isRiskTolerance,
  RISK_TOLERANCES,
  type AgentMemoryRepository,
  type Goal,
  type MemorySummary,
  type RiskTolerance,
  type Thesis,
} from "@lavega/database";
import type { PortfolioAgentId } from "./portfolioAgent.js";

/*
 * What a chat turn knows about the owner beyond the portfolio (ADR 0007).
 * The summary is read once, in parallel with the fundamentals prefetch, so
 * memory costs no extra wait before the first token. Everything else is
 * behind `recall_memory`.
 */

/** One thread of one agent for one owner, already scoped to the tenant. */
export type ThreadMemory = {
  repository: AgentMemoryRepository;
  agentId: PortfolioAgentId;
  /** Stored before the agent runs, so a goal or an observation can link to it. */
  threadId: string;
};

const RECALL_LIMIT = 20;
const RISK_LABEL: Record<RiskTolerance, string> = {
  conservative: "Conservative",
  balanced: "Balanced",
  aggressive: "Aggressive",
};

function thesisText(thesis: Thesis): string {
  return [
    `why they own it: ${thesis.why}`,
    thesis.worth && `what they think it is worth: ${thesis.worth}`,
    thesis.entry && `entry reasoning: ${thesis.entry}`,
    thesis.wrongIf && `what would prove them wrong: ${thesis.wrongIf}`,
  ]
    .filter(Boolean)
    .join("; ");
}

function goalText(goal: Goal): string {
  return `- ${goal.symbol ?? "Portfolio"}: ${goal.text}`;
}

/** The memory section of the instructions. `named` are the held symbols
 *  this message is about. */
export function renderMemoryBrief(summary: MemorySummary, named: readonly string[]): string {
  const lines = ["Memory of this owner, shared by every agent:"];
  lines.push(
    summary.riskTolerance
      ? `Risk tolerance: ${RISK_LABEL[summary.riskTolerance]}. Weigh every view against it.`
      : "Risk tolerance: not set. Unless you already asked earlier in this conversation, ask once whether they are conservative, balanced or aggressive, and save the answer with set_risk_tolerance.",
  );
  lines.push(
    summary.goals.length > 0
      ? `Goals:\n${summary.goals.map(goalText).join("\n")}`
      : "Goals: none saved.",
  );
  const bySymbol = new Map(summary.theses.map((thesis) => [thesis.symbol, thesis]));
  for (const thesis of summary.theses) {
    if (thesis.status === "active")
      lines.push(`Thesis for ${thesis.symbol}: ${thesisText(thesis)}.`);
    else
      lines.push(
        `From their previous holding of ${thesis.symbol}, which they hold again: ${thesisText(thesis)}. This thesis is not current. Show it to them, say plainly it is from their previous holding, and ask whether it is still true. Save it with save_thesis only once they confirm or correct it.`,
      );
  }
  for (const symbol of named) {
    if (!bySymbol.has(symbol))
      lines.push(
        `They hold ${symbol} and have no thesis for it. Ask why they own it, what they think it is worth, and what would prove them wrong.`,
      );
  }
  lines.push(`How you use memory:
- Save a thesis or a goal only after the owner confirms it: they state it themselves, or you propose the exact wording and they accept. Say what you saved.
- A goal is a target outcome, for the whole portfolio or one holding. What a stock is worth belongs in its thesis, not in a goal.
- Use note_observation, without asking, for something the owner said that is worth bringing up in a later conversation.
- Use recall_memory for theses of holdings not shown here, older observations and past conversations.`);
  return lines.join("\n");
}

const optionalText = { type: "string" as const };

export function memoryTools(memory: ThreadMemory, held: ReadonlySet<string>): ToolSet {
  const { repository, agentId, threadId } = memory;
  const symbolOrNull = (symbol: string | undefined) => symbol?.trim().toUpperCase() || null;
  return {
    recall_memory: tool({
      description:
        "Read saved memory. theses: the owner's current theses. goals: their goals. observations: what you noted in earlier conversations. threads: titles and dates of your earlier conversations with them. Filter by symbol, and for observations and threads by a start date.",
      inputSchema: jsonSchema<{
        kind: "theses" | "goals" | "observations" | "threads";
        symbol?: string;
        since?: string;
      }>({
        type: "object",
        properties: {
          kind: { type: "string", enum: ["theses", "goals", "observations", "threads"] },
          symbol: optionalText,
          since: { type: "string", description: "YYYY-MM-DD" },
        },
        required: ["kind"],
        additionalProperties: false,
      }),
      execute: async ({ kind, symbol, since }) => {
        const filter = { symbol: symbolOrNull(symbol) ?? undefined };
        const from = since && /^\d{4}-\d{2}-\d{2}$/.test(since) ? since : undefined;
        return repository.recall(
          kind === "observations"
            ? { kind, agentId, ...filter, since: from }
            : kind === "threads"
              ? { kind, agentId, since: from }
              : { kind, ...filter },
          RECALL_LIMIT,
        );
      },
    }),
    save_thesis: tool({
      description:
        "Save the owner's thesis for a holding, after they confirmed it. Replaces the previous thesis for that symbol and makes it current.",
      inputSchema: jsonSchema<{
        symbol: string;
        why: string;
        worth?: string;
        entry?: string;
        wrong_if?: string;
      }>({
        type: "object",
        properties: {
          symbol: { type: "string" },
          why: { type: "string", description: "Why they own it." },
          worth: { type: "string", description: "What they think it is worth." },
          entry: { type: "string", description: "Why they bought when they did." },
          wrong_if: { type: "string", description: "What would prove them wrong." },
        },
        required: ["symbol", "why"],
        additionalProperties: false,
      }),
      execute: async ({ symbol, why, worth, entry, wrong_if }) => {
        const key = symbolOrNull(symbol);
        if (!key || !held.has(key)) return `Not saved: the owner does not hold ${symbol}.`;
        if (!why.trim()) return "Not saved: a thesis needs the reason they own it.";
        const thesis = await repository.confirmThesis(key, {
          why: why.trim(),
          worth: worth?.trim() || null,
          entry: entry?.trim() || null,
          wrongIf: wrong_if?.trim() || null,
        });
        return { saved: "thesis", symbol: thesis.symbol };
      },
    }),
    save_goal: tool({
      description:
        "Save a goal the owner confirmed: a target outcome for the whole portfolio, or for one holding when symbol is given.",
      inputSchema: jsonSchema<{ text: string; symbol?: string }>({
        type: "object",
        properties: { text: { type: "string" }, symbol: optionalText },
        required: ["text"],
        additionalProperties: false,
      }),
      execute: async ({ text, symbol }) => {
        if (!text.trim()) return "Not saved: the goal is empty.";
        const goal = await repository.confirmGoal({
          symbol: symbolOrNull(symbol),
          text: text.trim(),
          sourceThreadId: threadId,
        });
        return { saved: "goal", id: goal.id };
      },
    }),
    note_observation: tool({
      description:
        "Note something the owner said that is worth bringing up later. Belongs to this conversation and is deleted with it.",
      inputSchema: jsonSchema<{ text: string; symbol?: string }>({
        type: "object",
        properties: { text: { type: "string" }, symbol: optionalText },
        required: ["text"],
        additionalProperties: false,
      }),
      execute: async ({ text, symbol }) => {
        if (!text.trim()) return "Not noted: the observation is empty.";
        await repository.addObservation({
          agentId,
          threadId,
          symbol: symbolOrNull(symbol),
          text: text.trim(),
        });
        return { noted: true };
      },
    }),
    set_risk_tolerance: tool({
      description: "Save the owner's risk tolerance after they told you what it is.",
      inputSchema: jsonSchema<{ level: RiskTolerance }>({
        type: "object",
        properties: { level: { type: "string", enum: [...RISK_TOLERANCES] } },
        required: ["level"],
        additionalProperties: false,
      }),
      execute: async ({ level }) => {
        if (!isRiskTolerance(level)) return "Not saved: use conservative, balanced or aggressive.";
        await repository.setRiskTolerance(level);
        return { saved: "risk tolerance", level };
      },
    }),
  };
}

import type {
  AgentMemoryRepository,
  Goal,
  MemorySummary,
  RiskTolerance,
  Thesis,
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

import type { UIMessage } from "ai";
import { findMentions as matchAgents } from "@lavega/core";
import {
  getPortfolioAgent,
  isPortfolioAgentId,
  PORTFOLIO_AGENT_IDS,
  type PortfolioAgentId,
} from "./portfolioAgent.js";

/* The tag rule lives in `@lavega/core` so the web app names the same agent
 * the server picks. Here it is bound to the six personas. */
const MENTION_AGENTS = PORTFOLIO_AGENT_IDS.map((id) => ({
  id,
  displayName: getPortfolioAgent(id).displayName,
}));

/** Agents tagged in `text`, in the order first tagged. */
export function findMentions(text: string): PortfolioAgentId[] {
  return matchAgents(text, MENTION_AGENTS).map((agent) => agent.id);
}

/** Prefixes each assistant turn with its speaker so the responder can tell
 *  the host's replies from a guest's. A thread nobody else joined is
 *  returned untouched. */
export function attributeHistory(
  messages: UIMessage[],
  responder: PortfolioAgentId,
  host: PortfolioAgentId,
): UIMessage[] {
  const speaker = (message: UIMessage): PortfolioAgentId => {
    const stored = (message.metadata as { agentId?: unknown } | undefined)?.agentId;
    return isPortfolioAgentId(stored) ? stored : host;
  };
  const guestSpoke = messages.some(
    (message) => message.role === "assistant" && speaker(message) !== host,
  );
  if (responder === host && !guestSpoke) return messages;
  return messages.map((message) => {
    if (message.role !== "assistant") return message;
    const label = `[${getPortfolioAgent(speaker(message)).displayName}]: `;
    let labelled = false;
    return {
      ...message,
      parts: message.parts.map((part) => {
        if (part.type !== "text" || labelled) return part;
        labelled = true;
        return { ...part, text: label + part.text };
      }),
    };
  });
}

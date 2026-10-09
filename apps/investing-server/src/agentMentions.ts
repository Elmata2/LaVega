import type { UIMessage } from "ai";
import {
  getPortfolioAgent,
  isPortfolioAgentId,
  PORTFOLIO_AGENT_IDS,
  type PortfolioAgentId,
} from "./portfolioAgent.js";

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* One matcher per agent: "@Warren Buffett", "@Warren" and "@Buffett". The
 * full name comes first so "@Warren Buffett" is not read as "@Warren". */
const MATCHERS = PORTFOLIO_AGENT_IDS.map((id) => {
  const [first = "", ...rest] = getPortfolioAgent(id).displayName.split(/\s+/);
  const last = rest.at(-1) ?? first;
  const names = [`${escape(first)}\\s+${escape(last)}`, escape(first), escape(last)];
  return { id, pattern: new RegExp(`^(?:${names.join("|")})(?![\\p{L}\\p{N}_])`, "iu") };
});

/** Agents tagged in `text`, in the order first tagged. A tag starts at the
 *  beginning of the text or after whitespace, so an address such as
 *  `a@buffett.com` is not a tag. */
export function findMentions(text: string): PortfolioAgentId[] {
  const found: PortfolioAgentId[] = [];
  for (const tag of text.matchAll(/(?<!\S)@/g)) {
    const rest = text.slice(tag.index + 1);
    const match = MATCHERS.find(({ pattern }) => pattern.test(rest));
    if (match && !found.includes(match.id)) found.push(match.id);
  }
  return found;
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

/** An agent a tag can name. The web app passes its catalog; the server
 *  passes the six personas. */
export type MentionAgent = { id: string; displayName: string };

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* One matcher per agent: "@Warren Buffett", "@Warren" and "@Buffett". The
 * full name comes first so "@Warren Buffett" is not read as "@Warren". */
function matcherFor(displayName: string): RegExp {
  const [first = "", ...rest] = displayName.split(/\s+/);
  const last = rest.at(-1) ?? first;
  const names = [`${escape(first)}\\s+${escape(last)}`, escape(first), escape(last)];
  return new RegExp(`^(?:${names.join("|")})(?![\\p{L}\\p{N}_])`, "iu");
}

/** Agents tagged in `text`, in the order first tagged. A tag starts at the
 *  beginning of the text or after whitespace, so an address such as
 *  `a@buffett.com` is not a tag. The same rule runs on the server (to pick
 *  the responder) and in the web app (to name it), so both agree. */
export function findMentions<A extends MentionAgent>(text: string, agents: readonly A[]): A[] {
  const matchers = agents.map((agent) => ({ agent, pattern: matcherFor(agent.displayName) }));
  const found: A[] = [];
  for (const tag of text.matchAll(/(?<!\S)@/g)) {
    const rest = text.slice(tag.index + 1);
    const match = matchers.find(({ pattern }) => pattern.test(rest));
    if (match && !found.some((agent) => agent.id === match.agent.id)) found.push(match.agent);
  }
  return found;
}

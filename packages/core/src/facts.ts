import { hash, norm } from "./hash.js";

/** Who put this fact in the store. The distinction is the whole point: an agent
 *  may refresh what it found, but it may never overrule what the owner said. */
export type FactSource = "agent" | "user";

/** One durable thing LaVega has learned — "a Trading 212 card charges 0% on a
 *  foreign transaction". Facts are what make an agent get better the longer you
 *  use it: they persist in the vault, are injected into the next run so the
 *  model can't contradict them, and survive every refresh once you've corrected
 *  one. Deliberately flat strings so any agent can store anything. */
export type LearnedFact = {
  id: string;
  agent: string; // which agent owns it, e.g. "travel"
  subject: string; // what it is about, e.g. "Trading 212"
  key: string; // which property, e.g. "fxFeePct"
  value: string;
  source: FactSource;
  updatedAt: string; // ISO date — set by the caller (core stays clock-free)
  note?: string;
};

/** Stable identity: the same (agent, subject, key) always lands on the same id,
 *  so a refresh upserts in place instead of piling up duplicates. Case- and
 *  whitespace-insensitive, so "Trading 212" and "trading 212" are one subject. */
export function factId(agent: string, subject: string, key: string): string {
  return hash([norm(agent), norm(subject), norm(key)].join("|"));
}

export function makeFact(input: Omit<LearnedFact, "id">): LearnedFact {
  return { ...input, id: factId(input.agent, input.subject, input.key) };
}

/** Merge freshly learned facts into the store.
 *
 *  THE LEARNING RULE: a fact the owner set himself is never overwritten by an
 *  agent. Correct a wrong fee once and it stays corrected — across refreshes,
 *  trips and sessions. A user fact always wins; agent facts only fill gaps and
 *  refresh other agent facts. This one rule is what makes the product tailored
 *  instead of generically re-guessing every time. */
export function upsertFacts(existing: LearnedFact[], incoming: LearnedFact[]): LearnedFact[] {
  const byId = new Map(existing.map((f) => [f.id, f]));
  for (const f of incoming) {
    const prev = byId.get(f.id);
    if (prev && prev.source === "user" && f.source === "agent") continue; // owner wins
    byId.set(f.id, f);
  }
  return [...byId.values()];
}

/** The raw value for (agent, subject, key), or null when nothing is known. */
export function factValue(facts: readonly LearnedFact[], agent: string, subject: string, key: string): string | null {
  const id = factId(agent, subject, key);
  return facts.find((f) => f.id === id)?.value ?? null;
}

/** The numeric value for (agent, subject, key), or null when unknown or
 *  unparseable. Accepts a Dutch comma and a stray "%" — a corrected value is
 *  typed by a human. Never coerces unknown to 0: "we don't know" and "it's
 *  free" must stay distinguishable, or an unknown card would rank as the best. */
export function factNumber(facts: readonly LearnedFact[], agent: string, subject: string, key: string): number | null {
  const raw = factValue(facts, agent, subject, key);
  if (raw === null) return null;
  const n = Number(String(raw).replace(",", ".").replace("%", "").trim());
  return Number.isFinite(n) ? n : null;
}

/** Every fact about one subject, for showing "what LaVega thinks it knows". */
export function factsFor(facts: readonly LearnedFact[], agent: string, subject: string): LearnedFact[] {
  const want = norm(subject);
  return facts.filter((f) => norm(f.agent) === norm(agent) && norm(f.subject) === want);
}

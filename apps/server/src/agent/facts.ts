import { factBriefing, makeFact, validateFacts, type LearnedFact } from "@lavega/core";

/** Plenty for one agent's whole namespace; a longer list is a caller bug. */
const MAX_FACTS = 60;

/**
 * THE fact boundary, shared by every agent route.
 *
 * The browser holds the vault, so what LaVega has learned travels back up with
 * each request. That makes the fact list an INPUT to a model call, and it gets
 * exactly the same treatment as every other input in this directory: a fresh
 * object built from named fields only, never a copy of what was sent.
 *
 * Three things are enforced here:
 *
 *  1. Only `{subject, key, value, source}` is read. `note` is deliberately NOT
 *     accepted — it is the one free-text field a fact has, and it stays on the
 *     device.
 *  2. The `agent` is set by the ROUTE, never by the client, so a request cannot
 *     smuggle a fact in under another agent's namespace.
 *  3. Every fact must pass `validateFacts` from core — the same guard the vault
 *     uses — so nothing carrying a balance, an amount, an IBAN, an account
 *     number or a counterparty can reach a model. Bad facts are dropped, not
 *     rejected with a 400: one stale row in a vault must not break the request.
 */
export function sanitizeKnownFacts(raw: unknown, agent: string): LearnedFact[] {
  if (!Array.isArray(raw)) return [];
  const built: LearnedFact[] = [];
  for (const r of raw.slice(0, MAX_FACTS)) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const subject = o.subject;
    const key = o.key;
    const value = o.value;
    if (typeof subject !== "string" || typeof key !== "string" || typeof value !== "string") continue;
    built.push(
      makeFact({
        agent,
        subject,
        key,
        value,
        source: o.source === "user" ? "user" : "agent",
        updatedAt: typeof o.updatedAt === "string" ? o.updatedAt.slice(0, 10) : "",
      }),
    );
  }
  return validateFacts(built).valid;
}

/**
 * The "WAT LAVEGA AL WEET" block that every agent gets appended to its system
 * prompt — the read side of learning, in one format so `_base.md` can explain
 * it once for all four agents. Renders subject/key/value only (see
 * `factBriefing`); the owner's corrections are marked so the model knows which
 * lines it may not contradict. Empty string when this agent has learned
 * nothing, so a first run carries no dangling header.
 */
export function factsBlock(facts: readonly LearnedFact[], agent: string): string {
  const lines = factBriefing(facts, agent);
  if (lines.length === 0) return "";
  return `\n\nWAT LAVEGA AL WEET:\n${lines.map((l) => `- ${l}`).join("\n")}`;
}

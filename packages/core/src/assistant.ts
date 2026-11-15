/*
 * The personal assistant's thin slice: client-side tools, approval events and
 * the memory a decision may write (plan §3 WS5.8, issue #301).
 *
 * Sure source: `app/models/assistant/responder.rb` and
 * `function_tool_caller.rb` at pinned commit 562fe09. Sure's assistant runs on
 * the server and can act; LaVega's personal ledger is sealed in the browser
 * (ADR 0009), so the tools run HERE and the server never sees a row. This module
 * is the pure part: the tool vocabulary, the intent router, the closed memory
 * vocabulary from `docs/superpowers/specs/2026-10-27-assistant-design.md`, and
 * the append-only approval reducer.
 *
 * No clock, no I/O: the caller passes `asOf` and timestamps. Nothing here
 * imports storage or a transport, which is what keeps the tool path provably
 * browser-only.
 */

/** The three tools this slice registers. Two read, one writes — and the write
 *  only happens after the owner's decision event exists. */
export type AssistantToolName = "spending_summary" | "account_balances" | "remember_preference";

export const ASSISTANT_TOOL_NAMES: readonly AssistantToolName[] = [
  "spending_summary",
  "account_balances",
  "remember_preference",
];

/** What the owner decided about a proposed write. A decision is an event; the
 *  latest event per approval id wins, so undo is another decision. */
export type AssistantDecision = "approved" | "rejected" | "dismissed";

/** One approval: the tool, the exact payload it would write, the decision and
 *  when it was made. This is the record that survives a reload. */
export type AssistantApprovalEvent = {
  /** Client-generated, doubles as the idempotency key. */
  id: string;
  tool: AssistantToolName;
  payload: Readonly<Record<string, string>>;
  decision: AssistantDecision;
  /** ISO timestamp of the decision. */
  decidedAt: string;
  /** ISO timestamp the proposal was shown. */
  createdAt: string;
};

/** One stored preference: a closed-vocabulary pair, never free text. */
export type AssistantMemory = {
  id: string;
  subject: AssistantMemorySubject;
  valueId: string;
  createdAt: string;
};

/** The additive vault section. `approvals` is append-only; `memories` holds one
 *  record per subject (a standing preference is one value). */
export type AssistantState = {
  approvals: AssistantApprovalEvent[];
  memories: AssistantMemory[];
};

export function emptyAssistantState(): AssistantState {
  return { approvals: [], memories: [] };
}

/* ---------------------------------------------------------------------------
 * The closed memory vocabulary (assistant design, "Memory tiers")
 * ------------------------------------------------------------------------- */

export const ASSISTANT_MEMORY_SUBJECTS = [
  "lengte",
  "toon",
  "detail",
  "taal",
  "voorbeelden",
] as const;

export type AssistantMemorySubject = (typeof ASSISTANT_MEMORY_SUBJECTS)[number];

/** Every allowed value per subject. Free text cannot be stored by construction,
 *  so no name, amount or account number can ever reach this store. */
export const ASSISTANT_MEMORY_VALUES: Readonly<Record<AssistantMemorySubject, readonly string[]>> =
  {
    lengte: ["kort", "normaal", "uitgebreid"],
    toon: ["zakelijk", "informeel"],
    detail: ["alleen-conclusie", "met-uitleg"],
    taal: ["nl", "en"],
    voorbeelden: ["met", "zonder"],
  };

export type AssistantMemoryPayload = { subject: AssistantMemorySubject; valueId: string };

/** Membership check only: a subject in the table, a value in its list. */
export function isAssistantMemorySubject(value: unknown): value is AssistantMemorySubject {
  return (
    typeof value === "string" && (ASSISTANT_MEMORY_SUBJECTS as readonly string[]).includes(value)
  );
}

export function validateAssistantMemory(input: unknown): AssistantMemoryPayload | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  if (!isAssistantMemorySubject(record.subject)) return null;
  const valueId = typeof record.valueId === "string" ? record.valueId : "";
  return ASSISTANT_MEMORY_VALUES[record.subject].includes(valueId)
    ? { subject: record.subject, valueId }
    : null;
}

/** One record per subject: a second choice replaces the first. */
export function memoryIdFor(subject: AssistantMemorySubject): string {
  return `assistant-memory-${subject}`;
}

/* ---------------------------------------------------------------------------
 * Intent routing
 * ------------------------------------------------------------------------- */

export type AssistantLocale = "nl" | "en";

export type AssistantReadIntent = {
  kind: "read";
  tool: "spending_summary" | "account_balances";
  /** Calendar month, `YYYY-MM`. */
  month: string | null;
};

export type AssistantWriteIntent = {
  kind: "write";
  tool: "remember_preference";
  payload: AssistantMemoryPayload;
};

export type AssistantIntent = AssistantReadIntent | AssistantWriteIntent | { kind: "unknown" };

const SPENDING =
  /uitgegeven|uitgaven|uitgave|gespendeerd|kosten deze maand|\bspen[dt]\b|\bspending\b|expenses/i;
const BALANCES = /saldo|balances?|hoeveel staat er|how much (money|do i have)|rekeningen|accounts/i;

/** Phrase to closed-vocabulary pair. Deliberately literal: this slice has no
 *  model, so a sentence it cannot map is "unknown" rather than a guess. */
const MEMORY_PHRASES: ReadonlyArray<{ pattern: RegExp; payload: AssistantMemoryPayload }> = [
  {
    pattern: /korte? antwoorden|antwoord kort|short answers?|answer briefly/i,
    payload: { subject: "lengte", valueId: "kort" },
  },
  {
    pattern: /lange? antwoorden|uitgebreide? antwoorden|long answers?/i,
    payload: { subject: "lengte", valueId: "uitgebreid" },
  },
  {
    pattern: /normale? antwoorden|normal answers?/i,
    payload: { subject: "lengte", valueId: "normaal" },
  },
  {
    pattern: /zakelijke? toon|formeel|formal tone/i,
    payload: { subject: "toon", valueId: "zakelijk" },
  },
  { pattern: /informele? toon|casual tone/i, payload: { subject: "toon", valueId: "informeel" } },
  {
    pattern: /alleen de conclusie|conclusion only/i,
    payload: { subject: "detail", valueId: "alleen-conclusie" },
  },
  {
    pattern: /met uitleg|with explanations?/i,
    payload: { subject: "detail", valueId: "met-uitleg" },
  },
  { pattern: /in het engels|in english/i, payload: { subject: "taal", valueId: "en" } },
  { pattern: /in het nederlands|in dutch/i, payload: { subject: "taal", valueId: "nl" } },
  {
    pattern: /met voorbeelden|with examples?/i,
    payload: { subject: "voorbeelden", valueId: "met" },
  },
  {
    pattern: /zonder voorbeelden|without examples?/i,
    payload: { subject: "voorbeelden", valueId: "zonder" },
  },
];

const REMEMBER = /onthoud|voortaan|altijd|liever|remember|from now on|i prefer/i;

/** `YYYY-MM` of an ISO date, or null when the date is unreadable. */
export function monthOf(asOf: string): string | null {
  return /^\d{4}-\d{2}/.test(asOf) ? asOf.slice(0, 7) : null;
}

/**
 * Route one owner question to a tool. Read questions are answered immediately;
 * a remember request becomes a proposal that needs the owner's decision.
 *
 * `asOf` is the caller's date, so the default month is deterministic and this
 * module stays clock-free.
 */
export function routeAssistantIntent(input: {
  text: string;
  asOf: string;
  locale?: AssistantLocale;
}): AssistantIntent {
  const text = input.text.trim();
  if (!text) return { kind: "unknown" };
  if (REMEMBER.test(text)) {
    const match = MEMORY_PHRASES.find((phrase) => phrase.pattern.test(text));
    return match
      ? { kind: "write", tool: "remember_preference", payload: { ...match.payload } }
      : { kind: "unknown" };
  }
  if (SPENDING.test(text))
    return { kind: "read", tool: "spending_summary", month: monthOf(input.asOf) };
  if (BALANCES.test(text)) return { kind: "read", tool: "account_balances", month: null };
  return { kind: "unknown" };
}

/* ---------------------------------------------------------------------------
 * Approval reducer
 * ------------------------------------------------------------------------- */

/**
 * Append an approval event. Idempotent by `id` (a retry after a dropped save
 * reuses the id) and the latest event for an approval wins, so a decision can be
 * changed without deleting history.
 */
export function appendApproval(
  state: AssistantState,
  event: AssistantApprovalEvent,
): AssistantState {
  const index = state.approvals.findIndex((entry) => entry.id === event.id);
  const approvals =
    index === -1
      ? [...state.approvals, event]
      : state.approvals.map((entry, at) => (at === index ? event : entry));
  return { ...state, approvals };
}

/** The current decision for one approval, or null while the card is open. */
export function approvalDecision(state: AssistantState, id: string): AssistantDecision | null {
  const event = [...state.approvals].reverse().find((entry) => entry.id === id);
  return event?.decision ?? null;
}

/**
 * The state after a decision. An approved, valid `remember_preference` writes
 * exactly one memory (one record per subject); a rejected or dismissed one
 * writes nothing but still records the decision.
 */
export function decideApproval(input: {
  state: AssistantState;
  id: string;
  tool: AssistantToolName;
  payload: Readonly<Record<string, string>>;
  decision: AssistantDecision;
  decidedAt: string;
  createdAt: string;
}): AssistantState {
  const next = appendApproval(input.state, {
    id: input.id,
    tool: input.tool,
    payload: input.payload,
    decision: input.decision,
    decidedAt: input.decidedAt,
    createdAt: input.createdAt,
  });
  if (input.decision !== "approved" || input.tool !== "remember_preference") return next;
  const memory = validateAssistantMemory(input.payload);
  if (!memory) return next;
  const record: AssistantMemory = {
    id: memoryIdFor(memory.subject),
    subject: memory.subject,
    valueId: memory.valueId,
    createdAt: input.decidedAt,
  };
  return {
    ...next,
    memories: [...next.memories.filter((entry) => entry.subject !== memory.subject), record],
  };
}

/** The preference the next answer should follow, when the owner approved one. */
export function storedMemory(
  state: AssistantState,
  subject: AssistantMemorySubject,
): AssistantMemory | null {
  return state.memories.find((entry) => entry.subject === subject) ?? null;
}

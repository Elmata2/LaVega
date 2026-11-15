/* Cash-flow kind rules: what the owner confirmed about a broker's vocabulary.
 *
 * Broker adapters map each broker's transaction-type string onto the five cash
 * flow kinds with a hand-written, deliberately conservative switch. Anything it
 * does not recognise becomes `other`, with a problem naming the broker, the
 * reference and the raw type string. This module turns a CONFIRMED answer about
 * that vocabulary word into a stored rule, and applies it at the same point as
 * the switch, so downstream code still has exactly one notion of a kind.
 *
 * PURE. No clock, no store, no model. The rule layer is decidable from its
 * inputs alone, which is what makes the no-effect guarantee testable: with no
 * confirmed rules the output is byte-for-byte the adapter output.
 *
 * SIGN IS NOT A RULE. The switch forces a withdrawal/fee negative and otherwise
 * keeps the provider's sign; a rule keeps that same normalisation, and a rule
 * whose kind would flip a sign is reported before it is applied
 * (`signWouldChange`), never applied silently.
 *
 * Keying is broker + NORMALISED type string, never a transaction reference: a
 * rule settles a vocabulary word. An ambiguous transfer is excluded by the
 * adapters (no cash flow at all), so it never reaches this module.
 */
import type { CashFlow, CashFlowKind } from "./model.js";

export const CASH_FLOW_KINDS = ["deposit", "withdrawal", "interest", "fee", "other"] as const;

/** The kinds a suggestion may propose: never `other`, which needs no rule. */
export const SUGGESTIBLE_CASH_FLOW_KINDS = [
  "deposit",
  "withdrawal",
  "interest",
  "fee",
] as const satisfies readonly CashFlowKind[];

/** One confirmed vocabulary word for one broker. */
export type CashFlowRule = {
  broker: string;
  /** `normaliseCashFlowType` of the broker's raw type string. */
  typeKey: string;
  kind: CashFlowKind;
  /** ISO timestamp of the owner's confirmation. */
  confirmedAt: string;
};

/** A vocabulary word the switch does not know, parsed from an adapter problem. */
export type UnknownCashFlowType = {
  broker: string;
  typeKey: string;
  rawType: string;
  /** The broker reference of the first row that reported it. */
  reference: string;
};

/** What the owner sees for one pending vocabulary word. The prompt state
 *  excludes the magnitude (the model does not need it); this record keeps the
 *  observed amount so the confirmation screen can show it. */
export type CashFlowSuggestion = {
  broker: string;
  typeKey: string;
  rawType: string;
  kind: CashFlowKind | null;
  /** Model-reported confidence in `kind`; null for a no-match answer. */
  confidence: number | null;
  state: "pending" | "confirmed" | "rejected" | "no-match";
  /** First observed row, for display and for the sign-change warning. */
  amount: number | null;
  sign: 1 | -1;
  currency: string;
  description: string;
  createdAt: string;
};

/** What one suggestion request may know about a row. No magnitude, no account
 *  identity — kind classification needs the vocabulary, not the balance. */
export type CashFlowSuggestionContext = {
  broker: string;
  typeKey: string;
  rawType: string;
  description: string;
  currency: string;
  sign: 1 | -1;
};

/** The switch's own word: uppercase, single spaces. "Buy/Sell" and "buy  sell"
 *  are one vocabulary word; "FEE" and "fee" are one too. */
export function normaliseCashFlowType(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, " ");
}

/** Broker display names as they appear in adapter problems, mapped to the ids
 *  the rest of the app stores. */
const BROKER_LABELS: Readonly<Record<string, string>> = {
  "trading 212": "trading212",
  trading212: "trading212",
  ibkr: "ibkr",
};

export function normaliseBrokerLabel(label: string): string {
  const key = label.trim().toLowerCase();
  return BROKER_LABELS[key] ?? key.replace(/\s+/g, "");
}

/** Adapters name the broker, the reference and the raw type in this one
 *  sentence (`trading212/adapter.ts`). A problem that does not match is not an
 *  unknown-type report and yields nothing. */
const UNKNOWN_TYPE_PROBLEM =
  /^(?:[a-z0-9]+:\s*)?(.+?) transaction (\S+) has unknown type (.+?); provider sign was preserved$/;

export function unknownCashFlowTypeFromProblem(
  problem: string,
  broker: string,
): UnknownCashFlowType | null {
  const match = UNKNOWN_TYPE_PROBLEM.exec(problem.trim());
  if (!match) return null;
  const displayBroker = normaliseBrokerLabel(match[1]!);
  if (displayBroker !== broker && normaliseBrokerLabel(broker) !== displayBroker) {
    /* The caller's broker id wins when it names the same broker; a problem from
     * another broker is never applied to this one. */
    return null;
  }
  const rawType = match[3]!.trim();
  if (!rawType) return null;
  return {
    broker: normaliseBrokerLabel(broker),
    typeKey: normaliseCashFlowType(rawType),
    rawType,
    reference: match[2]!,
  };
}

/** Distinct vocabulary words across a sync's problems, in first-seen order. */
export function unknownCashFlowTypes(
  problems: readonly string[],
  broker: string,
): UnknownCashFlowType[] {
  const out = new Map<string, UnknownCashFlowType>();
  for (const problem of problems) {
    const parsed = unknownCashFlowTypeFromProblem(problem, broker);
    if (!parsed) continue;
    const key = `${parsed.broker}|${parsed.typeKey}`;
    if (!out.has(key)) out.set(key, parsed);
  }
  return [...out.values()];
}

/** The confirmed kind for a broker's vocabulary word, or null. This is the
 *  rule half of the lookup order; the switch half is the adapter's, which wins
 *  by never producing `other` for a type it knows. */
export function confirmedKindFor(
  broker: string,
  rawType: string,
  rules: readonly CashFlowRule[],
): CashFlowKind | null {
  const typeKey = normaliseCashFlowType(rawType);
  const id = normaliseBrokerLabel(broker);
  const rule = rules.find(
    (candidate) =>
      normaliseBrokerLabel(candidate.broker) === id &&
      normaliseCashFlowType(candidate.typeKey) === typeKey,
  );
  return rule?.kind ?? null;
}

/** The switch's sign normalisation, applied to a kind that came from a rule.
 *  A provider's negative stays negative; a positive withdrawal or fee becomes
 *  negative. A null amount stays null (unknown is never guessed). */
export function signedAmountForKind(amount: number | null, kind: CashFlowKind): number | null {
  if (amount === null) return null;
  if (amount < 0) return amount;
  return kind === "withdrawal" || kind === "fee" ? -amount : amount;
}

/** Whether applying this kind would change the observed sign handling. The
 *  confirmation screen must show this before the rule is stored. */
export function signWouldChange(amount: number | null, kind: CashFlowKind): boolean {
  if (amount === null || amount < 0) return false;
  return kind === "withdrawal" || kind === "fee";
}

/**
 * Applies confirmed rules to one broker's adapter output.
 *
 * Lookup order, exactly: the adapter's switch (a known kind is never `other`,
 * so it is never touched), then a confirmed rule for that broker+type, then
 * `other` with its problem intact. A row a rule resolves loses its
 * unknown-type problem: the owner's confirmation IS the resolution. With no
 * rules this returns the inputs unchanged (same objects where possible), which
 * is the no-effect guarantee.
 */
export function applyCashFlowKindRules(input: {
  broker: string;
  flows: readonly CashFlow[];
  problems: readonly string[];
  rules: readonly CashFlowRule[];
}): { flows: CashFlow[]; problems: string[] } {
  if (input.rules.length === 0) {
    return { flows: [...input.flows], problems: [...input.problems] };
  }
  const unknown = unknownCashFlowTypes(input.problems, input.broker);
  if (unknown.length === 0) {
    return { flows: [...input.flows], problems: [...input.problems] };
  }
  const byReference = new Map<string, UnknownCashFlowType>();
  for (const type of unknown) {
    const kind = confirmedKindFor(type.broker, type.rawType, input.rules);
    if (kind !== null) byReference.set(type.reference, type);
  }
  if (byReference.size === 0) {
    return { flows: [...input.flows], problems: [...input.problems] };
  }

  const resolvedProblems = new Set<string>();
  const flows = input.flows.map((flow) => {
    if (flow.kind !== "other" || !flow.brokerFlowId) return flow;
    const type = byReference.get(flow.brokerFlowId);
    if (!type) return flow;
    const kind = confirmedKindFor(type.broker, type.rawType, input.rules);
    if (kind === null) return flow;
    return {
      ...flow,
      kind,
      amount: signedAmountForKind(flow.amount, kind),
    };
  });
  const problems = input.problems.filter((problem) => {
    const parsed = unknownCashFlowTypeFromProblem(problem, input.broker);
    if (!parsed) return true;
    if (!byReference.has(parsed.reference)) return true;
    resolvedProblems.add(problem);
    return false;
  });
  return { flows, problems };
}

/**
 * The distinct vocabulary words a run should ask about: unknown types that have
 * no confirmed rule, no pending suggestion, no rejected suggestion and no
 * no-match answer yet. Distinct by broker+type, so many rows of one unknown
 * type produce ONE question.
 *
 * The context comes from the first flow that reported the type; a flow without
 * a matching problem is not suggested (adapters only name unknown types they
 * actually emitted).
 */
export function cashFlowSuggestionContexts(input: {
  broker: string;
  flows: readonly CashFlow[];
  problems: readonly string[];
  rules: readonly CashFlowRule[];
  suggestions: readonly CashFlowSuggestion[];
}): CashFlowSuggestionContext[] {
  const settled = new Set(
    input.suggestions.map(
      (s) => `${normaliseBrokerLabel(s.broker)}|${normaliseCashFlowType(s.typeKey)}`,
    ),
  );
  const out: CashFlowSuggestionContext[] = [];
  for (const type of unknownCashFlowTypes(input.problems, input.broker)) {
    const id = normaliseBrokerLabel(type.broker);
    if (confirmedKindFor(id, type.rawType, input.rules) !== null) continue;
    if (settled.has(`${id}|${type.typeKey}`)) continue;
    const flow = input.flows.find((candidate) => candidate.brokerFlowId === type.reference);
    const currency = flow?.currency ?? "";
    const description = flow?.description ?? "";
    const sign: 1 | -1 = (flow?.amount ?? 0) >= 0 ? 1 : -1;
    out.push({
      broker: id,
      typeKey: type.typeKey,
      rawType: type.rawType,
      description,
      currency,
      sign,
    });
  }
  return out;
}

/** The stored suggestion's display sample: amount + sign from the first row. */
export function suggestionSample(
  broker: string,
  typeKey: string,
  flows: readonly CashFlow[],
  problems: readonly string[],
): { amount: number | null; sign: 1 | -1; currency: string; description: string } {
  const type = unknownCashFlowTypes(problems, broker).find(
    (candidate) => candidate.typeKey === normaliseCashFlowType(typeKey),
  );
  const flow = type
    ? flows.find((candidate) => candidate.brokerFlowId === type.reference)
    : undefined;
  return {
    amount: flow?.amount ?? null,
    sign: (flow?.amount ?? 0) >= 0 ? 1 : -1,
    currency: flow?.currency ?? "",
    description: flow?.description ?? "",
  };
}

/** Whether the suggestion's kind would flip the observed amount's sign. */
export function suggestionSignChange(suggestion: CashFlowSuggestion): boolean {
  return suggestion.kind !== null && signWouldChange(suggestion.amount, suggestion.kind);
}

/** Applies a confirmation: a pending suggestion becomes a rule. The caller
 *  stores both; this only decides. A sign-changing confirmation is refused
 *  unless the owner acknowledged the before/after. */
export type ConfirmSuggestionResult =
  | { ok: true; rule: CashFlowRule }
  | {
      ok: false;
      reason: "not-found" | "sign-change-unacknowledged";
      before: number | null;
      after: number | null;
    };

export function confirmCashFlowSuggestion(input: {
  suggestions: readonly CashFlowSuggestion[];
  broker: string;
  typeKey: string;
  kind: CashFlowKind;
  acknowledgeSignChange: boolean;
  confirmedAt: string;
}): ConfirmSuggestionResult {
  const suggestion = input.suggestions.find(
    (candidate) =>
      normaliseBrokerLabel(candidate.broker) === normaliseBrokerLabel(input.broker) &&
      normaliseCashFlowType(candidate.typeKey) === normaliseCashFlowType(input.typeKey),
  );
  if (!suggestion) {
    return { ok: false, reason: "not-found", before: null, after: null };
  }
  const flips = signWouldChange(suggestion.amount, input.kind);
  if (flips && !input.acknowledgeSignChange) {
    return {
      ok: false,
      reason: "sign-change-unacknowledged",
      before: suggestion.amount,
      after: signedAmountForKind(suggestion.amount, input.kind),
    };
  }
  return {
    ok: true,
    rule: {
      broker: normaliseBrokerLabel(input.broker),
      typeKey: normaliseCashFlowType(input.typeKey),
      kind: input.kind,
      confirmedAt: input.confirmedAt,
    },
  };
}

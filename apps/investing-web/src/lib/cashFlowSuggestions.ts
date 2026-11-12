/* API client for the cash-flow suggestion panel (issue #137, Jev-04).
 *
 * The server owns the rule: a suggestion becomes a rule only through POST
 * /confirm, and a sign-flipping confirmation needs acknowledgeSignChange. This
 * module only speaks that contract; it never decides a kind on its own and it
 * never retries a confirmation with the acknowledgement set unless the owner
 * ticked it.
 *
 * Amounts here are the broker's decimal euros with their observed sign (the
 * suggestion stores the first row's `amount` and `sign`), NOT the integer cents
 * used at personal-ledger boundaries. Display only; nothing is computed from
 * them beyond the before/after preview. */
import {
  CASH_FLOW_KINDS,
  type CashFlowKind,
  signedAmountForKind,
  signWouldChange,
} from "@lavega/core";

/** The kinds a rule may use: `other` is not a rule (it means "no answer"). */
export const RULE_KINDS = CASH_FLOW_KINDS.filter(
  (kind): kind is Exclude<CashFlowKind, "other"> => kind !== "other",
);

export type CashFlowSuggestionRow = {
  broker: string;
  typeKey: string;
  rawType: string;
  kind: CashFlowKind | null;
  confidence: number | null;
  amount: number | null;
  sign: 1 | -1;
  currency: string;
  description: string;
  createdAt: string;
  /** Computed by the server from the observed amount and the suggested kind. */
  signChange: boolean;
};

export type CashFlowRuleRow = {
  broker: string;
  typeKey: string;
  kind: Exclude<CashFlowKind, "other">;
  confirmedAt: string;
};

export type CashFlowState = {
  enabled: boolean;
  pending: CashFlowSuggestionRow[];
  rules: CashFlowRuleRow[];
};

export type ConfirmCashFlowResult =
  | { status: "ok"; rule: CashFlowRuleRow; rules: CashFlowRuleRow[] }
  | { status: "sign-change"; before: number | null; after: number | null }
  | { status: "error"; message: string };

/** Stable identity of one vocabulary word. The server returns one pending row
 *  per (broker, typeKey); the UI keys its per-row state on the same pair. */
export function suggestionKey(row: { broker: string; typeKey: string }): string {
  return `${row.broker}|${row.typeKey}`;
}

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

/** Read what the panel needs in one go: the owner switch, the pending
 *  suggestions and the confirmed rules. Three reads because the server keeps
 *  them as three concerns (settings / suggestions / exportable rules). */
export async function loadCashFlowSuggestions(): Promise<CashFlowState> {
  const [suggestionsResponse, rulesResponse, settingsResponse] = await Promise.all([
    fetch("/api/investing/cash-flow-suggestions"),
    fetch("/api/investing/cash-flow-rules"),
    fetch("/api/investing/cash-flow-suggestions/settings"),
  ]);
  if (!suggestionsResponse.ok || !rulesResponse.ok || !settingsResponse.ok) {
    throw new Error("cash-flow suggestions could not be read");
  }
  const suggestions = await readJson<{ enabled?: unknown; pending?: unknown }>(suggestionsResponse);
  const rules = await readJson<{ rules?: unknown }>(rulesResponse);
  const settings = await readJson<{ enabled?: unknown }>(settingsResponse);
  const pending = Array.isArray(suggestions?.pending)
    ? (suggestions.pending as CashFlowSuggestionRow[])
    : [];
  return {
    enabled: settings?.enabled === true || suggestions?.enabled === true,
    pending,
    rules: Array.isArray(rules?.rules) ? (rules.rules as CashFlowRuleRow[]) : [],
  };
}

export async function setCashFlowSuggestionsEnabled(enabled: boolean): Promise<boolean> {
  const response = await fetch("/api/investing/cash-flow-suggestions/settings", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) throw new Error("the suggestion setting could not be saved");
  const body = await readJson<{ enabled?: unknown }>(response);
  return body?.enabled === true;
}

/** Whether applying `kind` to the observed amount would flip the sign handling.
 *  Shared by the warning and the disabled state of the confirm button. */
export function wouldChangeSign(amount: number | null, kind: CashFlowKind): boolean {
  return signWouldChange(amount, kind);
}

/** The amount after the sign normalisation a rule would apply. */
export function afterSignChange(amount: number | null, kind: CashFlowKind): number | null {
  return signedAmountForKind(amount, kind);
}

export async function confirmCashFlowSuggestion(input: {
  broker: string;
  typeKey: string;
  kind: Exclude<CashFlowKind, "other">;
  acknowledgeSignChange: boolean;
}): Promise<ConfirmCashFlowResult> {
  const response = await fetch("/api/investing/cash-flow-suggestions/confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (response.status === 409) {
    const body = await readJson<{ before?: unknown; after?: unknown }>(response);
    return {
      status: "sign-change",
      before: typeof body?.before === "number" ? body.before : null,
      after: typeof body?.after === "number" ? body.after : null,
    };
  }
  if (!response.ok) {
    const body = await readJson<{ problems?: unknown }>(response);
    const problem = Array.isArray(body?.problems)
      ? String(body.problems[0])
      : "Confirmation failed";
    return { status: "error", message: problem };
  }
  const body = await readJson<{ rule?: CashFlowRuleRow; rules?: CashFlowRuleRow[] }>(response);
  if (body?.rule == null) return { status: "error", message: "Confirmation failed" };
  return {
    status: "ok",
    rule: body.rule,
    rules: Array.isArray(body.rules) ? body.rules : [body.rule],
  };
}

export async function rejectCashFlowSuggestion(input: {
  broker: string;
  typeKey: string;
}): Promise<boolean> {
  const response = await fetch("/api/investing/cash-flow-suggestions/reject", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  return response.ok;
}

export async function removeCashFlowRule(input: {
  broker: string;
  typeKey: string;
}): Promise<CashFlowRuleRow[] | null> {
  const response = await fetch("/api/investing/cash-flow-rules/remove", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) return null;
  const body = await readJson<{ rules?: unknown }>(response);
  return Array.isArray(body?.rules) ? (body.rules as CashFlowRuleRow[]) : null;
}

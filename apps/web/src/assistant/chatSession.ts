import type { VaultStorage } from "@lavega/adapters";
import {
  amsterdamDay,
  createChatTools,
  runChatTurn,
  type ChatHistoryMessage,
  type ChatLocale,
  type ChatStep,
  type ChatTurnOutcome,
  type Account,
  type Bill,
  type BillOccurrence,
  type Tx,
  type PlanResult,
  type ScheduledFlow,
} from "@lavega/core";

/* One question, run in the browser: read the unlocked vault NOW (an import since
 * the last question counts), bind the eleven tools to it, and let the turn loop
 * talk to the model through `step`. Nothing is kept: the view dies with the call. */

/** The user's calendar day for a question: Europe/Amsterdam, per question (never the day
 *  the app was mounted, never UTC). The server prompt uses the same day. */
export const chatToday = (now: Date = new Date()): string => amsterdamDay(now);

export type AssistantQuestionDeps = {
  /** Only the rules are read from the vault; every list below comes from the app. */
  storage: VaultStorage;
  /** The user's calendar day (see `chatToday`). */
  asOf: string;
  /** What the owner is LOOKING at, exactly as the app's own views use it: the scoped accounts,
   *  the transfer-projected scoped transactions, the scoped scheduled flows (invoices included),
   *  and the bills with their occurrences. With no scoped lists the chat does not run. */
  accounts: Account[];
  txs: Tx[];
  flows: readonly ScheduledFlow[];
  bills: readonly Bill[];
  occurrences: readonly BillOccurrence[];
  /** "persoonlijk" / "zakelijk": echoed in every result so the answer can say it. */
  scope: string;
  /** The computed plan. It is built from the personal half only, so it is used for "persoonlijk" only. */
  plan: PlanResult | null;
  /** Language of the answer; also the language the tools format money in. */
  language: ChatLocale;
  step: ChatStep;
  onRound?: (toolNames: string[]) => void;
};

export async function runAssistantQuestion(
  deps: AssistantQuestionDeps,
  question: string,
  history: readonly ChatHistoryMessage[],
): Promise<ChatTurnOutcome> {
  const rules = await deps.storage.getRules();
  /* A bill is in the view through its account; a bill with no account has no scope, so it
   * is left out rather than guessed into either half. Occurrences follow their bill. */
  const keys = new Set(deps.accounts.map((a) => a.key));
  const bills = deps.bills.filter((b) => b.accountKey !== undefined && keys.has(b.accountKey));
  const billIds = new Set(bills.map((b) => b.id));
  const tools = createChatTools({
    asOf: deps.asOf,
    locale: deps.language,
    accounts: deps.accounts,
    txs: deps.txs,
    rules,
    bills,
    occurrences: deps.occurrences.filter((o) => billIds.has(o.billId)),
    flows: [...deps.flows],
    plan: deps.scope === "persoonlijk" ? deps.plan : null,
    scope: deps.scope,
  });
  return runChatTurn({
    question,
    history,
    tools,
    step: deps.step,
    ...(deps.onRound ? { onRound: deps.onRound } : {}),
  });
}

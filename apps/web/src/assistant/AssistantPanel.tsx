import { localId } from "../lib/localId";
import { useEffect, useMemo, useReducer, useRef, useState, type FormEvent } from "react";
import type { VaultStorage } from "@lavega/adapters";
import {
  approvalDecision,
  decideApproval,
  detectChatLanguage,
  emptyAssistantState,
  routeAssistantIntent,
  storedMemory,
  type AssistantApprovalEvent,
  type AssistantState,
  type AssistantToolName,
  type Account,
  type Bill,
  type BillOccurrence,
  type PlanResult,
  type ScheduledFlow,
  type Tx,
} from "@lavega/core";
import { useAppLocale } from "../appLocale.js";
import { assistantCopy } from "../copy/assistant.js";
import { getAiAssistantEnabled, setAiAssistantEnabled } from "../settings.js";
import { formatEuroIn, localeTag } from "../format.js";
import { isSpendingSummary, runReadTool, type AssistantVaultSnapshot } from "./tools.js";
import Button from "../components/ui/Button.js";
import StatusLine from "../components/ui/StatusLine.js";
import { InstinctSection, type InstinctPanelProps } from "./InstinctSection.js";
import {
  AssistantStepError,
  createAssistantStep,
  fetchAssistantConfigured,
  type AssistantErrorReason,
} from "./chatClient.js";
import { chatToday, runAssistantQuestion } from "./chatSession.js";

/*
 * The personal assistant panel (WS5.8 thin slice, issue #301).
 *
 * Everything here runs against the already-decrypted vault in this browser. The
 * panel loads a snapshot through the existing storage seam, runs a pure tool over
 * it, and for a write it shows an approval card: nothing is stored until the
 * owner decides, and the decision is one `putAssistant` save. A reload reads the
 * same decision back — that is the whole acceptance proof.
 *
 * The chat (issue #363) is the other half: for a signed-in account whose server
 * has an AI service, and only after the owner accepted the card, a question that
 * the local skills do not cover goes to Mistral through the stateless proxy. The
 * model asks for tools; they run HERE, on the unlocked vault. Nothing is sent
 * before "Aanzetten", and the conversation lives in this component's state only.
 */

type Message = { id: string; role: "user" | "assistant"; text: string };

type OpenApproval = {
  id: string;
  tool: AssistantToolName;
  payload: Readonly<Record<string, string>>;
  createdAt: string;
};

export type AssistantTurnState =
  | { status: "idle" }
  | { status: "awaiting-approval"; approval: OpenApproval }
  | { status: "awaiting-optin"; question: string }
  | { status: "running"; stepLabel: string | null; approval?: OpenApproval }
  | { status: "error"; reason: AssistantErrorReason; question: string };

export type AssistantTurnAction =
  | { type: "start-running"; stepLabel?: string | null; approval?: OpenApproval }
  | { type: "set-step"; stepLabel: string | null }
  | { type: "await-approval"; approval: OpenApproval }
  | { type: "await-optin"; question: string }
  | { type: "set-error"; reason: AssistantErrorReason; question: string }
  | { type: "reset" };

export function assistantTurnReducer(
  state: AssistantTurnState,
  action: AssistantTurnAction,
): AssistantTurnState {
  switch (action.type) {
    case "start-running":
      return {
        status: "running",
        stepLabel: action.stepLabel ?? null,
        approval: action.approval,
      };
    case "set-step":
      return state.status === "running" ? { ...state, stepLabel: action.stepLabel } : state;
    case "await-approval":
      return { status: "awaiting-approval", approval: action.approval };
    case "await-optin":
      return { status: "awaiting-optin", question: action.question };
    case "set-error":
      return { status: "error", reason: action.reason, question: action.question };
    case "reset":
      return { status: "idle" };
  }
}

const newId = localId;

function monthLabel(locale: "nl" | "en", month: string): string {
  return new Intl.DateTimeFormat(localeTag(locale), {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T00:00:00Z`));
}

function decidedAtLabel(locale: "nl" | "en", iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : new Intl.DateTimeFormat(localeTag(locale), {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(date);
}

export type AssistantPanelProps = {
  storage: VaultStorage;
  /** The app's current date, so the tool's default month is deterministic. */
  asOf: string;
  /** The frame's close seam; absent in the phone sheet, which has its own. */
  onClose?: () => void;
  /** Leave out the heading, for the phone sheet whose header already shows it. */
  hideTitle?: boolean;
  /** False while the column is closed; going true re-reads the stored state. */
  active?: boolean;
  /** The daily Instinct messages. Absent for a device vault: no section, no request. */
  instinct?: InstinctPanelProps;
  /** The chat. Absent for a device vault: no opt-in card and no request, ever. */
  chat?: {
    /** The computed plan, when the owner has opened the Plan page. */
    plan: PlanResult | null;
    /** The signed-in account: the opt-in is stored per account. */
    accountId: string;
    /** What the owner is looking at, as the app's own views use it: the scoped accounts, the
     *  transfer-projected scoped transactions, the scoped scheduled flows (invoices included),
     *  the bills with their occurrences, and the scope's name. All required: the chat does not
     *  run on anything else, and never reads these from the vault itself. */
    accounts: Account[];
    txs: Tx[];
    flows: readonly ScheduledFlow[];
    bills: readonly Bill[];
    occurrences: readonly BillOccurrence[];
    scope: string;
  };
};

export function AssistantPanel({
  storage,
  asOf,
  onClose,
  hideTitle = false,
  active = true,
  instinct,
  chat,
}: AssistantPanelProps) {
  const [locale] = useAppLocale();
  const copy = assistantCopy[locale];
  const [assistant, setAssistant] = useState<AssistantState>(emptyAssistantState);
  const [messages, setMessages] = useState<Message[]>([]);
  const [turn, dispatchTurn] = useReducer(assistantTurnReducer, { status: "idle" });
  const [input, setInput] = useState("");
  const busy = turn.status === "running";
  const open =
    turn.status === "awaiting-approval"
      ? turn.approval
      : turn.status === "running"
        ? (turn.approval ?? null)
        : null;
  const optInFor = turn.status === "awaiting-optin" ? turn.question : null;
  const stepLabel = turn.status === "running" ? turn.stepLabel : null;
  const chatError =
    turn.status === "error" ? { reason: turn.reason, question: turn.question } : null;
  const busyRef = useRef(false);
  const mountedRef = useRef(true);
  const assistantRef = useRef(assistant);
  function applyAssistant(state: AssistantState) {
    assistantRef.current = state;
    setAssistant(state);
  }
  function startTurn(opts?: { stepLabel?: string | null; approval?: OpenApproval }): boolean {
    if (busyRef.current) return false;
    busyRef.current = true;
    dispatchTurn({ type: "start-running", stepLabel: opts?.stepLabel, approval: opts?.approval });
    return true;
  }
  function endTurn(next?: AssistantTurnAction) {
    busyRef.current = false;
    if (!mountedRef.current) return;
    if (next) dispatchTurn(next);
  }
  const [saveError, setSaveError] = useState(false);

  /* The chat. `configured` is the server's answer to "is an AI service set up";
   * null until it answers, and a failed check counts as yes (the route itself
   * answers 503 when it is not). */
  const [configured, setConfigured] = useState<boolean | null>(null);
  const accountId = chat?.accountId ?? "";
  const [optedIn, setOptedIn] = useState(() => getAiAssistantEnabled(accountId));
  const messagesRef = useRef<Message[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const wasBusy = useRef(false);
  /** The question in flight: aborted on switch-off and on unmount. */
  const abortRef = useRef<AbortController | null>(null);
  /** Messages before this index never go to the model: nothing from before the opt-in. */
  const historyStartRef = useRef(getAiAssistantEnabled(accountId) ? 0 : Number.POSITIVE_INFINITY);
  const hasChat = chat !== undefined;
  const chatAvailable = hasChat && configured !== false;

  useEffect(() => {
    if (!hasChat) return;
    let live = true;
    void fetchAssistantConfigured().then((ok) => {
      if (live) setConfigured(ok);
    });
    return () => {
      live = false;
    };
  }, [hasChat]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  /* A scope switch while a question runs must not keep sending the old half's data: the
   * same abort as switching off. */
  const scopeName = chat?.scope;
  const lastScope = useRef(scopeName);
  useEffect(() => {
    if (lastScope.current !== scopeName) {
      lastScope.current = scopeName;
      abortRef.current?.abort();
      busyRef.current = false;
      dispatchTurn({ type: "reset" });
    }
  }, [scopeName]);

  /* After a turn the input is where the next question goes, unless the person put
   * focus somewhere else on purpose. */
  useEffect(() => {
    if (wasBusy.current && !busy) {
      const here = document.activeElement;
      if (!here || here === document.body || here === inputRef.current || here.closest("form"))
        inputRef.current?.focus();
    }
    wasBusy.current = busy;
  }, [busy]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    /* Loading the stored decisions is the external system this effect
     * synchronises with; the state it sets is the answer, not a derived value.
     * Re-runs when the column opens, so a decision made elsewhere shows. */
    const load = async () => {
      try {
        const state = await storage.getAssistant();
        if (!cancelled) applyAssistant(state);
      } catch {
        if (!cancelled) setSaveError(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [storage, active]);

  const money = useMemo(() => (cents: number) => formatEuroIn(locale, cents / 100), [locale]);

  function pushMessage(role: Message["role"], text: string) {
    messagesRef.current = [...messagesRef.current, { id: newId(), role, text }];
    setMessages(messagesRef.current);
  }

  function answerRead(
    intent: Extract<ReturnType<typeof routeAssistantIntent>, { kind: "read" }>,
    snapshot: AssistantVaultSnapshot,
  ) {
    const result = runReadTool(intent, snapshot);
    /* A stored length preference changes the answer: "kort" gives the figure
     * only. That is the thin slice's proof that an approved memory is read. */
    const short = storedMemory(assistantRef.current, "lengte")?.valueId === "kort";
    if (isSpendingSummary(result)) {
      const lines = [copy.spending.title(monthLabel(locale, result.month))];
      if (result.countedRows === 0) lines.push(copy.spending.empty);
      else {
        lines.push(copy.spending.total(money(result.totalOutCents)));
        if (!short && result.categories.length > 0)
          lines.push(
            copy.spending.categories(
              result.categories
                .map((entry) => `${entry.category} ${money(entry.outCents)}`)
                .join(", "),
            ),
          );
        if (result.pendingRows > 0) lines.push(copy.spending.partial(result.pendingRows));
      }
      pushMessage("assistant", lines.join(" "));
      return;
    }
    const rows = result;
    if (rows.length === 0) {
      pushMessage("assistant", copy.balances.empty);
      return;
    }
    const lines = rows.map((row) =>
      row.balanceCents === null
        ? copy.balances.unknownRow(row.name)
        : copy.balances.row(row.name, formatEuroIn(locale, (row.balanceCents ?? 0) / 100)),
    );
    pushMessage(
      "assistant",
      [copy.balances.title, ...lines.slice(0, short ? 3 : lines.length)].join(" "),
    );
  }

  async function ask(raw: string) {
    const text = raw.trim();
    if (!text || !startTurn()) return;
    let next: AssistantTurnAction = { type: "reset" };
    try {
      next = await runTurn(text);
    } finally {
      endTurn(next);
    }
  }

  /** One question to the model. The tools run on the vault read just now; the
   *  step label follows the tool names; a failed round becomes one plain line. */
  async function askModel(text: string): Promise<AssistantTurnAction> {
    const language = detectChatLanguage(text, locale);
    const today = chatToday();
    const earlier = messagesRef.current.slice(historyStartRef.current);
    const last = earlier[earlier.length - 1];
    const history = (
      last?.role === "user" && last.text === text ? earlier.slice(0, -1) : earlier
    ).map((m) => ({ role: m.role, content: m.text }));
    const controller = new AbortController();
    abortRef.current = controller;
    dispatchTurn({ type: "set-step", stepLabel: copy.chat.stepFallback });
    try {
      const outcome = await runAssistantQuestion(
        {
          storage,
          asOf: today,
          plan: chat?.plan ?? null,
          accounts: chat?.accounts ?? [],
          txs: chat?.txs ?? [],
          flows: chat?.flows ?? [],
          bills: chat?.bills ?? [],
          occurrences: chat?.occurrences ?? [],
          scope: chat?.scope ?? "persoonlijk",
          language,
          step: createAssistantStep(language, {
            today,
            signal: controller.signal,
            enabled: () => getAiAssistantEnabled(accountId),
          }),
          onRound: (names) => {
            if (abortRef.current === controller && mountedRef.current) {
              dispatchTurn({
                type: "set-step",
                stepLabel:
                  (names[0] ? copy.chat.steps[names[0]] : undefined) ?? copy.chat.stepFallback,
              });
            }
          },
        },
        text,
        history,
      );
      if (controller.signal.aborted || !mountedRef.current) return { type: "reset" };
      switch (outcome.kind) {
        case "answer":
          pushMessage("assistant", outcome.text);
          break;
        case "facts":
          pushMessage(
            "assistant",
            outcome.lines.length === 0
              ? copy.chat.noAnswer
              : [copy.chat.factsHeader, ...outcome.lines].join("\n"),
          );
          break;
        case "advice-refusal":
          pushMessage("assistant", copy.chat.adviceRefusal);
          break;
        case "no-answer":
          pushMessage("assistant", copy.chat.noAnswer);
          break;
      }
      return { type: "reset" };
    } catch (error) {
      if (!mountedRef.current) return { type: "reset" };
      if (error instanceof AssistantStepError) {
        if (error.reason === "cancelled") {
          setOptedIn(getAiAssistantEnabled(accountId));
          return { type: "reset" };
        }
        if (error.reason === "not-configured") {
          setConfigured(false);
          pushMessage("assistant", copy.chat.needsAccount);
          return { type: "reset" };
        }
        if (
          (error.reason === "offline" ||
            error.reason === "unavailable" ||
            error.reason === "timeout") &&
          (await answerLocally(text))
        ) {
          return { type: "reset" };
        }
        return { type: "set-error", reason: error.reason, question: text };
      }
      pushMessage("assistant", copy.readError);
      return { type: "reset" };
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  /** The local read skills, used when the model cannot be reached. True when one answered. */
  async function answerLocally(text: string): Promise<boolean> {
    const intent = routeAssistantIntent({ text, asOf, locale });
    if (intent.kind !== "read") return false;
    try {
      const [accounts, txs, rules] = await Promise.all([
        chat?.accounts ?? [],
        chat?.txs ?? [],
        storage.getRules(),
      ]);
      if (!mountedRef.current) return false;
      answerRead(intent, { accounts, txs, rules, asOf });
      return true;
    } catch {
      return false;
    }
  }

  async function retryChat() {
    if (turn.status !== "error" || !getAiAssistantEnabled(accountId)) return;
    const question = turn.question;
    if (!startTurn()) return;
    let next: AssistantTurnAction = { type: "reset" };
    try {
      next = await askModel(question);
    } finally {
      endTurn(next);
    }
  }

  async function acceptOptIn() {
    if (turn.status !== "awaiting-optin") return;
    const question = turn.question;
    if (!startTurn()) return;
    setAiAssistantEnabled(accountId, true);
    setOptedIn(true);
    const at = messagesRef.current
      .map((m) => m.role === "user" && m.text === question)
      .lastIndexOf(true);
    historyStartRef.current = at >= 0 ? at : messagesRef.current.length;
    let next: AssistantTurnAction = { type: "reset" };
    try {
      next = await askModel(question);
    } finally {
      endTurn(next);
    }
  }

  function declineOptIn() {
    if (turn.status !== "awaiting-optin") return;
    dispatchTurn({ type: "reset" });
    pushMessage("assistant", copy.chat.declined);
  }

  function turnChatOff() {
    abortRef.current?.abort();
    busyRef.current = false;
    setAiAssistantEnabled(accountId, false);
    setOptedIn(false);
    dispatchTurn({ type: "reset" });
    historyStartRef.current = Number.POSITIVE_INFINITY;
  }

  async function runTurn(text: string): Promise<AssistantTurnAction> {
    setInput("");
    pushMessage("user", text);
    const intent = routeAssistantIntent({ text, asOf, locale });
    if (intent.kind === "write") {
      const approval: OpenApproval = {
        id: newId(),
        tool: intent.tool,
        payload: { ...intent.payload },
        createdAt: new Date().toISOString(),
      };
      pushMessage(
        "assistant",
        copy.approval.body(copy.preference(intent.payload.subject, intent.payload.valueId)),
      );
      return { type: "await-approval", approval };
    }
    /* Opted in: the model answers everything but a remembered preference, so one
     * figure has one source (the same tools) however the question is phrased. */
    if (chatAvailable && optedIn) {
      return askModel(text);
    }
    if (intent.kind === "unknown") {
      if (chatAvailable) return { type: "await-optin", question: text };
      pushMessage("assistant", copy.unknown);
      return { type: "reset" };
    }
    if (intent.kind === "read") {
      /* Read the vault now, not once at mount: an import since the last turn counts. */
      try {
        const [accounts, txs, rules] = await Promise.all([
          storage.getAccounts(),
          storage.getTxs(),
          storage.getRules(),
        ]);
        if (mountedRef.current) answerRead(intent, { accounts, txs, rules, asOf });
      } catch {
        if (mountedRef.current) pushMessage("assistant", copy.readError);
      }
      return { type: "reset" };
    }
    return { type: "reset" };
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void ask(input);
  }

  async function decide(decision: "approved" | "rejected") {
    if (turn.status !== "awaiting-approval") return;
    const current = turn.approval;
    if (!startTurn({ approval: current })) return;
    setSaveError(false);
    const next = decideApproval({
      state: assistantRef.current,
      id: current.id,
      tool: current.tool,
      payload: current.payload,
      decision,
      decidedAt: new Date().toISOString(),
      createdAt: current.createdAt,
    });
    let nextTurn: AssistantTurnAction = { type: "await-approval", approval: current };
    try {
      await storage.putAssistant(next);
      if (!mountedRef.current) return;
      applyAssistant(next);
      nextTurn = { type: "reset" };
      const label = copy.preference(
        String(current.payload.subject),
        String(current.payload.valueId),
      );
      pushMessage(
        "assistant",
        decision === "approved" ? copy.approval.stored(label) : copy.approval.rejected,
      );
    } catch {
      if (mountedRef.current) setSaveError(true);
    } finally {
      endTurn(nextTurn);
    }
  }

  /* One row per approval id, the latest decision, newest first. */
  const latestById = new Map<string, AssistantApprovalEvent>();
  for (const event of assistant.approvals) latestById.set(event.id, event);
  const decisions: AssistantApprovalEvent[] = [...latestById.values()].reverse();
  const memories = assistant.memories;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-4" data-testid="assistant-panel">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {!hideTitle && <h2 className="text-lg font-semibold text-ink">{copy.title}</h2>}
          <p className="mt-1 text-sm text-muted">{chatAvailable ? copy.chat.intro : copy.intro}</p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={copy.close}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm text-muted hover:bg-surface-2 hover:text-ink"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        )}
      </div>

      {instinct && <InstinctSection locale={locale} {...instinct} />}

      <div
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto"
        role="log"
        aria-live="polite"
        data-testid="assistant-log"
      >
        {messages.map((message) => (
          <p
            key={message.id}
            className={
              message.role === "user"
                ? "self-end whitespace-pre-wrap break-words rounded-sm bg-surface-2 px-3 py-2 text-sm text-ink"
                : "self-start whitespace-pre-wrap break-words rounded-sm border border-line px-3 py-2 text-sm text-ink"
            }
          >
            {message.text}
          </p>
        ))}
        {optInFor !== null && (
          <div
            className="self-start rounded-sm border border-line bg-surface-2 p-3"
            role="group"
            aria-label={copy.chat.optIn.title}
            data-testid="assistant-optin"
          >
            <p className="text-sm font-semibold text-ink">{copy.chat.optIn.title}</p>
            <p className="mt-1 text-sm text-ink">{copy.chat.optIn.body}</p>
            <div className="mt-2 flex gap-2">
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => void acceptOptIn()}
                className="min-h-11 py-1.5 text-sm font-semibold"
              >
                {copy.chat.optIn.on}
              </Button>
              <Button
                disabled={busy}
                onClick={declineOptIn}
                className="min-h-11 py-1.5 text-sm font-semibold"
              >
                {copy.chat.optIn.notNow}
              </Button>
            </div>
          </div>
        )}
        {stepLabel !== null && (
          <p
            className="self-start text-sm text-muted"
            data-testid="assistant-step"
            aria-hidden="true"
          >
            {stepLabel}
          </p>
        )}
        {chatError && (
          <div
            className="flex flex-wrap items-center gap-2 text-sm text-ink"
            data-testid="assistant-chat-error"
          >
            <span>
              {chatError.reason === "rate"
                ? copy.chat.error.rate
                : chatError.reason === "budget"
                  ? copy.chat.error.budget
                  : chatError.reason === "signed-out"
                    ? copy.chat.error.signedOut
                    : chatError.reason === "timeout"
                      ? copy.chat.error.timeout
                      : copy.chat.error.unavailable}
            </span>
            {chatError.reason !== "signed-out" && (
              <Button
                disabled={busy}
                onClick={() => void retryChat()}
                className="min-h-11 py-1.5 text-sm font-semibold"
              >
                {copy.chat.error.retry}
              </Button>
            )}
          </div>
        )}
      </div>
      {hasChat && (
        <p role="status" className="sr-only">
          {stepLabel !== null ? copy.chat.working : ""}
        </p>
      )}

      {messages.length === 0 && (
        <div className="flex flex-col items-start gap-2" role="group" aria-label={copy.chipsLabel}>
          {copy.chips.map((chip) => (
            <button
              key={chip}
              type="button"
              data-testid="assistant-chip"
              disabled={busy}
              onClick={() => void ask(chip)}
              className="rounded-pill border border-line bg-surface-2 px-3 py-1.5 text-left text-sm text-ink hover:border-accent"
            >
              {chip}
            </button>
          ))}
        </div>
      )}

      {open && (
        <div
          className="rounded-sm border border-line bg-surface-2 p-3"
          role="group"
          aria-label={copy.approval.title}
          data-testid="assistant-approval"
        >
          <p className="text-sm font-semibold text-ink">{copy.approval.title}</p>
          <p className="mt-1 text-sm text-ink">
            {copy.approval.body(
              copy.preference(String(open.payload.subject), String(open.payload.valueId)),
            )}
          </p>
          <div className="mt-2 flex gap-2">
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => void decide("approved")}
              className="py-1.5 text-sm font-semibold"
            >
              {copy.approval.approve}
            </Button>
            <Button
              disabled={busy}
              onClick={() => void decide("rejected")}
              className="py-1.5 text-sm font-semibold"
            >
              {copy.approval.reject}
            </Button>
          </div>
        </div>
      )}

      {saveError && (
        <StatusLine tone="problem" role="status" className="text-sm">
          {copy.saveError}
        </StatusLine>
      )}

      {(decisions.length > 0 || memories.length > 0) && (
        <details className="text-sm text-ink">
          <summary className="cursor-pointer font-semibold">{copy.history}</summary>
          {decisions.length > 0 && (
            <div className="mt-2" data-testid="assistant-decisions">
              <h3 className="text-sm font-semibold">{copy.decisions}</h3>
              <ul className="mt-1 flex flex-col gap-1">
                {decisions.map((decision) => (
                  <li key={decision.id} data-testid="assistant-decision">
                    <span className="font-semibold">
                      {copy.preference(
                        String(decision.payload.subject),
                        String(decision.payload.valueId),
                      )}
                    </span>{" "}
                    ·{" "}
                    {approvalDecision(assistant, decision.id) === "approved"
                      ? copy.approval.approved
                      : copy.approval.rejected}{" "}
                    · {copy.approval.decidedAt(decidedAtLabel(locale, decision.decidedAt))}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {memories.length > 0 && (
            <div className="mt-2" data-testid="assistant-memories">
              <h3 className="text-sm font-semibold">{copy.memory.title}</h3>
              <ul className="mt-1 flex flex-col gap-1">
                {memories.map((memory) => (
                  <li key={memory.id}>
                    {copy.memory.row(copy.preference(memory.subject, memory.valueId))}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </details>
      )}

      <form onSubmit={submit} className="flex gap-2">
        <label className="sr-only" htmlFor="assistant-input">
          {copy.placeholder}
        </label>
        <input
          ref={inputRef}
          id="assistant-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          readOnly={busy}
          aria-busy={busy}
          placeholder={chatAvailable ? copy.chat.placeholder : copy.placeholder}
          className="min-w-0 flex-1 text-ellipsis rounded-sm border border-line bg-bg px-3 py-2 text-sm text-ink"
        />
        <Button
          type="submit"
          variant="primary"
          disabled={busy || !input.trim()}
          className="py-1.5 text-sm font-semibold"
        >
          {copy.ask}
        </Button>
      </form>

      <p className="text-xs text-muted" data-testid="assistant-privacy">
        {chatAvailable ? copy.chat.privacy : copy.privacy}
      </p>
      {chatAvailable && (
        <p className="text-xs text-muted" data-testid="assistant-notice">
          {copy.chat.notice}
        </p>
      )}
      {chatAvailable && optedIn && (
        <button
          type="button"
          onClick={turnChatOff}
          className="min-h-11 self-start text-left text-sm text-muted underline hover:text-ink"
        >
          {copy.chat.turnOff}
        </button>
      )}
    </div>
  );
}

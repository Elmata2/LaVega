import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { VaultStorage } from "@lavega/adapters";
import {
  approvalDecision,
  decideApproval,
  emptyAssistantState,
  routeAssistantIntent,
  storedMemory,
  type AssistantApprovalEvent,
  type AssistantState,
  type AssistantToolName,
} from "@lavega/core";
import { useAppLocale } from "../appLocale.js";
import { assistantCopy } from "../copy/assistant.js";
import { formatEuroIn, localeTag } from "../format.js";
import { isSpendingSummary, runReadTool, type AssistantVaultSnapshot } from "./tools.js";
import Button from "../components/ui/Button.js";
import StatusLine from "../components/ui/StatusLine.js";

/*
 * The personal assistant panel (WS5.8 thin slice, issue #301).
 *
 * Everything here runs against the already-decrypted vault in this browser. The
 * panel loads a snapshot through the existing storage seam, runs a pure tool over
 * it, and for a write it shows an approval card: nothing is stored until the
 * owner decides, and the decision is one `putAssistant` save. A reload reads the
 * same decision back — that is the whole acceptance proof.
 */

type Message = { id: string; role: "user" | "assistant"; text: string };

type OpenApproval = {
  id: string;
  tool: AssistantToolName;
  payload: Readonly<Record<string, string>>;
  createdAt: string;
};

const newId = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `assistant-${Math.random().toString(36).slice(2)}`;

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
};

export function AssistantPanel({
  storage,
  asOf,
  onClose,
  hideTitle = false,
  active = true,
}: AssistantPanelProps) {
  const [locale] = useAppLocale();
  const copy = assistantCopy[locale];
  const [assistant, setAssistant] = useState<AssistantState>(emptyAssistantState);
  const [messages, setMessages] = useState<Message[]>([]);
  const [open, setOpen] = useState<OpenApproval | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  /* The synchronous twin of `busy` (state lags a render) and the latest stored
   * state, for code that runs after an await. */
  const busyRef = useRef(false);
  const assistantRef = useRef(assistant);
  function applyAssistant(state: AssistantState) {
    assistantRef.current = state;
    setAssistant(state);
  }
  function startTurn(): boolean {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    return true;
  }
  function endTurn() {
    busyRef.current = false;
    setBusy(false);
  }
  const [saveError, setSaveError] = useState(false);

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
    setMessages((current) => [...current, { id: newId(), role, text }]);
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
    try {
      await runTurn(text);
    } finally {
      endTurn();
    }
  }

  async function runTurn(text: string) {
    setInput("");
    pushMessage("user", text);
    const intent = routeAssistantIntent({ text, asOf, locale });
    if (intent.kind === "unknown") {
      pushMessage("assistant", copy.unknown);
      return;
    }
    if (intent.kind === "read") {
      /* Read the vault now, not once at mount: an import since the last turn counts. */
      try {
        const [accounts, txs, rules] = await Promise.all([
          storage.getAccounts(),
          storage.getTxs(),
          storage.getRules(),
        ]);
        answerRead(intent, { accounts, txs, rules, asOf });
      } catch {
        pushMessage("assistant", copy.readError);
      }
      return;
    }
    const approval: OpenApproval = {
      id: newId(),
      tool: intent.tool,
      payload: { ...intent.payload },
      createdAt: new Date().toISOString(),
    };
    setOpen(approval);
    pushMessage(
      "assistant",
      copy.approval.body(copy.preference(intent.payload.subject, intent.payload.valueId)),
    );
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void ask(input);
  }

  async function decide(decision: "approved" | "rejected") {
    if (!open || !startTurn()) return;
    setSaveError(false);
    const next = decideApproval({
      state: assistantRef.current,
      id: open.id,
      tool: open.tool,
      payload: open.payload,
      decision,
      decidedAt: new Date().toISOString(),
      createdAt: open.createdAt,
    });
    try {
      /* One save: the decision event and (on approve) the memory it authorises
       * land together, so a reload cannot show one without the other. */
      await storage.putAssistant(next);
      applyAssistant(next);
      setOpen(null);
      const label = copy.preference(String(open.payload.subject), String(open.payload.valueId));
      pushMessage(
        "assistant",
        decision === "approved" ? copy.approval.stored(label) : copy.approval.rejected,
      );
    } catch {
      setSaveError(true);
    } finally {
      endTurn();
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
          <p className="mt-1 text-sm text-muted">{copy.intro}</p>
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

      <div
        className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto"
        aria-live="polite"
        data-testid="assistant-log"
      >
        {messages.map((message) => (
          <p
            key={message.id}
            className={
              message.role === "user"
                ? "self-end rounded-sm bg-surface-2 px-3 py-2 text-sm text-ink"
                : "self-start rounded-sm border border-line px-3 py-2 text-sm text-ink"
            }
          >
            {message.text}
          </p>
        ))}
      </div>

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
          id="assistant-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          readOnly={busy}
          aria-busy={busy}
          placeholder={copy.placeholder}
          className="min-w-0 flex-1 rounded-sm border border-line bg-bg px-3 py-2 text-sm text-ink"
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
        {copy.privacy}
      </p>
    </div>
  );
}

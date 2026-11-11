import { useEffect, useMemo, useState } from "react";
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

export function AssistantPanel({
  storage,
  asOf,
}: {
  storage: VaultStorage;
  /** The app's current date, so the tool's default month is deterministic. */
  asOf: string;
}) {
  const [locale] = useAppLocale();
  const copy = assistantCopy[locale];
  const [snapshot, setSnapshot] = useState<AssistantVaultSnapshot | null>(null);
  const [assistant, setAssistant] = useState<AssistantState>(emptyAssistantState);
  const [messages, setMessages] = useState<Message[]>([]);
  const [open, setOpen] = useState<OpenApproval | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    /* Loading the vault is the external system this effect synchronises with;
     * the state it sets is the answer, not a derived value. */
    const load = async () => {
      try {
        const [accounts, txs, rules, state] = await Promise.all([
          storage.getAccounts(),
          storage.getTxs(),
          storage.getRules(),
          storage.getAssistant(),
        ]);
        if (cancelled) return;
        setSnapshot({ accounts, txs, rules, asOf });
        setAssistant(state);
      } catch {
        if (!cancelled) setSaveError(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [storage, asOf]);

  const money = useMemo(() => (cents: number) => formatEuroIn(locale, cents / 100), [locale]);

  function pushMessage(role: Message["role"], text: string) {
    setMessages((current) => [...current, { id: newId(), role, text }]);
  }

  function answerRead(intent: Extract<ReturnType<typeof routeAssistantIntent>, { kind: "read" }>) {
    if (!snapshot) return;
    const result = runReadTool(intent, snapshot);
    /* A stored length preference changes the answer: "kort" gives the figure
     * only. That is the thin slice's proof that an approved memory is read. */
    const short = storedMemory(assistant, "lengte")?.valueId === "kort";
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

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    pushMessage("user", text);
    const intent = routeAssistantIntent({ text, asOf, locale });
    if (intent.kind === "unknown") {
      pushMessage("assistant", copy.unknown);
      return;
    }
    if (intent.kind === "read") {
      answerRead(intent);
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

  async function decide(decision: "approved" | "rejected") {
    if (!open || busy) return;
    setBusy(true);
    setSaveError(false);
    const next = decideApproval({
      state: assistant,
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
      setAssistant(next);
      setOpen(null);
      const label = copy.preference(String(open.payload.subject), String(open.payload.valueId));
      pushMessage(
        "assistant",
        decision === "approved" ? copy.approval.stored(label) : copy.approval.rejected,
      );
    } catch {
      setSaveError(true);
    } finally {
      setBusy(false);
    }
  }

  /* One row per approval id, the latest decision, newest first. */
  const latestById = new Map<string, AssistantApprovalEvent>();
  for (const event of assistant.approvals) latestById.set(event.id, event);
  const decisions: AssistantApprovalEvent[] = [...latestById.values()].reverse();
  const memories = assistant.memories;

  return (
    <section
      aria-label={copy.title}
      className="rounded-card border border-border bg-card p-4 sm:p-5"
      data-testid="assistant-panel"
    >
      <h2 className="text-lg font-semibold">{copy.title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{copy.intro}</p>

      <div className="mt-3 flex flex-col gap-2" aria-live="polite" data-testid="assistant-log">
        {messages.map((message) => (
          <p
            key={message.id}
            className={
              message.role === "user"
                ? "self-end rounded-tile bg-secondary px-3 py-2 text-sm"
                : "self-start rounded-tile bg-secondary/50 px-3 py-2 text-sm"
            }
          >
            {message.text}
          </p>
        ))}
      </div>

      {open && (
        <div
          className="mt-3 rounded-tile border border-border bg-secondary/30 p-3"
          role="group"
          aria-label={copy.approval.title}
          data-testid="assistant-approval"
        >
          <p className="text-sm font-semibold">{copy.approval.title}</p>
          <p className="mt-1 text-sm">
            {copy.approval.body(
              copy.preference(String(open.payload.subject), String(open.payload.valueId)),
            )}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide("approved")}
              className="rounded-chip bg-foreground px-3 py-1.5 text-sm font-semibold text-background"
            >
              {copy.approval.approve}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide("rejected")}
              className="rounded-chip border border-border px-3 py-1.5 text-sm font-semibold"
            >
              {copy.approval.reject}
            </button>
          </div>
        </div>
      )}

      <form onSubmit={submit} className="mt-3 flex gap-2">
        <label className="sr-only" htmlFor="assistant-input">
          {copy.placeholder}
        </label>
        <input
          id="assistant-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={copy.placeholder}
          className="min-w-0 flex-1 rounded-tile border border-border bg-background px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-chip bg-foreground px-3 py-1.5 text-sm font-semibold text-background"
        >
          {copy.ask}
        </button>
      </form>

      {saveError && (
        <p role="status" className="mt-2 text-sm text-warn">
          {locale === "nl"
            ? "Je beslissing kon niet worden opgeslagen. Probeer het nog eens."
            : "Your decision could not be saved. Try again."}
        </p>
      )}

      {decisions.length > 0 && (
        <div className="mt-4 border-t border-border pt-3" data-testid="assistant-decisions">
          <h3 className="text-sm font-semibold">{copy.decisions}</h3>
          <ul className="mt-1 flex flex-col gap-1 text-sm">
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
        <div className="mt-3 border-t border-border pt-3" data-testid="assistant-memories">
          <h3 className="text-sm font-semibold">{copy.memory.title}</h3>
          <ul className="mt-1 flex flex-col gap-1 text-sm">
            {memories.map((memory) => (
              <li key={memory.id}>
                {copy.memory.row(copy.preference(memory.subject, memory.valueId))}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-3 text-xs text-muted-foreground" data-testid="assistant-privacy">
        {copy.privacy}
      </p>
    </section>
  );
}

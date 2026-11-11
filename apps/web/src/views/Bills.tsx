import { useMemo, useState } from "react";
import type {
  Account,
  Bill,
  BillAction,
  BillDecisions,
  BillFrequency,
  BillOccurrence,
  BillProblem,
  BillRule,
  Tx,
} from "@lavega/core";
import {
  EMPTY_BILL_DECISIONS,
  applyBillAction,
  billProblems,
  billSettlements,
  billsOutlook,
  resolveBillAmountCents,
  suggestBillMatches,
  toCents,
} from "@lavega/core";
import { formatDate, formatEuroIn, monthLabel, weekdayLabel } from "../format.js";
import { useAppLocale } from "../appLocale.js";
import { billsCopy, type BillsCopy } from "../copy/bills.js";
import type { Locale } from "../locale.js";
import Badge from "../components/ui/Badge.js";
import Button from "../components/ui/Button.js";
import Card from "../components/ui/Card.js";
import CardLink from "../components/ui/CardLink.js";
import "../styles/views.css";
import {
  calendarWeeks,
  cadenceText,
  historyRows,
  seriesRows,
  shiftMonth,
  upcomingRows,
} from "../bills-view.js";

/* Verplichtingen — the first shippable half of the bills workstream (#286).
 *
 * One screen answers the three questions the plan asks for: what is due, what
 * is paid, and what is short before the next income. Everything on it is
 * derived from the bill series and their materialized occurrences; nothing here
 * reads the clock (`asOf` is a prop) and nothing invents a number: no known
 * balance or no income series means "unknown", not zero (ADR 0011 §8).
 *
 * Payment matching (#287) rides on top: the screen shows the matcher's
 * suggestion on an open row (confirm/reject), a partial badge when a payment
 * covers only part of it, a mark-paid action for a row paid without a bank
 * transaction, and the price history of a series. Suggestions are DERIVED on
 * read; only confirmations, marks, rejections and price changes are stored. */

type BillsProps = {
  bills: Bill[];
  occurrences: BillOccurrence[];
  accounts: Account[];
  /** The ledger the matcher reads; absent means no suggestions (tests that
   *  only render the schedule stay unchanged). */
  txs?: Tx[];
  /** Stored payment decisions. Absent means the empty section. */
  decisions?: BillDecisions;
  asOf: string;
  busy?: boolean;
  onSavePlan: (
    bills: Bill[],
    occurrences: BillOccurrence[],
    decisions?: BillDecisions,
  ) => Promise<void> | void;
};

type CadenceKey = "weekly" | "monthly" | "quarterly" | "semiannual" | "yearly" | "custom";

const CADENCE_KEYS: CadenceKey[] = ["weekly", "monthly", "quarterly", "semiannual", "yearly"];

function cadenceKeyFor(bill: Bill): CadenceKey {
  const rule = bill.rules[0];
  if (bill.rules.length !== 1 || rule == null) return "custom";
  if (rule.weekday != null || rule.weekdayOrdinal != null) return "custom";
  if (rule.frequency === "weekly") return rule.interval === 1 ? "weekly" : "custom";
  if (rule.frequency === "yearly")
    return rule.interval === 1 && rule.monthOfYear != null ? "yearly" : "custom";
  if (rule.interval === 1) return "monthly";
  if (rule.interval === 3) return "quarterly";
  if (rule.interval === 6) return "semiannual";
  return "custom";
}

/** The rule a cadence + first due date describe. The first due date IS the
 *  anchor, so the schedule always starts where the owner says it does. */
function ruleForCadence(cadence: Exclude<CadenceKey, "custom">, firstDue: string): BillRule {
  const day = Number(firstDue.slice(8, 10));
  const month = Number(firstDue.slice(5, 7));
  if (cadence === "weekly")
    return {
      frequency: "weekly",
      interval: 1,
      weekday: new Date(`${firstDue}T00:00:00Z`).getUTCDay(),
    };
  if (cadence === "yearly")
    return { frequency: "yearly", interval: 1, monthOfYear: month, dayOfMonth: day };
  const frequency: BillFrequency = "monthly";
  const interval = cadence === "monthly" ? 1 : cadence === "quarterly" ? 3 : 6;
  return { frequency, interval, dayOfMonth: day };
}

type Draft = {
  id: string;
  name: string;
  amount: string;
  firstDue: string;
  cadence: CadenceKey;
  type: Bill["type"];
  income: boolean;
  accountKey: string;
  category: string;
  endMode: Bill["endMode"];
  endOn: string;
  endAfterCount: string;
  notes: string;
  rules: BillRule[];
  status: Bill["status"];
};

function draftFor(bill: Bill): Draft {
  return {
    id: bill.id,
    name: bill.name,
    amount: (bill.amountCents / 100).toFixed(2),
    firstDue: bill.anchorDate,
    cadence: cadenceKeyFor(bill),
    type: bill.type,
    income: bill.direction === "in",
    accountKey: bill.accountKey ?? "",
    category: bill.category ?? "",
    endMode: bill.endMode,
    endOn: bill.endOn ?? "",
    endAfterCount: bill.endAfterCount == null ? "" : String(bill.endAfterCount),
    notes: bill.notes ?? "",
    rules: bill.rules,
    status: bill.status,
  };
}

function emptyDraft(asOf: string): Draft {
  return {
    id: newId(),
    name: "",
    amount: "",
    firstDue: asOf,
    cadence: "monthly",
    type: "bill",
    income: false,
    accountKey: "",
    category: "",
    endMode: "never",
    endOn: "",
    endAfterCount: "",
    notes: "",
    rules: [],
    status: "active",
  };
}

function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c != null && typeof c.randomUUID === "function") return `bill-${c.randomUUID()}`;
  return `bill-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

function billFromDraft(draft: Draft): Bill {
  const amountCents = Math.abs(toCents(Number(draft.amount.replace(",", ".")) || 0));
  const rules =
    draft.cadence === "custom" || draft.rules.length === 0
      ? draft.cadence === "custom"
        ? draft.rules
        : [ruleForCadence(draft.cadence, draft.firstDue)]
      : [ruleForCadence(draft.cadence, draft.firstDue)];
  return {
    id: draft.id,
    name: draft.name.trim(),
    type: draft.income ? "income" : draft.type,
    status: draft.status,
    direction: draft.income ? "in" : "out",
    amountCents,
    amountStrategy: "fixed",
    currency: "EUR",
    rules,
    anchorDate: draft.firstDue,
    accountKey: draft.accountKey === "" ? undefined : draft.accountKey,
    category: draft.category.trim() === "" ? undefined : draft.category.trim(),
    weekendAdjust: "none",
    endMode: draft.endMode,
    endOn: draft.endMode === "on_date" && draft.endOn !== "" ? draft.endOn : undefined,
    endAfterCount:
      draft.endMode === "after_count" && draft.endAfterCount !== ""
        ? Number(draft.endAfterCount)
        : undefined,
    tags: [],
    notes: draft.notes.trim() === "" ? undefined : draft.notes.trim(),
  };
}

function statusTone(status: string): string {
  if (status === "overdue" || status === "missed") return "border-neg text-neg";
  if (status === "due") return "border-warn text-warn";
  if (status === "paid") return "border-pos text-pos";
  if (status === "paused" || status === "ended") return "opacity-60";
  return "";
}

export default function Bills({
  bills,
  occurrences,
  accounts,
  txs,
  decisions,
  asOf,
  busy,
  onSavePlan,
}: BillsProps) {
  const [locale] = useAppLocale();
  const c = billsCopy[locale];
  const [draft, setDraft] = useState<Draft | null>(null);
  const [problems, setProblems] = useState<BillProblem[]>([]);
  const [month, setMonth] = useState(asOf.slice(0, 7));

  const cashCents = useMemo(() => {
    const known = accounts.filter(
      (a) => a.balance != null && (a.currency === "EUR" || a.currency === ""),
    );
    if (known.length === 0) return null;
    return known.reduce((sum, a) => sum + toCents(a.balance ?? 0), 0);
  }, [accounts]);

  const outlook = useMemo(
    () => billsOutlook(bills, occurrences, asOf, cashCents),
    [bills, occurrences, asOf, cashCents],
  );
  const rows = useMemo(() => upcomingRows(bills, occurrences, asOf), [bills, occurrences, asOf]);
  const series = useMemo(() => seriesRows(bills, occurrences, asOf), [bills, occurrences, asOf]);
  const history = useMemo(() => historyRows(bills, occurrences), [bills, occurrences]);
  const decisionsNow = decisions ?? EMPTY_BILL_DECISIONS;
  const settlements = useMemo(
    () => billSettlements(bills, occurrences, decisionsNow),
    [bills, occurrences, decisionsNow],
  );
  // One suggestion per open occurrence, already ranked by the matcher. Keyed
  // for O(1) lookup while rendering the rows.
  const suggestions = useMemo(() => {
    const byOccurrence = new Map<string, ReturnType<typeof suggestBillMatches>[number]>();
    for (const candidate of suggestBillMatches({
      bills,
      occurrences,
      txs: txs ?? [],
      decisions: decisionsNow,
      accounts,
      asOf,
    })) {
      if (!byOccurrence.has(candidate.occurrenceId)) {
        byOccurrence.set(candidate.occurrenceId, candidate);
      }
    }
    return byOccurrence;
  }, [bills, occurrences, txs, decisionsNow, accounts, asOf]);
  const txById = useMemo(() => new Map((txs ?? []).map((tx) => [tx.id, tx])), [txs]);
  const priceChangeByBill = useMemo(() => {
    const byBill = new Map<string, BillDecisions["priceChanges"][number]>();
    for (const priceChange of decisionsNow.priceChanges) {
      const current = byBill.get(priceChange.billId);
      if (current == null || priceChange.effectiveOn >= current.effectiveOn) {
        byBill.set(priceChange.billId, priceChange);
      }
    }
    return byBill;
  }, [decisionsNow]);

  // One decision, one save. The core decides the new rows/statuses and the
  // caller writes them together with the decisions they came from.
  function act(action: BillAction) {
    const outcome = applyBillAction({
      bills,
      occurrences,
      decisions: decisionsNow,
      txs: txs ?? [],
      accounts,
      asOf,
      action,
    });
    if (!outcome.changed) return;
    void onSavePlan(outcome.bills, outcome.occurrences, outcome.decisions);
  }
  const weeks = useMemo(
    () => calendarWeeks(bills, occurrences, month, asOf),
    [bills, occurrences, month, asOf],
  );

  const patch = (next: Partial<Draft>) => setDraft((d) => (d == null ? d : { ...d, ...next }));

  function submit() {
    if (draft == null) return;
    const next = billFromDraft(draft);
    const found = billProblems(next);
    setProblems(found);
    if (found.length > 0) return;
    const nextBills = bills.some((b) => b.id === next.id)
      ? bills.map((b) => (b.id === next.id ? next : b))
      : [...bills, next];
    setDraft(null);
    void onSavePlan(nextBills, occurrences, decisionsNow);
  }

  function setStatus(bill: Bill, status: Bill["status"]) {
    void onSavePlan(
      bills.map((b) => (b.id === bill.id ? { ...b, status } : b)),
      occurrences,
      decisionsNow,
    );
  }

  const money = (cents: number) => formatEuroIn(locale, cents / 100);
  const shortfallTone =
    outlook.shortfallCents == null
      ? "text-muted"
      : outlook.shortfallCents > 0
        ? "text-neg"
        : "text-pos";

  return (
    <section aria-label={c.title}>
      <div className="mb-[var(--sp-5)] flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0">{c.title}</h1>
          <p className="m-0 max-w-[60ch] text-muted">{c.intro}</p>
        </div>
        <Button
          variant="primary"
          data-testid="bills-add"
          disabled={busy}
          onClick={() => {
            setProblems([]);
            setDraft(emptyDraft(asOf));
          }}
        >
          {c.add}
        </Button>
      </div>

      {draft != null && (
        <Card
          as="section"
          aria-label={bills.some((b) => b.id === draft.id) ? c.editTitle : c.addTitle}
        >
          <h2>{bills.some((b) => b.id === draft.id) ? c.editTitle : c.addTitle}</h2>
          <form
            className="grid grid-cols-2 gap-[var(--sp-4)] max-[700px]:grid-cols-1"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <label className="flex flex-col gap-1">
              <span className="text-muted">{c.form.name}</span>
              <input
                aria-label={c.form.name}
                value={draft.name}
                placeholder={c.form.namePlaceholder}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted">{c.form.amount}</span>
              <input
                aria-label={c.form.amount}
                inputMode="decimal"
                value={draft.amount}
                onChange={(e) => patch({ amount: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted">{c.form.firstDue}</span>
              <input
                type="date"
                aria-label={c.form.firstDue}
                value={draft.firstDue}
                onChange={(e) => patch({ firstDue: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted">{c.form.cadence}</span>
              <select
                aria-label={c.form.cadence}
                value={draft.cadence}
                onChange={(e) => patch({ cadence: e.target.value as CadenceKey })}
              >
                {CADENCE_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {cadenceOptionLabel(
                      c,
                      key as Exclude<CadenceKey, "custom">,
                      locale,
                      draft.firstDue,
                    )}
                  </option>
                ))}
                {draft.cadence === "custom" && (
                  <option value="custom">{c.frequency.monthly}</option>
                )}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted">{c.form.type}</span>
              <select
                aria-label={c.form.type}
                value={draft.type}
                disabled={draft.income}
                onChange={(e) => patch({ type: e.target.value as Bill["type"] })}
              >
                {(Object.keys(c.typeLabels) as Bill["type"][]).map((type) => (
                  <option key={type} value={type}>
                    {c.typeLabels[type]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 self-end pb-2">
              <input
                type="checkbox"
                aria-label={c.form.income}
                checked={draft.income}
                onChange={(e) => patch({ income: e.target.checked })}
              />
              <span>{c.form.income}</span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted">{c.form.account}</span>
              <select
                aria-label={c.form.account}
                value={draft.accountKey}
                onChange={(e) => patch({ accountKey: e.target.value })}
              >
                <option value="">{c.form.accountNone}</option>
                {accounts.map((account) => (
                  <option key={account.key} value={account.key}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted">{c.form.category}</span>
              <input
                aria-label={c.form.category}
                value={draft.category}
                placeholder={c.form.categoryNone}
                onChange={(e) => patch({ category: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-muted">{c.form.endMode}</span>
              <select
                aria-label={c.form.endMode}
                value={draft.endMode}
                onChange={(e) => patch({ endMode: e.target.value as Bill["endMode"] })}
              >
                <option value="never">{c.form.endNever}</option>
                <option value="on_date">{c.form.endOnDate}</option>
                <option value="after_count">{c.form.endAfterCount}</option>
              </select>
            </label>
            {draft.endMode === "on_date" && (
              <label className="flex flex-col gap-1">
                <span className="text-muted">{c.form.endDate}</span>
                <input
                  type="date"
                  aria-label={c.form.endDate}
                  value={draft.endOn}
                  onChange={(e) => patch({ endOn: e.target.value })}
                />
              </label>
            )}
            {draft.endMode === "after_count" && (
              <label className="flex flex-col gap-1">
                <span className="text-muted">{c.form.endCount}</span>
                <input
                  type="number"
                  min={1}
                  aria-label={c.form.endCount}
                  value={draft.endAfterCount}
                  onChange={(e) => patch({ endAfterCount: e.target.value })}
                />
              </label>
            )}
          </form>
          {problems.length > 0 && (
            <p className="text-neg" role="alert">
              {c.form.problems[problems[0]]}
            </p>
          )}
          <div className="mt-[var(--sp-3)] flex gap-3">
            <Button variant="primary" data-testid="bills-save" disabled={busy} onClick={submit}>
              {c.save}
            </Button>
            <Button
              data-testid="bills-cancel"
              onClick={() => {
                setProblems([]);
                setDraft(null);
              }}
            >
              {c.cancel}
            </Button>
          </div>
        </Card>
      )}

      <Card as="section" aria-label={c.summary.toCover}>
        <div className="grid grid-cols-3 gap-[var(--sp-4)] max-[800px]:grid-cols-1">
          <div>
            <p className="m-0 text-muted">{c.summary.toCover}</p>
            <p className="m-0 text-2xl">{money(outlook.toCoverCents)}</p>
            <p className="m-0 text-muted">{c.summary.toCoverHint}</p>
            {outlook.overdueCents > 0 && (
              <Badge className="border-neg text-neg">
                {c.rowStatus.overdue}: {money(outlook.overdueCents)}
              </Badge>
            )}
          </div>
          <div>
            <p className="m-0 text-muted">{c.summary.paid}</p>
            <p className="m-0 text-2xl">{money(outlook.paidLastMonthCents)}</p>
            <p className="m-0 text-muted">{c.summary.paidHint}</p>
          </div>
          <div data-testid="bills-shortfall">
            <p className="m-0 text-muted">{c.summary.shortfall}</p>
            <p className={`m-0 text-2xl ${shortfallTone}`}>
              {outlook.shortfallCents != null ? money(outlook.shortfallCents) : "—"}
            </p>
            <p className="m-0 text-muted">
              {outlook.nextIncomeOn == null
                ? c.summary.unknownPayday
                : outlook.cashCents == null
                  ? c.summary.unknownCash
                  : outlook.shortfallCents != null && outlook.shortfallCents > 0
                    ? c.summary.shortfallAmount(
                        money(outlook.shortfallCents),
                        formatDate(locale, outlook.nextIncomeOn),
                      )
                    : c.summary.enough(
                        money(Math.max(0, (outlook.cashCents ?? 0) - outlook.toCoverCents)),
                        formatDate(locale, outlook.nextIncomeOn),
                      )}
            </p>
          </div>
        </div>
      </Card>

      <Card as="section" aria-label={c.upcoming.title}>
        <h2>{c.upcoming.title}</h2>
        <p className="m-0 text-muted">
          {c.upcoming.horizon(formatDate(locale, outlook.periodEndsOn))}
        </p>
        {rows.length === 0 ? (
          <p className="m-0 mt-[var(--sp-3)]">
            {c.upcoming.empty} {c.upcoming.emptyHint}
          </p>
        ) : (
          <ul className="m-0 list-none p-0" data-testid="bills-upcoming">
            {rows.map((row) => {
              const suggestion = suggestions.get(row.occurrence.id);
              const settlement = settlements.get(row.occurrence.id);
              return (
                <li key={row.occurrence.id} className="border-b border-line py-2 last:border-b-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="flex min-w-[12rem] flex-col">
                      <span className="font-medium">{row.bill.name}</span>
                      <span className="text-muted">
                        {formatDate(locale, row.occurrence.dueOn)} ·{" "}
                        {cadenceText(row.bill, locale, c)}
                      </span>
                    </span>
                    <Badge className={statusTone(row.status)}>{c.rowStatus[row.status]}</Badge>
                    <span className={row.direction === "in" ? "text-pos" : ""}>
                      {money(row.amountCents)}
                    </span>
                  </div>
                  {settlement?.state === "partial" && (
                    <p
                      className="m-0 mt-1 text-muted"
                      data-testid={`bills-partial-${row.occurrence.id}`}
                    >
                      {c.match.partial(money(settlement.remainingCents))}
                    </p>
                  )}
                  {suggestion != null && (
                    <div
                      className="mt-1 flex flex-wrap items-center gap-3"
                      data-testid={`bills-match-${row.occurrence.id}`}
                    >
                      <span>
                        {c.match.suggestion}:{" "}
                        <strong>
                          {txById.get(suggestion.txId)?.counterparty ?? suggestion.txName}
                        </strong>
                        {" · "}
                        {money(suggestion.amountCents)}
                        {" · "}
                        {formatDate(locale, suggestion.txDate)}
                      </span>
                      <span className="text-muted">
                        {c.match.score(`${Math.round(suggestion.confidence * 100)}%`)}
                      </span>
                      {suggestion.evidence.pending && (
                        <Badge className="border-neg text-neg">{c.match.pending}</Badge>
                      )}
                      {suggestion.ambiguous && (
                        <Badge className="border-neg text-neg">{c.match.ambiguous}</Badge>
                      )}
                      <Button
                        data-testid={`bills-confirm-${row.occurrence.id}`}
                        variant="primary"
                        disabled={busy}
                        onClick={() =>
                          act({ kind: "confirm-match", candidate: suggestion, source: "user" })
                        }
                      >
                        {c.match.confirm}
                      </Button>
                      <Button
                        data-testid={`bills-reject-${row.occurrence.id}`}
                        disabled={busy}
                        onClick={() => act({ kind: "reject-match", candidate: suggestion })}
                      >
                        {c.match.reject}
                      </Button>
                    </div>
                  )}
                  {settlement?.state !== "paid" && (
                    <CardLink
                      className="mt-1"
                      aria-label={`${c.match.markPaid}: ${row.bill.name}`}
                      data-testid={`bills-mark-paid-${row.occurrence.id}`}
                      disabled={busy}
                      onClick={() => act({ kind: "mark-paid", occurrenceId: row.occurrence.id })}
                    >
                      {c.match.markPaid}
                    </CardLink>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card as="section" aria-label={c.calendar.title}>
        <div className="flex items-center justify-between">
          <h2 className="m-0">{c.calendar.title}</h2>
          <div className="flex items-center gap-2">
            <Button
              aria-label={c.calendar.previous}
              onClick={() => setMonth(shiftMonth(month, -1))}
            >
              ‹
            </Button>
            <span>{monthLabel(locale, month)}</span>
            <Button aria-label={c.calendar.next} onClick={() => setMonth(shiftMonth(month, 1))}>
              ›
            </Button>
          </div>
        </div>
        <table className="mt-[var(--sp-3)] w-full border-collapse text-center">
          <thead>
            <tr>
              {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                <th key={d} className="p-1 text-muted">
                  {weekdayLabel(locale, d)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody data-testid="bills-calendar">
            {weeks.map((week, i) => (
              <tr key={i}>
                {week.map((cell) => (
                  <td
                    key={cell.date}
                    className={`border border-line p-2 align-top ${cell.inMonth ? "" : "opacity-40"} ${
                      cell.isToday ? "outline outline-2 outline-accent" : ""
                    }`}
                  >
                    <span className="text-[0.8rem]">{Number(cell.date.slice(8, 10))}</span>
                    {cell.rows.map((row) => (
                      <span key={row.occurrence.id} className="block truncate text-[0.75rem]">
                        {row.bill.name} {money(row.amountCents)}
                      </span>
                    ))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {rows.filter((r) => r.occurrence.dueOn.slice(0, 7) === month).length === 0 && (
          <p className="m-0 text-muted">{c.calendar.empty}</p>
        )}
      </Card>

      <Card as="section" aria-label={c.series.title}>
        <h2>{c.series.title}</h2>
        {series.length === 0 ? (
          <p className="m-0">{c.series.empty}</p>
        ) : (
          <ul className="m-0 list-none p-0" data-testid="bills-series">
            {series.map(({ bill, nextDueOn }) => (
              <li
                key={bill.id}
                className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line py-2 last:border-b-0"
              >
                <span className="flex min-w-[14rem] flex-col">
                  <span className="font-medium">
                    {bill.name}{" "}
                    <Badge className={statusTone(bill.status)}>{c.status[bill.status]}</Badge>
                  </span>
                  <span className="text-muted">
                    {formatEuroIn(locale, resolveBillAmountCents(bill) / 100)} ·{" "}
                    {cadenceText(bill, locale, c)}
                    {nextDueOn != null && bill.status === "active"
                      ? ` · ${c.series.nextDue(formatDate(locale, nextDueOn))}`
                      : ""}
                    {priceChangeByBill.has(bill.id) &&
                      ` · ${c.match.priceChanged(
                        money(priceChangeByBill.get(bill.id)?.oldAmountCents ?? 0),
                        money(priceChangeByBill.get(bill.id)?.newAmountCents ?? 0),
                        formatDate(locale, priceChangeByBill.get(bill.id)?.effectiveOn ?? asOf),
                      )}`}
                  </span>
                </span>
                <span className="flex gap-3">
                  <CardLink
                    aria-label={`${c.series.edit} ${bill.name}`}
                    onClick={() => {
                      setProblems([]);
                      setDraft(draftFor(bill));
                    }}
                  >
                    {c.series.edit}
                  </CardLink>
                  {bill.status === "active" ? (
                    <CardLink
                      aria-label={`${c.series.pause} ${bill.name}`}
                      onClick={() => setStatus(bill, "paused")}
                    >
                      {c.series.pause}
                    </CardLink>
                  ) : bill.status === "paused" ? (
                    <CardLink
                      aria-label={`${c.series.resume} ${bill.name}`}
                      onClick={() => setStatus(bill, "active")}
                    >
                      {c.series.resume}
                    </CardLink>
                  ) : null}
                  {bill.status !== "ended" && (
                    <CardLink
                      variant="danger"
                      aria-label={`${c.series.end} ${bill.name}`}
                      onClick={() => setStatus(bill, "ended")}
                    >
                      {c.series.end}
                    </CardLink>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card as="section" aria-label={c.history.title}>
        <h2>{c.history.title}</h2>
        {history.length === 0 ? (
          <p className="m-0">
            {c.history.empty} {c.history.emptyHint}
          </p>
        ) : (
          <ul className="m-0 list-none p-0">
            {history.map(({ occurrence, bill, amountCents }) => {
              const match = decisionsNow.matches.find((m) => m.occurrenceId === occurrence.id);
              const mark = decisionsNow.marks.find((m) => m.occurrenceId === occurrence.id);
              const source =
                mark != null
                  ? c.match.markedPaid
                  : match == null
                    ? ""
                    : match.source === "auto"
                      ? c.match.autoMatched
                      : c.match.paidBy(txById.get(match.txId)?.counterparty ?? "");
              return (
                <li
                  key={occurrence.id}
                  className="flex items-baseline justify-between gap-2 border-b border-line py-2 last:border-b-0"
                >
                  <span>
                    {bill.name}{" "}
                    <span className="text-muted">{formatDate(locale, occurrence.dueOn)}</span>
                    {source !== "" && <span className="block text-muted">{source}</span>}
                  </span>
                  <span className="flex gap-3">
                    <Badge className={statusTone(occurrence.status)}>
                      {c.rowStatus[occurrence.status as keyof BillsCopy["rowStatus"]]}
                    </Badge>
                    <span>{formatEuroIn(locale, amountCents / 100)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </section>
  );
}

/** The cadence select shows the phrase the series will actually get. */
function cadenceOptionLabel(
  c: BillsCopy,
  key: Exclude<CadenceKey, "custom">,
  locale: Locale,
  firstDue: string,
): string {
  const rule = ruleForCadence(key, firstDue);
  const probe: Bill = {
    id: "",
    name: "",
    type: "bill",
    status: "active",
    direction: "out",
    amountCents: 0,
    amountStrategy: "fixed",
    currency: "EUR",
    rules: [rule],
    anchorDate: firstDue,
    weekendAdjust: "none",
    endMode: "never",
    tags: [],
  };
  return cadenceText(probe, locale, c);
}

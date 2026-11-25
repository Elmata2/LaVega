import { useState, type ReactNode } from "react";
import type {
  AccountWrapper,
  AccountWrapperEntry,
  DisposalLabelCategory,
  DisposalLabelEntry,
  RealizedDisposal,
  RealizedIncomeReportData,
  TaxTreatment,
} from "@lavega/core";
import { DISPOSAL_LABEL_CATEGORIES } from "@lavega/core";
import { formatMoney } from "../lib/portfolioFigures.js";
import { count } from "../lib/utils.js";
import { shortDate } from "../lib/dates.js";
import { brokerLabel, isBrokerId } from "@lavega/core";

/** The wrapper choices the select offers. The label names the account type; it
 *  is account metadata, not a tax calculation. */
export const WRAPPER_LABELS: Record<AccountWrapper, string> = {
  brokerage: "Brokerage (taxable)",
  isa: "ISA (UK)",
  lisa: "LISA (UK)",
  sipp: "SIPP (UK)",
  pea: "PEA (France)",
  "assurance-vie": "Assurance-vie (France)",
  "pillar-3a": "Pillar 3a (Switzerland)",
  "pillar-3b": "Pillar 3b (Switzerland)",
  "private-pension": "Private pension (Netherlands)",
  ira: "IRA (US)",
  "roth-ira": "Roth IRA (US)",
  "401k": "401(k) (US)",
  unknown: "Not set",
};

export const TREATMENT_LABELS: Record<TaxTreatment, string> = {
  taxable: "Taxable",
  "tax-deferred": "Tax deferred",
  "tax-exempt": "Tax exempt",
  "tax-advantaged": "Tax advantaged",
  unknown: "Unknown treatment",
};

export const DISPOSAL_LABEL_COPY: Record<DisposalLabelCategory, string> = {
  verified: "Verified",
  "fx-difference": "FX / fee difference",
  "corporate-action": "Corporate action",
  "partial-history": "Partial history",
  "tax-loss-harvest": "Tax-loss harvest",
  "needs-review": "Needs review",
  other: "Other",
};

const REASON_COPY: Record<string, string> = {
  "missing-fx": "FX rate missing",
  "no-history": "No trade history",
  "transfer-in": "Units arrived by transfer",
  "quantity-mismatch": "History does not match the holding",
  "missing-price": "No price reported",
  "missing-fee": "No fee reported",
  "provider-incomplete": "Broker basis incomplete",
};

function reasonCopy(reason: string | null): string {
  return reason === null ? "" : (REASON_COPY[reason] ?? "Reason unavailable");
}

function sumKnown(values: readonly (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0);
}

function money(cents: number | null, currency: string, signDisplay: "auto" | "always" = "auto") {
  return cents === null ? "Unknown" : formatMoney(cents / 100, currency, signDisplay);
}

function Unknown({ reason }: { reason: string | null }) {
  return (
    <span className="text-muted-foreground">
      Unknown
      {reason ? ` — ${reasonCopy(reason)}` : ""}
    </span>
  );
}

function accountDisplayName(broker: string, account: string): string {
  const brokerName = broker
    ? isBrokerId(broker)
      ? brokerLabel(broker)
      : broker
    : "Unassigned broker";
  return account ? `${brokerName} · ${account}` : brokerName;
}

function disposalNeedsAttention(
  disposal: RealizedDisposal,
  label: DisposalLabelEntry | undefined,
): boolean {
  if (label?.category === "verified") return false;
  return (
    disposal.reconciliation.status !== "reconciled" ||
    disposal.realizedGainCents === null ||
    disposal.treatment === "unknown"
  );
}

function ReconciliationBadge({
  disposal,
  reportCurrency,
}: {
  disposal: RealizedDisposal;
  reportCurrency: string;
}) {
  const { reconciliation } = disposal;
  if (reconciliation.status === "reconciled")
    return (
      <span className="rounded-pill bg-positive/10 px-2 py-0.5 text-xs font-semibold text-positive">
        Reconciled
      </span>
    );
  if (reconciliation.status === "difference")
    return (
      <div className="flex flex-col items-start gap-1">
        <span className="rounded-pill bg-negative/10 px-2 py-0.5 text-xs font-semibold text-negative">
          Does not reconcile
        </span>
        <span className="text-xs text-muted-foreground tabular-nums">
          Broker cash {money(reconciliation.brokerCashCents, reportCurrency)} vs proceeds{" "}
          {money(reconciliation.netProceedsCents, reportCurrency)} (
          {money(reconciliation.differenceCents, reportCurrency, "always")})
        </span>
      </div>
    );
  if (reconciliation.status === "missing-fx")
    return (
      <div className="flex flex-col items-start gap-1">
        <span className="rounded-pill bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
          FX missing
        </span>
        <span className="text-xs text-muted-foreground">
          No FX rate for {disposal.tradeCurrency} on {shortDate(disposal.date)}
        </span>
      </div>
    );
  if (reconciliation.status === "not-computable")
    return (
      <div className="flex flex-col items-start gap-1">
        <span className="rounded-pill bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
          Proceeds unknown
        </span>
        <span className="text-xs text-muted-foreground">Missing price or fee on trade</span>
      </div>
    );
  return (
    <div className="flex flex-col items-start gap-1">
      <span className="rounded-pill bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
        No broker cash reported
      </span>
      <span className="text-xs text-muted-foreground">
        Broker snapshot has no settled cash for this trade
      </span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-card border border-border bg-card p-5">
      <h2 className="font-sans text-xl font-semibold tracking-tight">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Summary({ report }: { report: RealizedIncomeReportData }) {
  const realised = sumKnown(report.byTreatment.map((group) => group.realizedGainCents));
  const unrealised = sumKnown(report.byTreatment.map((group) => group.unrealizedGainCents));
  const income = report.income.tieOut.totalCents;
  const unknownDisposals = report.byTreatment.reduce(
    (total, group) => total + group.unknownDisposals,
    0,
  );
  const unknownHoldings = report.byTreatment.reduce(
    (total, group) => total + group.unknownHoldings,
    0,
  );
  const figures = [
    {
      label: "Realised gain",
      value: money(realised, report.currency, "always"),
      note: unknownDisposals > 0 ? `${count(unknownDisposals, "disposal")} unknown` : null,
    },
    {
      label: "Unrealised gain",
      value: money(unrealised, report.currency, "always"),
      note: unknownHoldings > 0 ? `${unknownHoldings} holding(s) unknown` : null,
    },
    {
      label: "Income",
      value: money(income, report.currency),
      note: report.income.tieOut.status === "tied" ? "Ties to cash movements" : null,
    },
  ];
  return (
    <dl className="grid gap-3 sm:grid-cols-3">
      {figures.map((figure) => (
        <div key={figure.label} className="rounded-tile bg-secondary/40 p-4">
          <dt className="text-xs font-semibold text-muted-foreground">{figure.label}</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">{figure.value}</dd>
          {figure.note && <p className="mt-1 text-xs text-warning">{figure.note}</p>}
        </div>
      ))}
    </dl>
  );
}

export function RealizedReport({
  report,
  onSetWrapper,
  disposalLabels = [],
  onSaveDisposalLabel,
  onClearDisposalLabel,
}: {
  report: RealizedIncomeReportData;
  onSetWrapper?: (entry: AccountWrapperEntry) => void | Promise<void>;
  disposalLabels?: readonly DisposalLabelEntry[];
  onSaveDisposalLabel?: (input: {
    disposalId: string;
    category: DisposalLabelCategory;
    note?: string;
  }) => void | Promise<void>;
  onClearDisposalLabel?: (disposalId: string) => void | Promise<void>;
}) {
  const [disposalFilter, setDisposalFilter] = useState<"all" | "attention" | "reconciled">("all");
  const [editingDisposalId, setEditingDisposalId] = useState<string | null>(null);
  const [draftCategory, setDraftCategory] = useState<DisposalLabelCategory>("verified");
  const [draftNote, setDraftNote] = useState("");

  const labelById = new Map(disposalLabels.map((entry) => [entry.disposalId, entry]));
  const attentionCount = report.disposals.filter((disposal) =>
    disposalNeedsAttention(disposal, labelById.get(disposal.id)),
  ).length;
  const reconciledCount = report.disposals.filter(
    (disposal) => disposal.reconciliation.status === "reconciled",
  ).length;
  const filteredDisposals = report.disposals.filter((disposal) => {
    if (disposalFilter === "attention") {
      return disposalNeedsAttention(disposal, labelById.get(disposal.id));
    }
    if (disposalFilter === "reconciled") {
      return disposal.reconciliation.status === "reconciled";
    }
    return true;
  });

  const openEditor = (disposal: RealizedDisposal) => {
    const existing = labelById.get(disposal.id);
    setEditingDisposalId(disposal.id);
    setDraftCategory(
      existing?.category ??
        (disposal.reconciliation.status === "difference"
          ? "fx-difference"
          : disposal.reason === "no-history" || disposal.reason === "transfer-in"
            ? "partial-history"
            : "verified"),
    );
    setDraftNote(existing?.note ?? "");
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-card border border-border bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="font-display text-4xl">Realised gains and income</h1>
          <p className="text-sm text-muted-foreground">As of {shortDate(report.asOf)}</p>
        </div>
        <p className="mt-3 text-sm text-muted-foreground" role="note">
          {report.notice}
        </p>
        {report.problems.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1 text-sm text-warning">
            {report.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
      </div>

      <Summary report={report} />

      <Section title="By tax treatment">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 pr-4 font-semibold">Treatment</th>
                <th className="py-2 pr-4 text-right font-semibold">Realised</th>
                <th className="py-2 pr-4 text-right font-semibold">Unrealised</th>
                <th className="py-2 pr-4 text-right font-semibold">Income</th>
                <th className="py-2 pr-4 text-right font-semibold">Disposals</th>
                <th className="py-2 text-right font-semibold">Holdings</th>
              </tr>
            </thead>
            <tbody>
              {report.byTreatment.map((group) => (
                <tr key={group.treatment} className="border-b border-border/60">
                  <td className="py-2 pr-4 font-semibold">{TREATMENT_LABELS[group.treatment]}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {money(group.realizedGainCents, report.currency, "always")}
                    {group.unknownDisposals > 0 && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        ({group.unknownDisposals} unknown)
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {money(group.unrealizedGainCents, report.currency, "always")}
                    {group.unknownHoldings > 0 && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        ({group.unknownHoldings} unknown)
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {money(group.incomeCents, report.currency)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">{group.disposals}</td>
                  <td className="py-2 text-right tabular-nums">{group.holdings}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Accounts">
        <p className="mb-3 text-sm text-muted-foreground">
          The account type only groups the report. It does not change any figure.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="py-2 pr-4 font-semibold">Account</th>
                <th className="py-2 pr-4 font-semibold">Account type</th>
                <th className="py-2 pr-4 font-semibold">Treatment</th>
                <th className="py-2 pr-4 text-right font-semibold">Realised</th>
                <th className="py-2 pr-4 text-right font-semibold">Unrealised</th>
                <th className="py-2 text-right font-semibold">Income</th>
              </tr>
            </thead>
            <tbody>
              {report.accounts.map((account) => (
                <tr
                  key={`${account.broker}\u0000${account.account}`}
                  className="border-b border-border/60"
                >
                  <td className="py-2 pr-4 font-semibold">
                    {account.broker
                      ? isBrokerId(account.broker)
                        ? brokerLabel(account.broker)
                        : account.broker
                      : "Unassigned broker"}
                    {account.account ? ` · ${account.account}` : ""}
                  </td>
                  <td className="py-2 pr-4">
                    <select
                      aria-label={`Account type for ${account.broker || "unassigned"} ${account.account}`}
                      className="min-h-9 rounded-tile border border-border bg-background px-2 py-1 text-sm"
                      value={account.wrapper}
                      onChange={(event) => {
                        const wrapper = event.target.value as AccountWrapper;
                        void onSetWrapper?.({
                          broker: account.broker,
                          account: account.account,
                          wrapper,
                        });
                      }}
                    >
                      {Object.entries(WRAPPER_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {TREATMENT_LABELS[account.treatment]}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {money(account.realizedGainCents, report.currency, "always")}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {money(account.unrealizedGainCents, report.currency, "always")}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {money(account.incomeCents, report.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Disposals">
        {report.disposals.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No disposals in this snapshot. A sale would appear here with its proceeds, fee, basis
            and broker-cash check.
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter disposals">
              {(
                [
                  { id: "all", label: `All (${report.disposals.length})` },
                  { id: "attention", label: `Needs attention (${attentionCount})` },
                  { id: "reconciled", label: `Reconciled (${reconciledCount})` },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={disposalFilter === item.id}
                  onClick={() => setDisposalFilter(item.id)}
                  className={`rounded-pill border px-3 py-1 text-xs font-semibold transition-colors ${
                    disposalFilter === item.id
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-background text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {filteredDisposals.length === 0 ? (
              <div className="rounded-tile border border-border/60 bg-secondary/20 p-4 text-sm text-muted-foreground">
                No disposals match this filter.{" "}
                <button
                  type="button"
                  onClick={() => setDisposalFilter("all")}
                  className="font-semibold text-foreground underline underline-offset-2"
                >
                  Show all disposals
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-sm" aria-label="Disposals">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-4 font-semibold">Date</th>
                      <th className="py-2 pr-4 font-semibold">Symbol &amp; account</th>
                      <th className="py-2 pr-4 text-right font-semibold">Quantity</th>
                      <th className="py-2 pr-4 text-right font-semibold">Proceeds</th>
                      <th className="py-2 pr-4 text-right font-semibold">Fee</th>
                      <th className="py-2 pr-4 text-right font-semibold">Net proceeds</th>
                      <th className="py-2 pr-4 text-right font-semibold">Cost basis</th>
                      <th className="py-2 pr-4 text-right font-semibold">Realised</th>
                      <th className="py-2 pr-4 font-semibold">Broker cash check</th>
                      <th className="py-2 font-semibold">Label</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDisposals.flatMap((disposal) => {
                      const label = labelById.get(disposal.id);
                      const isEditing = editingDisposalId === disposal.id;
                      const rows = [
                        <tr key={disposal.id} className="border-b border-border/60 align-top">
                          <td className="py-2 pr-4 whitespace-nowrap">{shortDate(disposal.date)}</td>
                          <td className="py-2 pr-4">
                            <div className="font-semibold">{disposal.symbol}</div>
                            <div className="text-xs text-muted-foreground">
                              {accountDisplayName(disposal.broker, disposal.account)} ·{" "}
                              <span
                                className={
                                  disposal.treatment === "unknown"
                                    ? "font-medium text-warning"
                                    : undefined
                                }
                              >
                                {TREATMENT_LABELS[disposal.treatment]}
                              </span>
                            </div>
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums">{disposal.quantity}</td>
                          <td className="py-2 pr-4 text-right tabular-nums">
                            {disposal.grossProceedsCents === null ? (
                              <Unknown reason={disposal.reason} />
                            ) : (
                              money(disposal.grossProceedsCents, report.currency)
                            )}
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums">
                            {money(disposal.feesCents, report.currency)}
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums">
                            {disposal.netProceedsCents === null ? (
                              <Unknown reason={disposal.reason} />
                            ) : (
                              money(disposal.netProceedsCents, report.currency)
                            )}
                          </td>
                          <td className="py-2 pr-4 text-right tabular-nums">
                            {disposal.costBasisCents === null ? (
                              <Unknown reason={disposal.reason} />
                            ) : (
                              money(disposal.costBasisCents, report.currency)
                            )}
                          </td>
                          <td className="py-2 pr-4 text-right font-semibold tabular-nums">
                            {disposal.realizedGainCents === null ? (
                              <Unknown reason={disposal.reason} />
                            ) : (
                              money(disposal.realizedGainCents, report.currency, "always")
                            )}
                          </td>
                          <td className="py-2 pr-4">
                            <ReconciliationBadge
                              disposal={disposal}
                              reportCurrency={report.currency}
                            />
                          </td>
                          <td className="py-2">
                            <div className="flex flex-col items-start gap-1">
                              {label ? (
                                <>
                                  <span
                                    className={`rounded-pill px-2 py-0.5 text-xs font-semibold ${
                                      label.category === "verified"
                                        ? "bg-positive/10 text-positive"
                                        : label.category === "needs-review"
                                          ? "bg-warning/15 text-warning"
                                          : "bg-secondary text-foreground"
                                    }`}
                                  >
                                    {DISPOSAL_LABEL_COPY[label.category]}
                                  </span>
                                  {label.note && (
                                    <span className="max-w-[200px] text-xs text-muted-foreground">
                                      {label.note}
                                    </span>
                                  )}
                                </>
                              ) : (
                                <span className="text-xs text-muted-foreground">Unlabeled</span>
                              )}
                              {(onSaveDisposalLabel || onSetWrapper) && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    isEditing ? setEditingDisposalId(null) : openEditor(disposal)
                                  }
                                  className="text-xs font-semibold text-foreground underline underline-offset-2"
                                >
                                  {isEditing ? "Close" : label ? "Edit" : "Label"}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>,
                      ];
                      if (isEditing) {
                        rows.push(
                          <tr
                            key={`${disposal.id}-editor`}
                            className="border-b border-border bg-secondary/20"
                          >
                            <td colSpan={10} className="p-3">
                              <div className="flex flex-wrap items-end gap-3">
                                {onSaveDisposalLabel && (
                                  <>
                                    <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
                                      Category
                                      <select
                                        aria-label={`Label category for ${disposal.symbol} ${shortDate(disposal.date)}`}
                                        className="min-h-9 rounded-tile border border-border bg-background px-2 py-1 text-sm font-normal text-foreground"
                                        value={draftCategory}
                                        onChange={(event) =>
                                          setDraftCategory(
                                            event.target.value as DisposalLabelCategory,
                                          )
                                        }
                                      >
                                        {DISPOSAL_LABEL_CATEGORIES.map((category) => (
                                          <option key={category} value={category}>
                                            {DISPOSAL_LABEL_COPY[category]}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                    <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-xs font-semibold text-muted-foreground">
                                      Note
                                      <input
                                        type="text"
                                        aria-label={`Note for ${disposal.symbol} ${shortDate(disposal.date)}`}
                                        placeholder="Why it differs or how you categorized it…"
                                        className="min-h-9 rounded-tile border border-border bg-background px-2.5 py-1 text-sm font-normal text-foreground"
                                        value={draftNote}
                                        onChange={(event) => setDraftNote(event.target.value)}
                                      />
                                    </label>
                                  </>
                                )}
                                {onSetWrapper && (
                                  <label className="flex flex-col gap-1 text-xs font-semibold text-muted-foreground">
                                    Account type
                                    <select
                                      aria-label={`Account type for disposal ${disposal.symbol} ${shortDate(disposal.date)}`}
                                      className="min-h-9 rounded-tile border border-border bg-background px-2 py-1 text-sm font-normal text-foreground"
                                      value={disposal.wrapper}
                                      onChange={(event) => {
                                        const wrapper = event.target.value as AccountWrapper;
                                        void onSetWrapper({
                                          broker: disposal.broker,
                                          account: disposal.account,
                                          wrapper,
                                        });
                                      }}
                                    >
                                      {Object.entries(WRAPPER_LABELS).map(([value, labelText]) => (
                                        <option key={value} value={value}>
                                          {labelText}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                )}
                                <div className="flex items-center gap-2">
                                  {onSaveDisposalLabel && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void onSaveDisposalLabel({
                                          disposalId: disposal.id,
                                          category: draftCategory,
                                          note: draftNote,
                                        });
                                        setEditingDisposalId(null);
                                      }}
                                      className="min-h-9 rounded-tile bg-foreground px-3 py-1 text-xs font-semibold text-background"
                                    >
                                      Save label
                                    </button>
                                  )}
                                  {label && onClearDisposalLabel && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void onClearDisposalLabel(disposal.id);
                                        setEditingDisposalId(null);
                                      }}
                                      className="min-h-9 rounded-tile border border-border bg-background px-3 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
                                    >
                                      Clear
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => setEditingDisposalId(null)}
                                    className="min-h-9 rounded-tile border border-border bg-background px-3 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            </td>
                          </tr>,
                        );
                      }
                      return rows;
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </Section>

      <Section title="Income">
        <p className="mb-3 text-sm text-muted-foreground">
          Dividends and interest, grouped by symbol and month.{" "}
          {report.income.tieOut.status === "tied" &&
            "The total ties to the cash movements in the snapshot."}
          {report.income.tieOut.status === "missing-fx" &&
            "Some rows have no exact-date FX rate, so the total stays unknown."}
          {report.income.tieOut.status === "difference" &&
            "The rows do not tie to the cash movements."}
        </p>
        {report.income.groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No dividend or interest rows in this snapshot.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm" aria-label="Income groups">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-4 font-semibold">Kind</th>
                  <th className="py-2 pr-4 font-semibold">Symbol</th>
                  <th className="py-2 pr-4 font-semibold">Period</th>
                  <th className="py-2 pr-4 text-right font-semibold">Amount</th>
                  <th className="py-2 text-right font-semibold">Rows</th>
                </tr>
              </thead>
              <tbody>
                {report.income.groups.map((group) => (
                  <tr
                    key={`${group.kind}\u0000${group.symbol ?? ""}\u0000${group.period}`}
                    className="border-b border-border/60"
                  >
                    <td className="py-2 pr-4 capitalize">{group.kind}</td>
                    <td className="py-2 pr-4 font-semibold">{group.symbol ?? "Cash"}</td>
                    <td className="py-2 pr-4">{group.period}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {group.amountCents === null ? (
                        <Unknown reason="missing-fx" />
                      ) : (
                        money(group.amountCents, report.currency)
                      )}
                      {group.unknownRows > 0 && group.amountCents !== null && (
                        <span className="ml-2 text-xs text-warning">
                          +{group.unknownRows} unknown
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-right tabular-nums">{group.rows}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Holdings">
        {report.holdings.length === 0 ? (
          <p className="text-sm text-muted-foreground">No open holdings in this snapshot.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm" aria-label="Holdings">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="py-2 pr-4 font-semibold">Symbol</th>
                  <th className="py-2 pr-4 text-right font-semibold">Quantity</th>
                  <th className="py-2 pr-4 text-right font-semibold">Value</th>
                  <th className="py-2 pr-4 text-right font-semibold">Cost basis</th>
                  <th className="py-2 pr-4 text-right font-semibold">Unrealised</th>
                  <th className="py-2 font-semibold">Treatment</th>
                </tr>
              </thead>
              <tbody>
                {report.holdings.map((holding) => (
                  <tr
                    key={`${holding.broker}\u0000${holding.account}\u0000${holding.symbol}`}
                    className="border-b border-border/60"
                  >
                    <td className="py-2 pr-4 font-semibold">{holding.symbol}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{holding.quantity}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {holding.marketValueCents === null ? (
                        <Unknown reason={holding.reason} />
                      ) : (
                        money(holding.marketValueCents, report.currency)
                      )}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {holding.costBasisCents === null ? (
                        <Unknown reason={holding.reason} />
                      ) : (
                        money(holding.costBasisCents, report.currency)
                      )}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {holding.unrealizedGainCents === null ? (
                        <Unknown reason={holding.reason} />
                      ) : (
                        money(holding.unrealizedGainCents, report.currency, "always")
                      )}
                    </td>
                    <td className="py-2 text-muted-foreground">
                      {TREATMENT_LABELS[holding.treatment]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

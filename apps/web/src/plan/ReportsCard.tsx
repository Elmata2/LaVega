import StatusLine from "../components/ui/StatusLine.js";
import type { AccountTypeKind, BalanceSheet, IncomeStatement, Reports } from "@lavega/core";
import Card from "../components/ui/Card.js";
import { moneyCopy } from "../copy/money.js";
import { reportsCopy, type PlanFmt, type ReportsCopy } from "../copy/plan/index.js";
import { Rows, useSectionCopy, type FigureRow } from "./sections/common.js";

/** The reports card: the balance sheet and the income statements (WS3.3,
 *  issue #292). Not one of the plan's seven sections (it has no status or
 *  change-log entry), but it follows their frame: figures first, then the
 *  calculation in plain sentences. A gap is a sentence, never a zero. */
export default function ReportsCard({ reports }: { reports: Reports }) {
  const { locale, fmt } = useSectionCopy();
  const copy = reportsCopy[locale];
  const typeLabels = moneyCopy[locale].accountTypes;
  const sheet = reports.balanceSheet;

  const amount = (cents: number | null): string =>
    cents == null ? copy.balanceSheet.unknownValue : fmt.eur(cents);
  const sheetRows: FigureRow[] = [
    { key: "assets", label: copy.balanceSheet.assets, value: amount(sheet.assetsCents) },
    {
      key: "liabilities",
      label: copy.balanceSheet.liabilities,
      value: amount(sheet.liabilitiesCents),
    },
    { key: "equity", label: copy.balanceSheet.equity, value: amount(sheet.equityCents) },
  ];

  return (
    <Card as="section" aria-label={copy.title} data-testid="plan-reports">
      <h2>{copy.title}</h2>
      <p className="m-0 text-muted" data-testid="reports-intro">
        {copy.intro}
      </p>

      <BalanceSheetBody sheet={sheet} typeLabels={typeLabels} fmt={fmt} copy={copy} />
      <Rows rows={sheetRows} testId="reports-balance-totals" />
      <CalcDetails sheet={sheet} copy={copy} />

      <h3 className="mt-5">{copy.income.title}</h3>
      <p className="m-0 text-muted">{copy.income.intro}</p>
      <div className="mt-3 grid gap-4">
        {reports.incomeStatements.map((statement) => (
          <IncomeStatementBody
            key={statement.period.month}
            statement={statement}
            fmt={fmt}
            copy={copy}
          />
        ))}
      </div>
    </Card>
  );
}

function BalanceSheetBody({
  sheet,
  typeLabels,
  fmt,
  copy,
}: {
  sheet: BalanceSheet;
  typeLabels: Record<AccountTypeKind, string>;
  fmt: PlanFmt;
  copy: ReportsCopy;
}) {
  const side = (groups: BalanceSheet["assets"], kind: "asset" | "liability") => (
    <div data-testid={kind === "asset" ? "reports-assets" : "reports-liabilities"}>
      {groups.map((group) => (
        <section key={group.kind} data-testid={`reports-${kind}-${group.kind}`}>
          <h4 className="m-0 mb-1 flex items-baseline justify-between gap-2 text-[0.95rem]">
            <span>{typeLabels[group.kind] ?? group.kind}</span>
            <span className="tabular-nums">{fmt.eur(group.totalCents)}</span>
          </h4>
          <ul className="m-0 mb-2 grid list-none gap-1 p-0 text-[0.9rem]">
            {group.accounts.map((account) => (
              <li
                key={account.accountKey}
                className="flex items-baseline justify-between gap-2"
                data-testid={`reports-row-${account.accountKey}`}
              >
                <span className="flex flex-col">
                  <span>{account.name}</span>
                  {account.stale && (
                    <span className="text-muted text-[0.8rem]">
                      {copy.balanceSheet.stale}
                      {account.anchor == null ? "" : ` · ${fmt.date(account.anchor.date)}`}
                    </span>
                  )}
                </span>
                <span className="tabular-nums">
                  {account.balanceCents == null
                    ? copy.balanceSheet.rowUnknown
                    : fmt.eur(
                        kind === "liability"
                          ? Math.abs(account.balanceCents)
                          : account.balanceCents,
                      )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );

  return (
    <div className="mt-4 grid gap-3">
      <h3 className="m-0">{copy.balanceSheet.title}</h3>
      <p className="m-0 text-muted">{copy.balanceSheet.intro}</p>
      {sheet.unknownAccounts.length > 0 && (
        <StatusLine tone="warning" className="m-0" data-testid="reports-gap">
          {copy.balanceSheet.gap(
            sheet.unknownAccounts.length,
            sheet.assets
              .flatMap((g) => g.accounts)
              .concat(sheet.liabilities.flatMap((g) => g.accounts))
              .filter((a) => a.balanceCents == null)
              .map((a) => a.name)
              .join(", "),
          )}
        </StatusLine>
      )}
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(16rem,1fr))]">
        {side(sheet.assets, "asset")}
        {side(sheet.liabilities, "liability")}
      </div>
    </div>
  );
}

function CalcDetails({ sheet, copy }: { sheet: BalanceSheet; copy: ReportsCopy }) {
  return (
    <details className="mt-1">
      <summary>{copy.howCalculated}</summary>
      <ul className="m-0 mt-1 grid list-none gap-1 p-0 text-[0.9rem]" data-testid="reports-calc">
        {sheet.calc.map((step) => (
          <li key={step.id}>{copy.calc[step.id] ?? step.id}</li>
        ))}
      </ul>
    </details>
  );
}

function IncomeStatementBody({
  statement,
  fmt,
  copy,
}: {
  statement: IncomeStatement;
  fmt: PlanFmt;
  copy: ReportsCopy;
}) {
  const s = statement;
  const rows: FigureRow[] = [
    { key: "income", label: copy.income.incomeTotal, value: fmt.eur(s.incomeCents) },
    { key: "spend", label: copy.income.spendTotal, value: fmt.eur(s.spendCents) },
    { key: "net", label: copy.income.netSavings, value: fmt.eur(s.netSavingsCents) },
    {
      key: "rate",
      label: copy.income.savingsRate,
      value: s.savingsRate == null ? copy.income.unknownRate : fmt.pct(s.savingsRate),
    },
  ];
  return (
    <section
      className="border-t border-t-line pt-3"
      data-testid={`reports-income-${s.period.month}`}
    >
      <h4 className="m-0 mb-1 flex flex-wrap items-baseline gap-2">
        <span>
          {fmt.monthLabel(s.period.month)} · {fmt.date(s.period.from)} – {fmt.date(s.period.to)}
        </span>
        {s.period.partial && (
          <span
            data-testid={`reports-partial-${s.period.month}`}
            className="rounded-pill border border-line bg-surface-2 text-muted text-[0.65rem] font-medium py-0.5 px-2 whitespace-nowrap"
          >
            {copy.income.partial}
          </span>
        )}
      </h4>
      <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(14rem,1fr))]">
        <div>
          <h5 className="m-0 mb-1 text-[0.8rem] font-semibold uppercase tracking-[0.03em] text-muted">
            {copy.income.incomeSide}
          </h5>
          {s.incomeCategories.length === 0 ? (
            <p className="m-0 text-muted">{copy.income.noIncome}</p>
          ) : (
            <ul className="m-0 grid list-none gap-1 p-0 text-[0.9rem]">
              {s.incomeCategories.map((row) => (
                <li key={row.category} className="flex items-baseline justify-between gap-2">
                  <span>{row.category}</span>
                  <span className="tabular-nums">{fmt.eur(row.incomeCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h5 className="m-0 mb-1 text-[0.8rem] font-semibold uppercase tracking-[0.03em] text-muted">
            {copy.income.spendSide}
          </h5>
          {s.spendCategories.length === 0 ? (
            <p className="m-0 text-muted">{copy.income.noSpend}</p>
          ) : (
            <ul className="m-0 grid list-none gap-1 p-0 text-[0.9rem]">
              {s.spendCategories.map((row) => (
                <li key={row.category} className="flex items-baseline justify-between gap-2">
                  <span>{row.category}</span>
                  <span className="tabular-nums">{fmt.eur(row.spendCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <Rows rows={rows} testId={`reports-totals-${s.period.month}`} />
      {s.excludedForeignCount > 0 && (
        <p className="m-0 text-muted text-[0.85rem]">
          {copy.income.excludedForeign(s.excludedForeignCount)}
        </p>
      )}
      {s.cleanedRows > 0 && (
        <p className="m-0 text-muted text-[0.85rem]">{copy.income.cleanedRows(s.cleanedRows)}</p>
      )}
      <details>
        <summary>{copy.howCalculated}</summary>
        <ul
          className="m-0 mt-1 grid list-none gap-1 p-0 text-[0.9rem]"
          data-testid={`reports-income-calc-${s.period.month}`}
        >
          {s.calc.map((step) => (
            <li key={step.id}>{copy.calc[step.id] ?? step.id}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}

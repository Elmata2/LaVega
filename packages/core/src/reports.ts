/**
 * Balance sheet and income statement (WS3.3, issue #292).
 *
 * Ported from Sure (we-promise/sure) commit 562fe09 — AGPL-3.0 — independently
 * reimplemented for LaVega; changed 2026-11-11.
 * Sure sources: `app/models/balance_sheet.rb` + `balance_sheet/*`,
 * `app/models/income_statement.rb` + `income_statement/totals.rb`,
 * `income_statement/category_netting.rb`, `app/models/period.rb`.
 * No Ruby is copied.
 *
 * Sure's BalanceSheet sums each account's converted balance, splits it into an
 * asset group and a liability group, and calls assets − liabilities the net
 * worth. Its IncomeStatement nets refunds per category FIRST and then splits
 * each category by the side it nets to, which is what makes income − spend
 * cross-foot; its median/avg stats are the savings-rate denominator.
 *
 * LaVega differences, each deliberate: integer cents everywhere (ADR 0011), no
 * clock (`asOf` is an argument), no cache and no Rails query objects — the
 * statement is derived from the same cleaned vault arrays the plan already
 * reads. Nothing is re-ported that the plan owns: personal scope, own-transfer
 * and card-settlement cleaning, FX conversion and category derivation are the
 * existing primitives. A balance the #291 series cannot reach is a NULL, never
 * zero: an unknown valuation leaves a gap in the balance sheet too.
 */
import type { Account, Rule, Tx } from "./model.js";
import { isEurCurrency } from "./model.js";
import type { EntityProfile } from "./entities.js";
import { cleanTxs, personalView } from "./advisor/scopePersonal.js";
import { scopedOwn } from "./advisor/room.js";
import { isIsoDate, isoMonth, lastDayOfMonth, previousMonths } from "./advisor/months.js";
import { toEur, type ConversionMode } from "./fx.js";
import { categorize, type OwnAccounts } from "./views.js";
import {
  accountAnchors,
  accountClassification,
  accountTypeKind,
  valuationStatus,
  type AccountClassification,
  type AccountTypeKind,
  type Valuation,
} from "./balance.js";
import { accountBalanceSeries, netWorthSeries } from "./balanceSeries.js";
import type { CalcStep, FigureMap, FigureValue } from "./plan/types.js";

/** Every "how calculated" step these reports emit, under the plan's convention
 *  (ruling P11), so the web layer can keep one exhaustive renderer. */
export const REPORT_CALC_IDS = [
  "report-assets-total",
  "report-liabilities-total",
  "report-equity",
  "report-net-worth-series",
  "report-income-total",
  "report-spend-total",
  "report-net-savings",
  "report-savings-rate",
] as const;
export type ReportCalcId = (typeof REPORT_CALC_IDS)[number];

const fig = (unit: FigureValue["unit"], value: number | string | null): FigureValue => ({
  unit,
  value,
});

/** A calendar-month reporting period. `partial` is true when the month is not
 *  over yet (or the caller asked for a shorter window): the figures then rest
 *  on what has been booked so far, and the view says so. */
export type ReportPeriod = {
  /** "YYYY-MM" */
  month: string;
  from: string;
  to: string;
  partial: boolean;
};

/** The period of one calendar month, clipped at `asOf` for the month in
 *  progress. A month that is not over is PARTIAL, never presented as a full
 *  one. */
export function reportMonthPeriod(month: string, asOf: string): ReportPeriod {
  const from = `${month}-01`;
  const last = lastDayOfMonth(month);
  const current = isoMonth(asOf) === month;
  const to = current && asOf < last ? asOf : last;
  return { month, from, to, partial: to < last };
}

export type ReportInput = {
  txs: readonly Tx[];
  accounts: readonly Account[];
  entityProfiles: readonly EntityProfile[];
  rules: Rule[];
  own: OwnAccounts;
  valuations?: readonly Valuation[];
  mode: ConversionMode;
  fxHistory: Record<string, Record<string, number>>;
  /** Categories that are money moves rather than income/spend (the plan's own
   *  set). They are dropped from both sides. */
  movedCategories: ReadonlySet<string>;
  asOf: string;
};

/* ── Income statement ─────────────────────────────────────────────────────── */

/** One category after refunds are netted, on the side it ends up on. */
export type IncomeCategoryRow = {
  category: string;
  /** 0 when the category nets to spending. */
  incomeCents: number;
  /** 0 when the category nets to income. */
  spendCents: number;
  /** spend − income; positive means the category is spending. */
  netCents: number;
  side: "income" | "spend";
};

export type IncomeStatement = {
  period: ReportPeriod;
  currency: string;
  /** Sum of the categories that net to income. */
  incomeCents: number;
  /** Sum of the categories that net to spending. */
  spendCents: number;
  /** `incomeCents - spendCents`. Cross-foots BY CONSTRUCTION: the two totals
   *  come from the same netted categories, and a test asserts it against an
   *  independent ledger pass. */
  netSavingsCents: number;
  /** `netSavingsCents / incomeCents`, or NULL when income is not positive:
   *  a zero or negative income makes the rate unknown, never 0 and never
   *  Infinity. */
  savingsRate: number | null;
  /** Newest-netted first, income rows first then spend rows, each by magnitude
   *  descending. */
  incomeCategories: IncomeCategoryRow[];
  spendCategories: IncomeCategoryRow[];
  /** Rows that were in scope and dated correctly. */
  transactionsCount: number;
  /** Rows excluded because their currency could not be converted honestly. */
  excludedForeignCount: number;
  /** Rows the plan's own pipeline dropped (own transfers, card settlement
   *  pairs) — counted, so the statement never silently differs from the plan. */
  cleanedRows: number;
  calc: CalcStep[];
};

const figureMap = (entries: Record<string, FigureValue>): FigureMap => entries;

/** Convert one row to EUR cents the way the plan does: one rounding per row,
 *  `separate` mode leaves a foreign row out entirely. */
function eurCents(
  tx: Tx,
  mode: ConversionMode,
  fxHistory: Record<string, Record<string, number>>,
): number | null {
  if (isEurCurrency(tx.currency)) return Math.round(tx.amount * 100);
  if (mode === "separate") return null;
  const eur = toEur(tx.amount, tx.currency, tx.date, fxHistory);
  return eur === null ? null : Math.round(eur * 100);
}

/**
 * One period's income statement.
 *
 * Pipeline: personal scope → drop rows the plan drops (own transfers, card
 * settlement pairs, owner-excluded and pending rows) → EUR cents → category
 * derivation → net refunds per category → split by the side each category nets
 * to. Income − spend is therefore the netted ledger, by construction.
 */
export function incomeStatement(input: ReportInput, period: ReportPeriod): IncomeStatement {
  const view = personalView(input.accounts, input.txs, input.entityProfiles);
  const personalOwn = scopedOwn(view.accounts, input.own);
  const dated = view.txs.filter(
    (t) =>
      isIsoDate(t.date) &&
      t.date >= period.from &&
      t.date <= period.to &&
      t.excluded !== true &&
      t.pending !== true,
  );
  const cleaned = cleanTxs(dated, view.accounts, input.rules, personalOwn);
  const cleanedRows = dated.length - cleaned.length;

  // category -> net in EUR cents, positive = spending (sign-normalized).
  const net = new Map<string, number>();
  let excludedForeignCount = 0;
  for (const tx of cleaned) {
    const cents = eurCents(tx, input.mode, input.fxHistory);
    if (cents === null) {
      excludedForeignCount += 1;
      continue;
    }
    const category = categorize(tx, input.rules, personalOwn);
    if (input.movedCategories.has(category)) continue;
    net.set(category, (net.get(category) ?? 0) - cents);
  }

  const rows: IncomeCategoryRow[] = [...net.entries()]
    .filter(([, netCents]) => netCents !== 0)
    .map(([category, netCents]) => ({
      category,
      incomeCents: netCents < 0 ? -netCents : 0,
      spendCents: netCents > 0 ? netCents : 0,
      netCents,
      side: netCents > 0 ? ("spend" as const) : ("income" as const),
    }));
  const incomeCategories = rows
    .filter((r) => r.side === "income")
    .sort((a, b) => b.incomeCents - a.incomeCents || a.category.localeCompare(b.category));
  const spendCategories = rows
    .filter((r) => r.side === "spend")
    .sort((a, b) => b.spendCents - a.spendCents || a.category.localeCompare(b.category));

  const incomeCents = incomeCategories.reduce((sum, r) => sum + r.incomeCents, 0);
  const spendCents = spendCategories.reduce((sum, r) => sum + r.spendCents, 0);
  const netSavingsCents = incomeCents - spendCents;
  const savingsRate = incomeCents > 0 ? netSavingsCents / incomeCents : null;

  const calc: CalcStep[] = [
    {
      id: "report-income-total",
      inputs: figureMap({
        categories: fig("count", incomeCategories.length),
        transactions: fig("count", cleaned.length - excludedForeignCount),
      }),
      output: fig("cents", incomeCents),
    },
    {
      id: "report-spend-total",
      inputs: figureMap({
        categories: fig("count", spendCategories.length),
        excluded_foreign: fig("count", excludedForeignCount),
      }),
      output: fig("cents", spendCents),
    },
    {
      id: "report-net-savings",
      inputs: figureMap({
        income: fig("cents", incomeCents),
        spend: fig("cents", spendCents),
      }),
      output: fig("cents", netSavingsCents),
    },
    {
      id: "report-savings-rate",
      inputs: figureMap({
        net_savings: fig("cents", netSavingsCents),
        income: fig("cents", incomeCents),
      }),
      output: fig("ratio", savingsRate),
    },
  ];

  return {
    period,
    currency: "EUR",
    incomeCents,
    spendCents,
    netSavingsCents,
    savingsRate,
    incomeCategories,
    spendCategories,
    transactionsCount: cleaned.length - excludedForeignCount,
    excludedForeignCount,
    cleanedRows,
    calc,
  };
}

/* ── Balance sheet ────────────────────────────────────────────────────────── */

export type BalanceSheetRow = {
  accountKey: string;
  name: string;
  type: string;
  kind: AccountTypeKind;
  classification: AccountClassification;
  /** NULL means the #291 series cannot reach this day: unknown, never zero. */
  balanceCents: number | null;
  /** The anchor the value rests on, and its age label. */
  anchor: { date: string; kind: "opening" | "current" | "reconciliation" } | null;
  valuation: "fresh" | "stale" | "unknown";
  /** True when the value is carried from an anchor older than the stale window. */
  stale: boolean;
};

export type BalanceSheetGroup = {
  kind: AccountTypeKind;
  accounts: BalanceSheetRow[];
  totalCents: number;
  knownCount: number;
  unknownCount: number;
};

export type BalanceSheet = {
  asOf: string;
  currency: string;
  assets: BalanceSheetGroup[];
  liabilities: BalanceSheetGroup[];
  /** Sum of the known asset balances; `null` when ANY included account is
   *  unknown, because a partial sum is not the assets total. */
  assetsCents: number | null;
  liabilitiesCents: number | null;
  /** `assets − liabilities`. NULL when a valuation is unknown: the sheet is a
   *  gap, not a zero. */
  equityCents: number | null;
  /** Partial sums, shown beside the gap and never presented as the total. */
  knownAssetsCents: number;
  knownLiabilitiesCents: number;
  /** Accounts the #291 series cannot value on `asOf`. */
  unknownAccounts: string[];
  /** The #291 daily series' own net worth on `asOf`; null on a gap. Used as an
   *  independent cross-check of `equityCents` in the tests. */
  netWorthCents: number | null;
  /** True when the sheet balances AND the series agrees. Null on a gap. */
  balanced: boolean | null;
  calc: CalcStep[];
};

const ASSET_ORDER: AccountTypeKind[] = [
  "current",
  "savings",
  "investment",
  "property",
  "vehicle",
  "otherAsset",
  "other",
];
const LIABILITY_ORDER: AccountTypeKind[] = ["credit", "loan", "otherLiability"];

/** Group totals. An asset group sums its balances; a liability group sums the
 *  amount OWED as a positive, the way Sure's balance sheet reports it and the
 *  way Rekeningen already shows a debt. A row keeps the vault's signed balance;
 *  only the group/total presentation flips it. */
function groupRows(
  rows: BalanceSheetRow[],
  order: AccountTypeKind[],
  side: AccountClassification,
): BalanceSheetGroup[] {
  const sign = side === "liability" ? -1 : 1;
  return order
    .map((kind) => {
      const accounts = rows
        .filter((r) => r.kind === kind)
        .sort((a, b) => a.name.localeCompare(b.name) || a.accountKey.localeCompare(b.accountKey));
      const known = accounts.filter((a) => a.balanceCents != null);
      return {
        kind,
        accounts,
        totalCents: known.reduce((sum, a) => sum + sign * (a.balanceCents ?? 0), 0),
        knownCount: known.length,
        unknownCount: accounts.length - known.length,
      };
    })
    .filter((group) => group.accounts.length > 0);
}

/**
 * The statement of assets, liabilities and equity on `asOf`.
 *
 * Every account's value comes from the #291 balance series, so a valuation is a
 * hard reset here too and an account with no anchor is a GAP. Equity is
 * `assets − liabilities`; when any account is unknown, equity is null rather
 * than a partial number, and the unknown keys are named.
 */
export function balanceSheet(input: ReportInput, asOf: string = input.asOf): BalanceSheet {
  // The plan's balance sheet is the PERSONAL one, the same scope the income
  // statement and every plan section use: a business account's value belongs to
  // the entity's own statement, not this household sheet.
  const personal = personalView(input.accounts, [], input.entityProfiles).accounts;
  const included = personal.filter((a) => isEurCurrency(a.currency));
  const rows: BalanceSheetRow[] = included.map((account) => {
    const point = accountBalanceSeries({
      account,
      txs: input.txs,
      valuations: input.valuations,
      from: asOf,
      to: asOf,
      asOf,
    })[0];
    const anchors = accountAnchors(account, input.valuations, asOf);
    const latest = anchors[anchors.length - 1] ?? null;
    const status = valuationStatus(account, input.valuations, asOf);
    return {
      accountKey: account.key,
      name: account.name || account.key,
      type: String(account.type ?? ""),
      kind: accountTypeKind(account),
      classification: accountClassification(account),
      balanceCents: point?.balanceCents ?? null,
      anchor: latest == null ? null : { date: latest.date, kind: latest.kind },
      valuation: status.kind,
      stale: status.kind === "stale",
    };
  });

  const assetRows = rows.filter((r) => r.classification === "asset");
  const liabilityRows = rows.filter((r) => r.classification === "liability");
  const unknownAccounts = rows.filter((r) => r.balanceCents == null).map((r) => r.accountKey);

  const assets = groupRows(assetRows, ASSET_ORDER, "asset");
  const liabilities = groupRows(liabilityRows, LIABILITY_ORDER, "liability");
  const knownAssetsCents = assetRows.reduce((sum, r) => sum + (r.balanceCents ?? 0), 0);
  // Liabilities report as the amount owed, positive, like Sure's BalanceSheet.
  // A stored liability balance is negative, so the signed sum is subtracted.
  const knownLiabilitiesCents = -liabilityRows.reduce((sum, r) => sum + (r.balanceCents ?? 0), 0);
  const gap = unknownAccounts.length > 0;
  const assetsCents = gap ? null : knownAssetsCents;
  const liabilitiesCents = gap ? null : knownLiabilitiesCents;
  // Sure's `net_worth = assets.total - liabilities.total`, with both totals
  // positive; in LaVega's signed ledger this is assets + signed liabilities.
  const equityCents = gap ? null : knownAssetsCents - knownLiabilitiesCents;

  // Independent cross-check: the #291 net-worth day for the same date. The
  // series sums signed balances, so assets − liabilities equals its total.
  const series = netWorthSeries({
    accounts: personal,
    txs: input.txs,
    valuations: input.valuations,
    from: asOf,
    to: asOf,
    asOf,
  });
  const netWorthCents = series.days[0]?.totalCents ?? null;
  const balanced =
    equityCents == null || netWorthCents == null ? null : equityCents === netWorthCents;

  const calc: CalcStep[] = [
    {
      id: "report-assets-total",
      inputs: figureMap({
        accounts: fig("count", assetRows.filter((r) => r.balanceCents != null).length),
        ...Object.fromEntries(
          assets.map((g) => [
            `asset_${g.kind}`.replace(/[^a-z0-9]+/gi, "_").toLowerCase(),
            fig("cents", g.totalCents),
          ]),
        ),
      }),
      output: fig("cents", assetsCents),
    },
    {
      id: "report-liabilities-total",
      inputs: figureMap({
        accounts: fig("count", liabilityRows.filter((r) => r.balanceCents != null).length),
        ...Object.fromEntries(
          liabilities.map((g) => [
            `liability_${g.kind}`.replace(/[^a-z0-9]+/gi, "_").toLowerCase(),
            fig("cents", g.totalCents),
          ]),
        ),
      }),
      output: fig("cents", liabilitiesCents),
    },
    {
      id: "report-equity",
      inputs: figureMap({
        assets: fig("cents", assetsCents),
        liabilities: fig("cents", liabilitiesCents),
      }),
      output: fig("cents", equityCents),
    },
    {
      id: "report-net-worth-series",
      inputs: figureMap({
        unknown_accounts: fig("count", unknownAccounts.length),
        // The two figures are computed independently; equality is the balance
        // check, and a mismatch is visible here rather than hidden.
        series_net_worth: fig("cents", netWorthCents),
      }),
      output: fig("cents", equityCents),
    },
  ];

  return {
    asOf,
    currency: "EUR",
    assets,
    liabilities,
    assetsCents,
    liabilitiesCents,
    equityCents,
    knownAssetsCents,
    knownLiabilitiesCents,
    unknownAccounts,
    netWorthCents,
    balanced,
    calc,
  };
}

/* ── The pair the app shows ──────────────────────────────────────────────── */

export type Reports = {
  balanceSheet: BalanceSheet;
  /** Newest first: the month in progress (partial) and the two previous full
   *  months, so "per period" is visible without a second call. */
  incomeStatements: IncomeStatement[];
};

/** How many calendar months the pair carries: asOf's month plus two before it. */
export const REPORT_PERIOD_COUNT = 3;

export function computeReports(input: ReportInput): Reports {
  const months = previousMonths(input.asOf, REPORT_PERIOD_COUNT);
  return {
    balanceSheet: balanceSheet(input, input.asOf),
    incomeStatements: months.map((month) =>
      incomeStatement(input, reportMonthPeriod(month, input.asOf)),
    ),
  };
}

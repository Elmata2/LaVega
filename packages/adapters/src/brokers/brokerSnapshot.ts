import { carryForwardCostBasis } from "@lavega/core";
import type {
  BrokerId,
  CashBalance,
  CashFlow,
  CashHistoryCoverage,
  Dividend,
  Position,
  Trade,
} from "@lavega/core";
import { isBrokerId } from "@lavega/core";
import type { BrokerResult } from "./BrokerAccessAdapter.js";

/* What a broker knows about an account, as this runtime keeps it.
 *
 * The shape and the rules for updating it belong together: a sync delivers
 * sections that are complete, partial or unavailable, and only a complete one
 * may replace what is stored. An unavailable holdings section leaves the last
 * good holdings in place, while a complete and empty one clears them, because
 * selling the last position is a real answer and a failed read is not. Each
 * section is judged on its own, so paused order-history pagination no longer
 * holds back holdings that were read successfully.
 *
 * Cash-history coverage travels with the cash it describes. A sync that read
 * any cash section replaces it, with unknown when the adapter proved nothing;
 * a sync that read no cash leaves the stored cash and its proof together.
 * Snapshots written before coverage existed restore as unknown.
 */
export type BrokerAccountSnapshot = {
  positions: Position[];
  trades: Trade[];
  dividends: Dividend[];
  cashBalances?: CashBalance[];
  cashFlows?: CashFlow[];
  cashHistory?: CashHistoryCoverage;
  /** Which files produced this snapshot, and when. The raw file is never
   *  stored; a later read compares an import's age and provenance from this. */
  lastImport?: {
    importedAt: string;
    files: { filename: string; sha256: string }[];
  };
};
export type BrokerDataSnapshot = Partial<Record<BrokerId, BrokerAccountSnapshot>>;

/** One broker's result as the cache applies it. A file import applies its
 *  result here too, so the broker is any id the table declares, not only a
 *  scheduled one. */
type AppliedOutcome = {
  broker: BrokerId;
  status: "synced" | "skipped" | "problem";
  lastSyncedAt: string | null;
  result: BrokerResult | null;
  lastImport?: BrokerAccountSnapshot["lastImport"];
};

function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  const byId = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()];
}

function withBroker<T extends { broker?: string }>(broker: string, rows: readonly T[]): T[] {
  return rows.map((row) => (row.broker ? row : { ...row, broker }));
}

const CURRENCY_CODES = new Set(
  "EUR USD GBP CHF JPY CAD AUD NZD SEK NOK DKK HKD SGD PLN CZK HUF CNH CNY MXN ZAR ILS TRY".split(
    " ",
  ),
);

function isStaleCurrencyPair(broker: string, symbol: string): boolean {
  if (broker !== "ibkr") return false;
  const match = /^([A-Z]{3})\.([A-Z]{3})$/.exec(symbol);
  return match !== null && CURRENCY_CODES.has(match[1]!) && CURRENCY_CODES.has(match[2]!);
}

type Period = { from: string; to: string };

function inPeriod(row: { date: string }, period: Period): boolean {
  const day = row.date.slice(0, 10);
  return day >= period.from && day <= period.to;
}

/* IBKR Flex statements each cover a fixed period, and a DeGiro account or
 * transaction export covers the span of its own rows. A complete section
 * replaces the stored rows inside that period and keeps the rest, so an older
 * window adds history and a re-read drops what the broker no longer reports.
 * Cash flow and dividend ids are content hashes, so distinct identical lines
 * must never be merged by id. */
function windowPeriod(
  broker: string,
  status: string,
  period: Period | undefined,
): Period | undefined {
  return (broker === "ibkr" || broker === "degiro") && status === "complete" ? period : undefined;
}

/* Drops the stored rows a window re-reads: those dated inside it for the
 * statement's accounts, and any with an id an incoming row carries, which are
 * the same row seen from the neighbouring window. Incoming rows are all kept,
 * so identical distinct lines never collapse. A row with no account belongs
 * to the statement; a row of an account the statement lacks is not its to drop. */
function replaceWindow<T extends { id: string; date: string; account?: string }>(
  existing: readonly T[],
  incoming: readonly T[],
  period: Period,
  accounts: readonly string[] | undefined,
): T[] {
  const incomingIds = new Set(incoming.map((row) => row.id));
  const inScope = (row: T) => !row.account || !accounts || accounts.includes(row.account);
  return [
    ...existing.filter(
      (row) => !(inScope(row) && inPeriod(row, period)) && !incomingIds.has(row.id),
    ),
    ...incoming,
  ];
}

function addDays(day: string, days: number): string {
  const moved = new Date(`${day}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

/* The latest state the cache holds, from every source that dates it. The
 * newest of them wins: any evidence of a later state makes an older statement
 * a backfill, and a missing source (no positions, unknown coverage) must not
 * hide the others. Dates after today are ignored: one bad future-dated row
 * must not freeze positions and cash against every later sync. */
function latestStoredDate(
  positions: readonly Position[] | undefined,
  cashBalances: readonly CashBalance[] | undefined,
  coverage: CashHistoryCoverage | undefined,
): string | undefined {
  const today = new Date().toISOString().slice(0, 10);
  const dates = [
    ...(positions ?? []).map((position) => position.asOf.slice(0, 10)),
    ...(cashBalances ?? []).map((balance) => balance.asOf.slice(0, 10)),
    ...(coverage?.status === "complete" ? [coverage.to] : []),
  ].filter((day) => day <= today);
  return dates.reduce<string | undefined>((a, b) => (a !== undefined && a >= b ? a : b), undefined);
}

/* The newest date the rows state. A DeGiro portfolio export carries its date on
 * every position and cash row instead of naming a period, so comparing it with
 * the stored rows keeps an older export from moving holdings and cash
 * backwards. */
function latestDay(rows: readonly { asOf: string }[] | undefined): string | undefined {
  let latest: string | undefined;
  for (const row of rows ?? []) {
    const day = row.asOf.slice(0, 10);
    if (latest === undefined || day > latest) latest = day;
  }
  return latest;
}

/* Coverage only ever grows by union with what the stored proof already
 * spans. A backfill, or a stale portfolio that proves no coverage, keeps the
 * stored end; a forward sync takes the incoming end. Anything that touches or
 * overlaps the stored span is joined to it, so a normal sync after a backfill
 * cannot shrink the coverage; across a gap the stored span cannot vouch for
 * the days between, so a forward sync replaces it and a backfill leaves it
 * alone. */
function mergedCoverage(
  stored: CashHistoryCoverage | undefined,
  incoming: CashHistoryCoverage,
  backfill: boolean,
): CashHistoryCoverage | undefined {
  /* Unknown proves nothing, so a complete incoming window always replaces it.
   * A backfill rule must not keep a stored unknown coverage over an older but
   * proven window: the DeGiro account statement often ends before the portfolio
   * export's date, which would otherwise discard the only proof the import has. */
  if (stored?.status !== "complete") return incoming;
  if (incoming.status !== "complete") return backfill ? stored : incoming;
  const touches = incoming.from <= addDays(stored.to, 1) && incoming.to >= addDays(stored.from, -1);
  if (!touches) return backfill ? stored : incoming;
  const from = incoming.from < stored.from ? incoming.from : stored.from;
  const { quantityProvenFrom: storedProof, ...storedRest } = stored;
  const { quantityProvenFrom: incomingProof, ...incomingRest } = incoming;
  const proof = mergedProof(storedProof, incomingProof, stored.to, incoming.to, backfill);
  const base = backfill ? storedRest : incomingRest;
  return { ...base, from, ...(proof ? { quantityProvenFrom: proof } : {}) };
}

/* The proven-quantity start is one date, not a flag, so a plain forward sync
 * cannot erase it. The proven span is [proof, merged end]; it must stay
 * gapless to that end.
 *  - both proven: the earlier start, but only if the proven spans join. A
 *    backfill must reach the stored proof start; a forward sync must start its
 *    proof no later than the day after the stored end. Otherwise the days
 *    between are unproven, so a backfill keeps the stored proof and a forward
 *    sync takes the incoming start;
 *  - only incoming proven: its start, but a backfill ends before the stored
 *    span's unproven tail, so a backfill can only extend an existing proof;
 *  - only stored proven: a backfill leaves it untouched; a forward sync keeps
 *    it only if the new end is still inside the proven span, otherwise the
 *    unproven days up to the new end would be vouched for. */
function mergedProof(
  stored: string | undefined,
  incoming: string | undefined,
  storedTo: string,
  incomingTo: string,
  backfill: boolean,
): string | undefined {
  if (stored && incoming) {
    const joined = backfill ? incomingTo >= addDays(stored, -1) : incoming <= addDays(storedTo, 1);
    if (joined) return stored < incoming ? stored : incoming;
    return backfill ? stored : incoming;
  }
  if (incoming) return backfill ? undefined : incoming;
  if (stored) return backfill || incomingTo <= storedTo ? stored : undefined;
  return undefined;
}

function replacesAll(broker: string, historyMode: string | undefined): boolean {
  return broker !== "ibkr" && historyMode !== "incremental";
}

function replacesCollection(
  broker: string,
  result: BrokerResult,
  stream: "orders" | "transactions" | "dividends",
  status: "complete" | "partial" | "unavailable",
): boolean {
  if (status !== "complete") return false;
  // A result that names the streams it read in full replaces only those; every
  // other collection was a tail (or not requested) and must merge by id.
  if (result.fullStreams !== undefined) return result.fullStreams.includes(stream);
  return replacesAll(broker, result.historyMode);
}

function restoreTrades(broker: string, trades: readonly Trade[]): Trade[] {
  return withBroker(
    broker,
    trades.filter((trade) => !isStaleCurrencyPair(broker, trade.symbol)),
  ).map((trade) =>
    (trade.side === "buy" || trade.side === "sell") &&
    Number.isFinite(trade.quantity) &&
    trade.quantity !== 0
      ? { ...trade, quantity: Math.abs(trade.quantity) }
      : trade,
  );
}

function restorePositions(broker: string, positions: readonly Position[]): Position[] {
  return withBroker(
    broker,
    positions.filter((position) => !isStaleCurrencyPair(broker, position.symbol)),
  ).map((position) =>
    position.brokerCost
      ? position
      : {
          ...position,
          brokerCost: { status: "unknown", reason: "legacy-denomination" },
        },
  );
}

export function stableTradeId(trade: Omit<Trade, "id">): string {
  if (trade.brokerTradeId) return trade.brokerTradeId;
  let value = 2166136261;
  for (const character of JSON.stringify(trade)) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return `anonymous-${value >>> 0}`;
}

/**
 * Snapshot ids for one broker's incoming trades. A broker trade id is unique
 * per order, not per execution: DeGiro gives every partial fill of one order
 * the same Order Id. Returning that id as the row id would collapse the fills
 * on a merge and lose executions. The first row keeps the bare id, so existing
 * stored trades keep their id; later rows with the same base id get an
 * occurrence suffix. Incoming order is the file order, and an appended older
 * window only adds rows after the ones already seen, so the suffix is stable
 * across overlapping re-imports.
 */
export function brokerTradeRowIds(broker: string, trades: readonly Omit<Trade, "id">[]): string[] {
  const seen = new Map<string, number>();
  return trades.map((trade) => {
    const base = `${broker}:${stableTradeId(trade)}`;
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    return occurrence === 1 ? base : `${base}#${occurrence}`;
  });
}

export function createBrokerDataCache(initial: BrokerDataSnapshot = {}) {
  const positionsByBroker = new Map<string, Position[]>();
  const tradesByBroker = new Map<string, Trade[]>();
  const dividendsByBroker = new Map<string, Dividend[]>();
  const cashBalancesByBroker = new Map<string, CashBalance[]>();
  const cashFlowsByBroker = new Map<string, CashFlow[]>();
  const cashHistoryByBroker = new Map<string, CashHistoryCoverage>();
  const lastImportByBroker = new Map<string, NonNullable<BrokerAccountSnapshot["lastImport"]>>();
  let problems: string[] = [];
  let dataVersion = 0;

  const restore = (snapshot: BrokerDataSnapshot) => {
    positionsByBroker.clear();
    tradesByBroker.clear();
    dividendsByBroker.clear();
    cashBalancesByBroker.clear();
    cashFlowsByBroker.clear();
    cashHistoryByBroker.clear();
    lastImportByBroker.clear();
    for (const [broker, data] of Object.entries(snapshot)) {
      if (!data) continue;
      positionsByBroker.set(broker, structuredClone(restorePositions(broker, data.positions)));
      tradesByBroker.set(broker, structuredClone(restoreTrades(broker, data.trades)));
      dividendsByBroker.set(broker, structuredClone(withBroker(broker, data.dividends ?? [])));
      cashBalancesByBroker.set(
        broker,
        structuredClone(withBroker(broker, data.cashBalances ?? [])),
      );
      cashFlowsByBroker.set(broker, structuredClone(withBroker(broker, data.cashFlows ?? [])));
      if (data.cashHistory) cashHistoryByBroker.set(broker, structuredClone(data.cashHistory));
      if (data.lastImport) lastImportByBroker.set(broker, structuredClone(data.lastImport));
    }
    dataVersion += 1;
  };
  restore(initial);

  return {
    apply(result: { outcomes: readonly AppliedOutcome[]; problems: string[] }) {
      // Stage every broker's merged sections before mutating the live maps so a
      // thrown error mid-apply cannot leave the cache half-updated.
      const stagedPositions = new Map<string, Position[]>();
      const stagedTrades = new Map<string, Trade[]>();
      const stagedDividends = new Map<string, Dividend[]>();
      const stagedCashBalances = new Map<string, CashBalance[]>();
      const stagedCashFlows = new Map<string, CashFlow[]>();
      const stagedCashHistory = new Map<string, CashHistoryCoverage | undefined>();
      const stagedLastImport = new Map<string, NonNullable<BrokerAccountSnapshot["lastImport"]>>();

      const currentPositions = (broker: string) =>
        stagedPositions.has(broker) ? stagedPositions.get(broker) : positionsByBroker.get(broker);
      const currentTrades = (broker: string) =>
        stagedTrades.has(broker) ? stagedTrades.get(broker) : tradesByBroker.get(broker);
      const currentDividends = (broker: string) =>
        stagedDividends.has(broker) ? stagedDividends.get(broker) : dividendsByBroker.get(broker);
      const currentCashBalances = (broker: string) =>
        stagedCashBalances.has(broker)
          ? stagedCashBalances.get(broker)
          : cashBalancesByBroker.get(broker);
      const currentCashFlows = (broker: string) =>
        stagedCashFlows.has(broker) ? stagedCashFlows.get(broker) : cashFlowsByBroker.get(broker);
      const currentCashHistory = (broker: string) =>
        stagedCashHistory.has(broker)
          ? stagedCashHistory.get(broker)
          : cashHistoryByBroker.get(broker);

      let appliedAny = false;
      for (const outcome of result.outcomes) {
        // Partial results with problems still carry fresh broker data; discarding
        // them left the vault stale while the UI showed only the problem.
        if (outcome.result === null) continue;
        appliedAny = true;
        const incoming = outcome.result;
        const sections = incoming.sections;
        const storedLatest = latestStoredDate(
          currentPositions(outcome.broker),
          currentCashBalances(outcome.broker),
          currentCashHistory(outcome.broker),
        );
        const statementEnd = incoming.statementTo ?? incoming.period?.to;
        /* A merged DeGiro import can carry an older account window and a newer
         * portfolio. The later date is what the import proves; using only the
         * statement period would classify the whole import as a backfill and
         * leave the newer holdings unapplied. */
        const incomingPositionDay = latestDay(sections.positions.rows);
        const importEnd =
          statementEnd !== undefined && incomingPositionDay !== undefined
            ? incomingPositionDay > statementEnd
              ? incomingPositionDay
              : statementEnd
            : (statementEnd ?? incomingPositionDay);
        const backfill =
          (outcome.broker === "ibkr" || outcome.broker === "degiro") &&
          importEnd !== undefined &&
          storedLatest !== undefined &&
          importEnd < storedLatest;
        /* DeGiro dates a portfolio export on its rows rather than naming a
         * period. Older holdings are a backfill: they must not move the
         * positions, the cash row or the stored coverage backwards. */
        const today = new Date().toISOString().slice(0, 10);
        const storedPositionDay = latestDay(currentPositions(outcome.broker));
        const stalePortfolio =
          outcome.broker === "degiro" &&
          incomingPositionDay !== undefined &&
          storedPositionDay !== undefined &&
          storedPositionDay <= today &&
          incomingPositionDay < storedPositionDay;
        if (sections.positions.status === "complete" && !backfill && !stalePortfolio) {
          // A provider sync has no authority over a user-entered basis and its
          // lock, and an unchanged row may carry a basis forward (WS4.2).
          const stored = currentPositions(outcome.broker) ?? [];
          stagedPositions.set(
            outcome.broker,
            carryForwardCostBasis(
              stored,
              restorePositions(outcome.broker, sections.positions.rows),
            ),
          );
        }
        const tradeIds = brokerTradeRowIds(outcome.broker, sections.trades.rows);
        const mappedTrades = sections.trades.rows.map((trade, index) => ({
          ...withBroker(outcome.broker, [trade])[0],
          id: tradeIds[index]!,
        }));
        const tradeWindow = windowPeriod(outcome.broker, sections.trades.status, incoming.period);
        if (tradeWindow)
          stagedTrades.set(
            outcome.broker,
            restoreTrades(
              outcome.broker,
              replaceWindow(
                currentTrades(outcome.broker) ?? [],
                mappedTrades,
                tradeWindow,
                incoming.accounts,
              ),
            ),
          );
        else if (replacesCollection(outcome.broker, incoming, "orders", sections.trades.status))
          stagedTrades.set(outcome.broker, mappedTrades);
        else if (sections.trades.status !== "unavailable" && mappedTrades.length > 0)
          stagedTrades.set(
            outcome.broker,
            restoreTrades(
              outcome.broker,
              mergeById(currentTrades(outcome.broker) ?? [], mappedTrades),
            ),
          );
        const incomingDividends = withBroker(outcome.broker, sections.dividends.rows);
        const dividendWindow = windowPeriod(
          outcome.broker,
          sections.dividends.status,
          incoming.period,
        );
        if (dividendWindow)
          stagedDividends.set(
            outcome.broker,
            replaceWindow(
              currentDividends(outcome.broker) ?? [],
              incomingDividends,
              dividendWindow,
              incoming.accounts,
            ),
          );
        else if (
          replacesCollection(outcome.broker, incoming, "dividends", sections.dividends.status)
        )
          stagedDividends.set(outcome.broker, incomingDividends);
        else if (sections.dividends.status !== "unavailable" && incomingDividends.length > 0)
          stagedDividends.set(
            outcome.broker,
            mergeById(currentDividends(outcome.broker) ?? [], incomingDividends),
          );
        if (sections.cashBalances.status === "complete" && !backfill && !stalePortfolio)
          stagedCashBalances.set(
            outcome.broker,
            withBroker(outcome.broker, sections.cashBalances.rows),
          );
        const incomingFlows = withBroker(outcome.broker, sections.cashFlows.rows);
        const flowWindow = windowPeriod(outcome.broker, sections.cashFlows.status, incoming.period);
        if (flowWindow)
          stagedCashFlows.set(
            outcome.broker,
            replaceWindow(
              currentCashFlows(outcome.broker) ?? [],
              incomingFlows,
              flowWindow,
              incoming.accounts,
            ),
          );
        else if (
          replacesCollection(outcome.broker, incoming, "transactions", sections.cashFlows.status)
        )
          stagedCashFlows.set(outcome.broker, incomingFlows);
        else if (sections.cashFlows.status !== "unavailable" && incomingFlows.length > 0)
          stagedCashFlows.set(
            outcome.broker,
            mergeById(currentCashFlows(outcome.broker) ?? [], incomingFlows),
          );
        const readCash = [sections.cashBalances, sections.cashFlows, sections.dividends].some(
          (section) => section.status !== "unavailable",
        );
        if (incoming.cashHistory) {
          const merged = mergedCoverage(
            currentCashHistory(outcome.broker),
            incoming.cashHistory,
            backfill || stalePortfolio,
          );
          if (merged) stagedCashHistory.set(outcome.broker, merged);
        } else if (!backfill && readCash) stagedCashHistory.set(outcome.broker, undefined);
        if (outcome.lastImport) {
          stagedLastImport.set(outcome.broker, structuredClone(outcome.lastImport));
        }
      }

      // Commit staged updates atomically.
      for (const [broker, rows] of stagedPositions) positionsByBroker.set(broker, rows);
      for (const [broker, rows] of stagedTrades) tradesByBroker.set(broker, rows);
      for (const [broker, rows] of stagedDividends) dividendsByBroker.set(broker, rows);
      for (const [broker, rows] of stagedCashBalances) cashBalancesByBroker.set(broker, rows);
      for (const [broker, rows] of stagedCashFlows) cashFlowsByBroker.set(broker, rows);
      for (const [broker, coverage] of stagedCashHistory) {
        if (coverage === undefined) cashHistoryByBroker.delete(broker);
        else cashHistoryByBroker.set(broker, coverage);
      }
      for (const [broker, lastImport] of stagedLastImport) {
        lastImportByBroker.set(broker, lastImport);
      }
      problems = [...result.problems];
      if (appliedAny) dataVersion += 1;
    },
    read() {
      return {
        positions: [...positionsByBroker.values()].flat(),
        trades: [...tradesByBroker.values()].flat(),
        dividends: [...dividendsByBroker.values()].flat(),
        cashBalances: [...cashBalancesByBroker.values()].flat(),
        cashFlows: [...cashFlowsByBroker.values()].flat(),
        cashCoverage: [...cashHistoryByBroker.values()],
        /* Provenance only, as a fresh map so the cache's own map stays private.
         * The full snapshot() clones every row; the dashboard read needs only
         * this map to publish the DeGiro import age (D13, #325). */
        lastImports: Object.fromEntries(lastImportByBroker) as Partial<
          Record<BrokerId, NonNullable<BrokerAccountSnapshot["lastImport"]>>
        >,
        problems: [...problems],
        dataVersion,
      };
    },
    restore,
    snapshot(): BrokerDataSnapshot {
      const snapshot: BrokerDataSnapshot = {};
      for (const broker of new Set([
        ...positionsByBroker.keys(),
        ...tradesByBroker.keys(),
        ...dividendsByBroker.keys(),
        ...cashBalancesByBroker.keys(),
        ...cashFlowsByBroker.keys(),
        ...lastImportByBroker.keys(),
      ])) {
        if (!isBrokerId(broker)) continue;
        snapshot[broker] = {
          positions: structuredClone(positionsByBroker.get(broker) ?? []),
          trades: structuredClone(tradesByBroker.get(broker) ?? []),
          dividends: structuredClone(dividendsByBroker.get(broker) ?? []),
          cashBalances: structuredClone(cashBalancesByBroker.get(broker) ?? []),
          cashFlows: structuredClone(cashFlowsByBroker.get(broker) ?? []),
          ...(cashHistoryByBroker.has(broker)
            ? { cashHistory: structuredClone(cashHistoryByBroker.get(broker)!) }
            : {}),
          ...(lastImportByBroker.has(broker)
            ? { lastImport: structuredClone(lastImportByBroker.get(broker)!) }
            : {}),
        };
      }
      return snapshot;
    },
  };
}

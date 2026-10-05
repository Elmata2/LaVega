import type {
  CashBalance,
  CashFlow,
  CashHistoryCoverage,
  Dividend,
  Position,
  Trade,
} from "@lavega/core";
import type { ScheduledSyncResult } from "./scheduledSync.js";

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
};
export type BrokerDataSnapshot = Partial<Record<"ibkr" | "trading212", BrokerAccountSnapshot>>;

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

/* IBKR Flex statements each cover a fixed period. A complete section replaces
 * the stored rows inside that period and keeps the rest, so an older window
 * adds history and a re-read drops what the broker no longer reports. Cash
 * flow and dividend ids are content hashes, so distinct identical lines must
 * never be merged by id. */
function windowPeriod(
  broker: string,
  status: string,
  period: Period | undefined,
): Period | undefined {
  return broker === "ibkr" && status === "complete" ? period : undefined;
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

/* Coverage only ever grows by union with what the stored proof already
 * spans. A backfill keeps the stored end; a forward sync takes the incoming
 * end. Anything that touches or overlaps the stored span is joined to it, so
 * a normal sync after a backfill cannot shrink the coverage; across a gap the
 * stored span cannot vouch for the days between, so a forward sync replaces
 * it and a backfill leaves it alone. */
function mergedCoverage(
  stored: CashHistoryCoverage | undefined,
  incoming: CashHistoryCoverage,
  backfill: boolean,
): CashHistoryCoverage | undefined {
  if (stored?.status !== "complete" || incoming.status !== "complete")
    return backfill ? stored : incoming;
  const touches = incoming.from <= addDays(stored.to, 1) && incoming.to >= addDays(stored.from, -1);
  if (!touches) return backfill ? stored : incoming;
  const from = incoming.from < stored.from ? incoming.from : stored.from;
  return backfill ? { ...stored, from } : { ...incoming, from };
}

function replacesAll(broker: string, historyMode: string | undefined): boolean {
  return broker !== "ibkr" && historyMode !== "incremental";
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

function stableTradeId(trade: Omit<Trade, "id">): string {
  if (trade.brokerTradeId) return trade.brokerTradeId;
  let value = 2166136261;
  for (const character of JSON.stringify(trade)) {
    value ^= character.charCodeAt(0);
    value = Math.imul(value, 16777619);
  }
  return `anonymous-${value >>> 0}`;
}

export function createBrokerDataCache(initial: BrokerDataSnapshot = {}) {
  const positionsByBroker = new Map<string, Position[]>();
  const tradesByBroker = new Map<string, Trade[]>();
  const dividendsByBroker = new Map<string, Dividend[]>();
  const cashBalancesByBroker = new Map<string, CashBalance[]>();
  const cashFlowsByBroker = new Map<string, CashFlow[]>();
  const cashHistoryByBroker = new Map<string, CashHistoryCoverage>();
  let problems: string[] = [];
  let dataVersion = 0;

  const restore = (snapshot: BrokerDataSnapshot) => {
    positionsByBroker.clear();
    tradesByBroker.clear();
    dividendsByBroker.clear();
    cashBalancesByBroker.clear();
    cashFlowsByBroker.clear();
    cashHistoryByBroker.clear();
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
    }
    dataVersion += 1;
  };
  restore(initial);

  return {
    apply(result: Pick<ScheduledSyncResult, "outcomes" | "problems">) {
      for (const outcome of result.outcomes) {
        // Partial results with problems still carry fresh broker data; discarding
        // them left the vault stale while the UI showed only the problem.
        if (outcome.result === null) continue;
        const incoming = outcome.result;
        const sections = incoming.sections;
        const storedLatest = latestStoredDate(
          positionsByBroker.get(outcome.broker),
          cashBalancesByBroker.get(outcome.broker),
          cashHistoryByBroker.get(outcome.broker),
        );
        const statementEnd = incoming.statementTo ?? incoming.period?.to;
        const backfill =
          outcome.broker === "ibkr" &&
          statementEnd !== undefined &&
          storedLatest !== undefined &&
          statementEnd < storedLatest;
        if (sections.positions.status === "complete" && !backfill)
          positionsByBroker.set(
            outcome.broker,
            restorePositions(outcome.broker, sections.positions.rows),
          );
        const mappedTrades = sections.trades.rows.map((trade) => ({
          ...withBroker(outcome.broker, [trade])[0],
          id: `${outcome.broker}:${stableTradeId(trade)}`,
        }));
        const tradeWindow = windowPeriod(outcome.broker, sections.trades.status, incoming.period);
        if (tradeWindow)
          tradesByBroker.set(
            outcome.broker,
            restoreTrades(
              outcome.broker,
              replaceWindow(
                tradesByBroker.get(outcome.broker) ?? [],
                mappedTrades,
                tradeWindow,
                incoming.accounts,
              ),
            ),
          );
        else if (
          sections.trades.status === "complete" &&
          replacesAll(outcome.broker, incoming.historyMode)
        )
          tradesByBroker.set(outcome.broker, mappedTrades);
        else if (sections.trades.status !== "unavailable" && mappedTrades.length > 0)
          tradesByBroker.set(
            outcome.broker,
            restoreTrades(
              outcome.broker,
              mergeById(tradesByBroker.get(outcome.broker) ?? [], mappedTrades),
            ),
          );
        const incomingDividends = withBroker(outcome.broker, sections.dividends.rows);
        const dividendWindow = windowPeriod(
          outcome.broker,
          sections.dividends.status,
          incoming.period,
        );
        if (dividendWindow)
          dividendsByBroker.set(
            outcome.broker,
            replaceWindow(
              dividendsByBroker.get(outcome.broker) ?? [],
              incomingDividends,
              dividendWindow,
              incoming.accounts,
            ),
          );
        else if (sections.dividends.status === "complete" && incoming.historyMode !== "incremental")
          dividendsByBroker.set(outcome.broker, incomingDividends);
        else if (sections.dividends.status !== "unavailable" && incomingDividends.length > 0)
          dividendsByBroker.set(
            outcome.broker,
            mergeById(dividendsByBroker.get(outcome.broker) ?? [], incomingDividends),
          );
        if (sections.cashBalances.status === "complete" && !backfill)
          cashBalancesByBroker.set(
            outcome.broker,
            withBroker(outcome.broker, sections.cashBalances.rows),
          );
        const incomingFlows = withBroker(outcome.broker, sections.cashFlows.rows);
        const flowWindow = windowPeriod(outcome.broker, sections.cashFlows.status, incoming.period);
        if (flowWindow)
          cashFlowsByBroker.set(
            outcome.broker,
            replaceWindow(
              cashFlowsByBroker.get(outcome.broker) ?? [],
              incomingFlows,
              flowWindow,
              incoming.accounts,
            ),
          );
        else if (sections.cashFlows.status === "complete" && incoming.historyMode !== "incremental")
          cashFlowsByBroker.set(outcome.broker, incomingFlows);
        else if (sections.cashFlows.status !== "unavailable" && incomingFlows.length > 0)
          cashFlowsByBroker.set(
            outcome.broker,
            mergeById(cashFlowsByBroker.get(outcome.broker) ?? [], incomingFlows),
          );
        const readCash = [sections.cashBalances, sections.cashFlows, sections.dividends].some(
          (section) => section.status !== "unavailable",
        );
        if (incoming.cashHistory) {
          const merged = mergedCoverage(
            cashHistoryByBroker.get(outcome.broker),
            incoming.cashHistory,
            backfill,
          );
          if (merged) cashHistoryByBroker.set(outcome.broker, merged);
        } else if (!backfill && readCash) cashHistoryByBroker.delete(outcome.broker);
      }
      problems = result.problems;
      if (result.outcomes.some((outcome) => outcome.result !== null)) dataVersion += 1;
    },
    read() {
      return {
        positions: [...positionsByBroker.values()].flat(),
        trades: [...tradesByBroker.values()].flat(),
        dividends: [...dividendsByBroker.values()].flat(),
        cashBalances: [...cashBalancesByBroker.values()].flat(),
        cashFlows: [...cashFlowsByBroker.values()].flat(),
        cashCoverage: [...cashHistoryByBroker.values()],
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
      ])) {
        if (broker !== "ibkr" && broker !== "trading212") continue;
        snapshot[broker] = {
          positions: structuredClone(positionsByBroker.get(broker) ?? []),
          trades: structuredClone(tradesByBroker.get(broker) ?? []),
          dividends: structuredClone(dividendsByBroker.get(broker) ?? []),
          cashBalances: structuredClone(cashBalancesByBroker.get(broker) ?? []),
          cashFlows: structuredClone(cashFlowsByBroker.get(broker) ?? []),
          ...(cashHistoryByBroker.has(broker)
            ? { cashHistory: structuredClone(cashHistoryByBroker.get(broker)!) }
            : {}),
        };
      }
      return snapshot;
    },
  };
}

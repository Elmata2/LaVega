import type { CashBalance, CashFlow, Dividend, Position, Trade } from "@lavega/core";
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
 */
export type BrokerAccountSnapshot = {
  positions: Position[];
  trades: Trade[];
  dividends: Dividend[];
  cashBalances?: CashBalance[];
  cashFlows?: CashFlow[];
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

function restoreTrades(broker: string, trades: readonly Trade[]): Trade[] {
  return withBroker(broker, trades).map((trade) =>
    (trade.side === "buy" || trade.side === "sell") &&
    Number.isFinite(trade.quantity) &&
    trade.quantity !== 0
      ? { ...trade, quantity: Math.abs(trade.quantity) }
      : trade,
  );
}

function restorePositions(broker: string, positions: readonly Position[]): Position[] {
  return withBroker(broker, positions).map((position) =>
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
  let problems: string[] = [];
  let dataVersion = 0;

  const restore = (snapshot: BrokerDataSnapshot) => {
    positionsByBroker.clear();
    tradesByBroker.clear();
    dividendsByBroker.clear();
    cashBalancesByBroker.clear();
    cashFlowsByBroker.clear();
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
        if (sections.positions.status === "complete")
          positionsByBroker.set(
            outcome.broker,
            restorePositions(outcome.broker, sections.positions.rows),
          );
        const mappedTrades = sections.trades.rows.map((trade) => ({
          ...withBroker(outcome.broker, [trade])[0],
          id: `${outcome.broker}:${stableTradeId(trade)}`,
        }));
        if (sections.trades.status === "complete" && incoming.historyMode !== "incremental")
          tradesByBroker.set(outcome.broker, mappedTrades);
        else if (sections.trades.status !== "unavailable" && mappedTrades.length > 0)
          tradesByBroker.set(
            outcome.broker,
            mergeById(tradesByBroker.get(outcome.broker) ?? [], mappedTrades),
          );
        const incomingDividends = sections.dividends.rows;
        if (sections.dividends.status === "complete" && incoming.historyMode !== "incremental")
          dividendsByBroker.set(outcome.broker, withBroker(outcome.broker, incomingDividends));
        else if (sections.dividends.status !== "unavailable" && incomingDividends.length > 0)
          dividendsByBroker.set(
            outcome.broker,
            mergeById(dividendsByBroker.get(outcome.broker) ?? [], incomingDividends),
          );
        if (sections.cashBalances.status === "complete")
          cashBalancesByBroker.set(
            outcome.broker,
            withBroker(outcome.broker, sections.cashBalances.rows),
          );
        const incomingFlows = sections.cashFlows.rows;
        if (sections.cashFlows.status === "complete" && incoming.historyMode !== "incremental")
          cashFlowsByBroker.set(outcome.broker, withBroker(outcome.broker, incomingFlows));
        else if (sections.cashFlows.status !== "unavailable" && incomingFlows.length > 0)
          cashFlowsByBroker.set(
            outcome.broker,
            mergeById(cashFlowsByBroker.get(outcome.broker) ?? [], incomingFlows),
          );
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
        };
      }
      return snapshot;
    },
  };
}

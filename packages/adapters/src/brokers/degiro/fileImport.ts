import {
  type BrokerFileInput,
  type BrokerFileSection,
  type CashBalance,
  type CashFlow,
  type CashHistoryCoverage,
  type Dividend,
  type Position,
  type TradeWithoutId,
  parseBrokerFiles,
} from "@lavega/core";
import {
  type BrokerResult,
  type BrokerSection,
  type BrokerSectionStatus,
} from "../BrokerAccessAdapter.js";

export type DeGiroFileImport = {
  load(input: {
    files: readonly BrokerFileInput[];
    entity: string;
    /** The portfolio export's date: that export carries no date column. */
    asOf?: string;
  }): Promise<BrokerResult>;
};

/**
 * DeGiro file import: one import can hold the account statement, the
 * transaction export and the portfolio export.
 *
 * The adapter stamps `entity` and `broker` on every row and adds the two facts
 * the parser cannot know: the result's `tradeCash` stream and, per section,
 * whether a parsed file read it at all. A section no file read is reported
 * `unavailable`, never `complete` with no rows: the snapshot merge would treat
 * an empty complete section as a broker that reported nothing and wipe the
 * rows already stored.
 */
export function createDeGiroFileImport(): DeGiroFileImport {
  return {
    async load({ files, entity, asOf }) {
      const parsed = parseBrokerFiles(files, { asOf });
      const status: BrokerSectionStatus = parsed.problems.length > 0 ? "partial" : "complete";
      const readSections = new Set<BrokerFileSection>(parsed.sections ?? []);

      const section = <T>(name: BrokerFileSection, rows: T[]): BrokerSection<T> =>
        readSections.has(name) ? { status, rows } : { status: "unavailable", rows: [] };

      const trades: TradeWithoutId[] = parsed.trades.map((trade) => ({
        ...trade,
        entity,
        broker: "degiro",
      }));
      const dividends: Dividend[] = (parsed.dividends ?? []).map((dividend) => ({
        ...dividend,
        entity,
        broker: "degiro",
      }));
      const cashBalances: CashBalance[] = (parsed.cashBalances ?? []).map((balance) => ({
        ...balance,
        entity,
        broker: "degiro",
      }));
      const cashFlows: CashFlow[] = (parsed.cashFlows ?? []).map((flow) => ({
        ...flow,
        entity,
      }));
      const cashHistory: CashHistoryCoverage | undefined = parsed.cashHistory
        ? { entity, broker: "degiro", tradeCash: "cash-flows", ...parsed.cashHistory }
        : undefined;
      const positions: Position[] = parsed.positions.map((position) => ({
        ...position,
        entity,
        broker: "degiro",
      }));

      return {
        sections: {
          positions: section("positions", positions),
          trades: section("trades", trades),
          dividends: section("dividends", dividends),
          cashBalances: section("cashBalances", cashBalances),
          cashFlows: section("cashFlows", cashFlows),
        },
        ...(cashHistory ? { cashHistory } : {}),
        ...(parsed.period ? { period: parsed.period } : {}),
        source: parsed.source,
        problems: parsed.problems,
      };
    },
  };
}

import {
  type CashBalance,
  type CashFlow,
  type CashHistoryCoverage,
  type Dividend,
  type Position,
  type TradeWithoutId,
  parseBrokerFile,
} from "@lavega/core";
import {
  type BrokerResult,
  type BrokerSection,
  type BrokerSectionStatus,
} from "../BrokerAccessAdapter.js";

export type DeGiroFileImport = {
  load(input: { filename: string; text: string; entity: string }): Promise<BrokerResult>;
};

/**
 * DeGiro file import: one `Account.csv` is a complete result.
 *
 * The adapter stamps `entity` and `broker` on every row and adds the two facts
 * the parser cannot know: the result's `tradeCash` stream and, per section,
 * whether the file read it at all. A section the file did not read is reported
 * `unavailable`, never `complete` with no rows: the snapshot merge would treat
 * an empty complete section as a broker that reported nothing and wipe the
 * rows already stored.
 */
export function createDeGiroFileImport(): DeGiroFileImport {
  return {
    async load({ filename, text, entity }) {
      const parsed = parseBrokerFile(filename, text);
      const status: BrokerSectionStatus = parsed.problems.length > 0 ? "partial" : "complete";
      // Only the account statement is mapped so far; the other profiles still
      // name themselves and read no rows.
      const mapped = parsed.profile === "account";

      const section = <T>(rows: T[]): BrokerSection<T> =>
        mapped ? { status, rows } : { status: "unavailable", rows: [] };

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

      return {
        sections: {
          /* The account statement carries no holdings. Reporting it `complete`
           * with no rows would wipe the stored positions on every import. */
          positions: { status: "unavailable", rows: [] as Position[] },
          trades: section(trades),
          dividends: section(dividends),
          cashBalances: section(cashBalances),
          cashFlows: section(cashFlows),
        },
        ...(cashHistory ? { cashHistory } : {}),
        ...(parsed.period ? { period: parsed.period } : {}),
        source: parsed.source,
        problems: parsed.problems,
      };
    },
  };
}

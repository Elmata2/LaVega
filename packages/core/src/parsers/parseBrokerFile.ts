import type { Dividend } from "../investing/dividend.js";
import type { CashBalance, CashFlow, Position, Trade } from "../investing/model.js";
import { type AccountCoverage, readDeGiroAccount } from "./degiro/accountProfile.js";
import { type DeGiroProfile, readDeGiroCsv } from "./degiro/profiles.js";

export type ParsedBrokerFile = {
  positions: Omit<Position, "entity" | "tenantId">[];
  trades: Omit<Trade, "entity" | "id">[];
  source: string;
  problems: string[];
  /** Which export the header matched; absent when the header is unknown. */
  profile?: DeGiroProfile;
  dividends?: Omit<Dividend, "entity">[];
  cashFlows?: Omit<CashFlow, "entity">[];
  cashBalances?: Omit<CashBalance, "entity" | "broker">[];
  cashHistory?: AccountCoverage;
  period?: { from: string; to: string };
};

/**
 * Broker-file detection, delegating to the DeGiro readers in `./degiro/`.
 *
 * The filename is accepted for API compatibility with the upload path and is
 * deliberately unused: a real DeGiro export arrives as `Account.csv`,
 * `Transactions (1).csv` or whatever the user renamed it to, so only the
 * header may decide the profile.
 *
 * The account statement is the only profile that is mapped yet (#317): it
 * alone proves cash history and carries trades, dividends and cash balances.
 * `transactions` and `portfolio` still only name themselves; their row
 * mapping lands in #318/#319, and returning empty sections for them would
 * look like a complete read that wipes stored rows.
 */
export function parseBrokerFile(filename: string, text: string): ParsedBrokerFile {
  void filename;

  const read = readDeGiroCsv(text);
  if (!read.detection.known)
    return { positions: [], trades: [], source: "", problems: read.problems };

  const { profile } = read.detection;
  if (profile === "account") {
    const account = readDeGiroAccount(text);
    return {
      profile,
      positions: [],
      trades: account.trades,
      dividends: account.dividends,
      cashFlows: account.cashFlows,
      cashBalances: account.cashBalances,
      cashHistory: account.coverage,
      ...(account.period ? { period: account.period } : {}),
      source: "DeGiro account",
      problems: account.problems,
    };
  }

  return {
    profile,
    positions: [],
    trades: [],
    source: `DeGiro ${profile}`,
    problems:
      read.problems.length > 0
        ? read.problems
        : [
            `DeGiro ${profile}-export herkend, maar nog niet uitgelezen: de rij-mapping volgt in #315–#319`,
          ],
  };
}

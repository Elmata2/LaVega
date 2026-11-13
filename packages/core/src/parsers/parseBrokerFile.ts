import type { Dividend } from "../investing/dividend.js";
import type { CashBalance, CashFlow, Position, Trade } from "../investing/model.js";
import { type AccountCoverage, readDeGiroAccount } from "./degiro/accountProfile.js";
import { mergeDeGiroFiles } from "./degiro/merge.js";
import { type DeGiroProfile, readDeGiroCsv } from "./degiro/profiles.js";
import { NO_ACCOUNT_HISTORY_REASON, readDeGiroTransactions } from "./degiro/transactions.js";

/** One export in an import: the name is kept for problem attribution only. */
export type BrokerFileInput = { filename: string; text: string };

/** The sections a parser actually read. A section not listed is unavailable,
 *  never an empty complete section: the snapshot would wipe stored rows. */
export type BrokerFileSection = "trades" | "dividends" | "cashFlows" | "cashBalances";

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
  sections?: readonly BrokerFileSection[];
  /** Set by `parseBrokerFiles` only, so a multi-file import can name the file
   *  a problem came from. `parseBrokerFile` still ignores the filename. */
  filename?: string;
};

const ACCOUNT_SECTIONS: readonly BrokerFileSection[] = [
  "trades",
  "dividends",
  "cashFlows",
  "cashBalances",
];

/**
 * Broker-file detection, delegating to the DeGiro readers in `./degiro/`.
 *
 * The filename is accepted for API compatibility with the upload path and is
 * deliberately unused: a real DeGiro export arrives as `Account.csv`,
 * `Transactions (1).csv` or whatever the user renamed it to, so only the
 * header may decide the profile.
 *
 * The account statement is the only profile that proves cash history: it alone
 * carries cash flows, dividends, cash balances, trades and coverage (#317).
 * The transaction export maps to trades and an unknown coverage claim (#318):
 * trades alone do not prove cash history. The portfolio export still only names
 * itself; its row mapping lands in #319.
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
      sections: ACCOUNT_SECTIONS,
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
  if (profile === "transactions") {
    const transactions = readDeGiroTransactions(text);
    return {
      profile,
      sections: ["trades"],
      positions: [],
      trades: transactions.trades,
      cashHistory: { status: "unknown", reason: NO_ACCOUNT_HISTORY_REASON },
      ...(transactions.period ? { period: transactions.period } : {}),
      source: "DeGiro transactions",
      problems: transactions.problems,
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
            "DeGiro portfolio-export herkend, maar nog niet uitgelezen: de rij-mapping volgt in #319",
          ],
  };
}

/**
 * Parse every export of one import. A single file keeps `parseBrokerFile`'s
 * result untouched; several files are merged into one result by
 * `mergeDeGiroFiles`, so the upload route (#323) has one seam to call.
 */
export function parseBrokerFiles(files: readonly BrokerFileInput[]): ParsedBrokerFile {
  const parsed = files.map((file) => ({
    ...parseBrokerFile(file.filename, file.text),
    filename: file.filename,
  }));
  const [only] = parsed;
  if (parsed.length === 1 && only !== undefined) return only;
  return mergeDeGiroFiles(parsed);
}

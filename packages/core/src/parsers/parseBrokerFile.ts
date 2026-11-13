import type { Dividend } from "../investing/dividend.js";
import type { CashBalance, CashFlow, Position, Trade } from "../investing/model.js";
import { type AccountCoverage, readDeGiroAccount } from "./degiro/accountProfile.js";
import { mergeDeGiroFiles } from "./degiro/merge.js";
import {
  NO_PORTFOLIO_HISTORY_REASON,
  parsePortfolioAsOf,
  readDeGiroPortfolio,
} from "./degiro/portfolio.js";
import { type DeGiroProfile, readDeGiroCsv } from "./degiro/profiles.js";
import { NO_ACCOUNT_HISTORY_REASON, readDeGiroTransactions } from "./degiro/transactions.js";

/** One export in an import: the name is kept for problem attribution only. */
export type BrokerFileInput = { filename: string; text: string };

/** Import-wide inputs the parser cannot read from any file. `asOf` is the
 *  portfolio export's date: that export carries no date column. */
export type BrokerFileOptions = { asOf?: string };

/** The sections a parser actually read. A section not listed is unavailable,
 *  never an empty complete section: the snapshot would wipe stored rows. */
export type BrokerFileSection = "trades" | "dividends" | "cashFlows" | "cashBalances" | "positions";

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
 * trades alone do not prove cash history. The portfolio export maps to dated
 * positions and its cash row (#319); it proves no cash history either, and its
 * positions are claimed only when the caller supplies the export date.
 */
export function parseBrokerFile(
  filename: string,
  text: string,
  options: BrokerFileOptions = {},
): ParsedBrokerFile {
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

  const asOf = options.asOf ?? "";
  const portfolio = readDeGiroPortfolio(text, asOf);
  /* Withhold the sections when the export could not be read: no date means the
   * rows are undated, and a header-only file is not an import. An empty
   * `positions` section would tell the snapshot the broker reported zero
   * holdings and wipe the stored ones. */
  const readable = parsePortfolioAsOf(asOf) !== null && read.problems.length === 0;
  const sections: BrokerFileSection[] = readable ? ["positions"] : [];
  if (readable && portfolio.cashBalances.length > 0) sections.push("cashBalances");

  return {
    profile,
    sections,
    positions: readable ? portfolio.positions : [],
    trades: [],
    ...(readable && portfolio.cashBalances.length > 0
      ? { cashBalances: portfolio.cashBalances }
      : {}),
    cashHistory: { status: "unknown", reason: NO_PORTFOLIO_HISTORY_REASON },
    source: "DeGiro portfolio",
    problems: portfolio.problems,
  };
}

/**
 * Parse every export of one import. A single file keeps `parseBrokerFile`'s
 * result untouched; several files are merged into one result by
 * `mergeDeGiroFiles`, so the upload route (#323) has one seam to call.
 */
export function parseBrokerFiles(
  files: readonly BrokerFileInput[],
  options: BrokerFileOptions = {},
): ParsedBrokerFile {
  const parsed = files.map((file) => ({
    ...parseBrokerFile(file.filename, file.text, options),
    filename: file.filename,
  }));
  const [only] = parsed;
  if (parsed.length === 1 && only !== undefined) return only;
  return mergeDeGiroFiles(parsed);
}

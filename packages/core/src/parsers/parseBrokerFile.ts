import type { TradeWithoutId } from "../investing/hash.js";
import type { Position } from "../investing/model.js";
import { readDeGiroCsv } from "./degiro/profiles.js";

export type ParsedBrokerFile = {
  positions: Omit<Position, "entity" | "tenantId">[];
  trades: Omit<TradeWithoutId, "tenantId">[];
  source: string;
  problems: string[];
};

/**
 * Broker-file detection, delegating to the DeGiro reader in `./degiro/`.
 *
 * The filename is accepted for API compatibility with the upload path and is
 * deliberately unused: a real DeGiro export arrives as `Account.csv`,
 * `Transactions (1).csv` or whatever the user renamed it to, so only the
 * header may decide the profile. The old filename regex and header guessing
 * are gone (#314): they dated from the invented #47/#49 shape and rejected
 * every real export.
 *
 * This function only *names* the profile. Turning the recognised rows into
 * trades, positions, cash flows and balances is the mapping step and lands in
 * #315–#319; until then a recognised file reports one problem naming the
 * profile instead of silently returning no rows.
 */
export function parseBrokerFile(filename: string, text: string): ParsedBrokerFile {
  void filename;

  const read = readDeGiroCsv(text);
  if (!read.detection.known)
    return { positions: [], trades: [], source: "", problems: read.problems };

  const { profile } = read.detection;
  return {
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

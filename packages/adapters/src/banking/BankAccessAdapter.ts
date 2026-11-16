import type { Account, ImportProblem, Tx, UnrecognisedAction } from "@lavega/core";

export type BankResult = {
  accounts: Account[];
  txs: Omit<Tx, "id">[];
  source: string;
  problems: ImportProblem[];
  /** Trading 212 rows with an Action no rule knows (counted, not imported). */
  unrecognised: UnrecognisedAction[];
  unreadable: number;
};

export interface BankAccessAdapter {
  load(input: {
    filename: string;
    text: string;
    entity: string;
    /** Account key when the file names none (the card the person picked). */
    accountHint?: string;
    /** A spreadsheet already read into rows by the caller; `text` is ignored then. */
    sheet?: { format: "xlsx" | "xls"; rows: string[][] };
  }): Promise<BankResult>;
}

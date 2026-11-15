import type { Account, ImportProblem, Tx } from "@lavega/core";

export type BankResult = {
  accounts: Account[];
  txs: Omit<Tx, "id">[];
  source: string;
  problems: ImportProblem[];
};

export interface BankAccessAdapter {
  load(input: { filename: string; text: string; entity: string }): Promise<BankResult>;
}

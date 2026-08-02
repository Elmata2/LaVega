export type Account = { key: string; iban: string; name: string; bank: string;
  entity: string; currency: string; balance: number | null; balanceDate?: string };
export type Tx = { id: string; accountKey: string; date: string; amount: number;
  currency: string; counterparty: string; description: string; category: string; manual: boolean };
export type Rule = { id: string; match: string; category: string };

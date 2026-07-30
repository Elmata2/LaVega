import type { Account, Tx } from "./model.js";
import { assignTxIds } from "./hash.js";

export function ingest(existing: Tx[], incoming: Omit<Tx, "id">[]): Tx[] {
  const seen = new Set(existing.map((t) => t.id));
  const withIds = assignTxIds(incoming);
  return [...existing, ...withIds.filter((t) => !seen.has(t.id))];
}

export function consolidate(accounts: Account[], txs: Tx[]) {
  const entityOf = new Map(accounts.map((a) => [a.key, a.entity]));
  const byEntity: Record<string, { in: number; out: number; balance: number | null }> = {};
  for (const a of accounts) {
    const b = (byEntity[a.entity] ??= { in: 0, out: 0, balance: 0 });
    b.balance = a.balance === null || b.balance === null ? null : b.balance + a.balance;
  }
  for (const t of txs) {
    const e = entityOf.get(t.accountKey) ?? "onbekend";
    const b = (byEntity[e] ??= { in: 0, out: 0, balance: null });
    if (t.amount >= 0) b.in += t.amount; else b.out += t.amount;
  }
  const balances = Object.values(byEntity).map((b) => b.balance);
  const totalBalance =
    balances.length === 0 || balances.some((x) => x === null)
      ? null
      : balances.reduce((s: number, x) => s + (x as number), 0);
  return { byEntity, totalBalance };
}

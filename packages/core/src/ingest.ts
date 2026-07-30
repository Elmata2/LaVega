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
    byEntity[a.entity] ??= { in: 0, out: 0, balance: 0 };
    const b = byEntity[a.entity];
    b.balance = b.balance === null || a.balance === null ? (a.balance ?? b.balance) : b.balance + a.balance;
  }
  for (const t of txs) {
    const e = entityOf.get(t.accountKey) ?? "onbekend";
    byEntity[e] ??= { in: 0, out: 0, balance: null };
    if (t.amount >= 0) byEntity[e].in += t.amount;
    else byEntity[e].out += t.amount;
  }
  const totals = Object.values(byEntity).map((b) => b.balance);
  const totalBalance = totals.some((x) => x === null) ? null : totals.reduce((s, x) => s + (x as number), 0);
  return { byEntity, totalBalance };
}

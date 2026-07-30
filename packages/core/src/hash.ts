import type { Tx } from "./model.js";

export function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export const norm = (s: unknown): string =>
  String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

export function assignTxIds(rows: Omit<Tx, "id">[]): Tx[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = [r.accountKey, r.date, r.amount.toFixed(2),
      norm(r.counterparty).slice(0, 40), norm(r.description).slice(0, 60)].join("|");
    const n = (seen.get(base) ?? 0) + 1;   // 1-based, matches Kasoverzicht
    seen.set(base, n);
    return { ...r, id: hash(base + "#" + n) };
  });
}

import { hash, norm } from "../hash.js";
import type { Trade } from "./model.js";

export type TradeWithoutId = Omit<Trade, "id">;

export function tradeBase(trade: TradeWithoutId): string {
  return [
    trade.entity,
    trade.date,
    norm(trade.symbol),
    trade.side,
    trade.quantity,
    trade.price ?? "",
    trade.amount ?? "",
    norm(trade.currency),
    norm(trade.brokerTradeId),
  ].join("|");
}

export function tradeId(base: string, occurrence: number): string {
  return hash(base + "#" + occurrence);
}

export function assignTradeIds(rows: TradeWithoutId[]): Trade[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const base = tradeBase(row);
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    return { ...row, id: tradeId(base, occurrence) };
  });
}

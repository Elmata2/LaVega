import type { Trade } from "./model.js";

/** Signed unit change of one trade. Transfers and splits move no units. */
export function tradeDelta(trade: Trade): number {
  return trade.side === "buy" ? trade.quantity : trade.side === "sell" ? -trade.quantity : 0;
}

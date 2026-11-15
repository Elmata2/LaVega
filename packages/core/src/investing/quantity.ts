import type { Trade } from "./model.js";

export type TradeOrder = "chronological" | "reverse-chronological";

export function normalizeTradeQuantity(side: Trade["side"], raw: number): number {
  if (side === "other") return raw;
  if (!Number.isFinite(raw) || raw === 0)
    throw new Error("Trade quantity must be finite and non-zero");
  return Math.abs(raw);
}

export function orderTrades<T extends Trade>(
  trades: readonly T[],
  order: TradeOrder = "chronological",
): T[] {
  const byDate = new Map<string, Array<{ trade: T; sourceOrder: number }>>();
  trades.forEach((trade, sourceOrder) => {
    const bucket = byDate.get(trade.date);
    const item = { trade, sourceOrder };
    if (bucket) bucket.push(item);
    else byDate.set(trade.date, [item]);
  });

  const direction = order === "chronological" ? 1 : -1;
  return [...byDate.entries()]
    .sort(([left], [right]) => direction * left.localeCompare(right))
    .flatMap(([, bucket]) => {
      const timed = bucket
        .filter(({ trade }) => trade.executionAt !== undefined)
        .sort(
          (left, right) =>
            direction * left.trade.executionAt!.localeCompare(right.trade.executionAt!) ||
            left.sourceOrder - right.sourceOrder,
        );
      let timedIndex = 0;
      return bucket.map(({ trade }) =>
        trade.executionAt === undefined ? trade : timed[timedIndex++]!.trade,
      );
    });
}

/** Signed unit change of one trade. Transfers and splits move no units. */
export function tradeDelta(trade: Trade): number {
  return trade.side === "buy" ? trade.quantity : trade.side === "sell" ? -trade.quantity : 0;
}

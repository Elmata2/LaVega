import type { Position, PriceBar, Trade } from "./model.js";

/** Brokers report each trade in the share units of its own day, while closes
 *  are split-adjusted into today's units. A quantity from before a split,
 *  valued at today's close, is off by the split ratio. This puts every trade
 *  and snapshot into today's units so quantity and close agree. */
export function inCurrentShareUnits(
  positions: readonly Position[],
  trades: readonly Trade[],
  bars: readonly PriceBar[],
): { positions: Position[]; trades: Trade[] } {
  const splits = new Map<string, Array<{ date: string; ratio: number }>>();
  for (const bar of bars) {
    if (bar.split === undefined || bar.split === 1 || !(bar.split > 0)) continue;
    splits.set(bar.symbol, [
      ...(splits.get(bar.symbol) ?? []),
      { date: bar.date, ratio: bar.split },
    ]);
  }
  /** A split takes effect at the open, so a record dated on the split day is
   *  already in the new units. */
  const factor = (symbol: string, date: string) =>
    (splits.get(symbol) ?? [])
      .filter((split) => split.date > date)
      .reduce((product, split) => product * split.ratio, 1);

  return {
    positions: positions.map((position) => {
      const ratio = factor(position.symbol, position.asOf);
      if (ratio === 1) return position;
      return {
        ...position,
        quantity: position.quantity * ratio,
        averagePrice: position.averagePrice === null ? null : position.averagePrice / ratio,
        marketPrice: position.marketPrice === null ? null : position.marketPrice / ratio,
      };
    }),
    trades: trades.map((trade) => {
      const ratio = factor(trade.symbol, trade.date);
      if (ratio === 1) return trade;
      return {
        ...trade,
        quantity: trade.quantity * ratio,
        price: trade.price === null ? null : trade.price / ratio,
      };
    }),
  };
}

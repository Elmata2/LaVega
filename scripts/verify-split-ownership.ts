/* Replays production activity for held symbols through inCurrentShareUnits,
 * with split events fetched from Yahoo, and checks that the trades then add up
 * to the broker snapshot. Read-only against production.
 *
 * Usage: node --import tsx scripts/verify-split-ownership.ts <dir>
 * where <dir> holds `<SYMBOL>.json` files written by
 * `control-investing.mjs api GET "/api/investing/dashboard?symbol=<SYMBOL>" --target prod`. */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { inCurrentShareUnits, type PriceBar, type Trade } from "../packages/core/src/index.js";

const YAHOO: Record<string, string> = {
  IBKR_US_EQ: "IBKR",
  PEGA_US_EQ: "PEGA",
  CRWD_US_EQ: "CRWD",
  MNST_US_EQ: "MNST",
  BY6d_EQ: "BY6.F",
};

type Activity = { date: string; kind: string; quantity?: number; executionPrice?: number };

async function splitBars(symbol: string): Promise<PriceBar[]> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${YAHOO[symbol]}?period1=1704067200&period2=${Math.floor(Date.now() / 1000)}&interval=1mo&events=splits`;
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  const result = (await response.json()).chart.result[0];
  return Object.values(
    (result.events?.splits ?? {}) as Record<
      string,
      { date: number; numerator: number; denominator: number }
    >,
  ).map((split) => ({
    symbol,
    date: new Date(split.date * 1000).toISOString().slice(0, 10),
    close: 0,
    currency: "USD",
    split: split.numerator / split.denominator,
  }));
}

const directory = process.argv[2]!;
let failures = 0;
for (const file of readdirSync(directory).filter((name) => name.endsWith(".json"))) {
  const symbol = file.replace(/\.json$/, "");
  if (!YAHOO[symbol]) continue;
  const body = JSON.parse(readFileSync(join(directory, file), "utf8"));
  const dashboard = body.body ?? body;
  const snapshot = dashboard.positions.find((item: { symbol: string }) => item.symbol === symbol);
  const trades: Trade[] = (dashboard.position.activity as Activity[])
    .filter((item) => item.kind === "buy" || item.kind === "sell")
    .map((item, index) => ({
      id: String(index),
      entity: "personal",
      date: item.date,
      symbol,
      side: item.kind as "buy" | "sell",
      quantity: item.quantity!,
      price: item.executionPrice ?? null,
      amount: null,
      currency: "USD",
      commission: 0,
    }));
  const bars = await splitBars(symbol);
  const signed = (list: readonly Trade[]) =>
    list.reduce((sum, trade) => sum + (trade.side === "sell" ? -1 : 1) * trade.quantity, 0);
  const adjusted = inCurrentShareUnits([], trades, bars).trades;
  const ok = Math.abs(signed(adjusted) - snapshot.quantity) < 1e-6;
  if (!ok) failures += 1;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${symbol} snapshot=${snapshot.quantity} raw=${signed(trades).toFixed(8)} adjusted=${signed(adjusted).toFixed(8)} splits=${bars.map((bar) => `${bar.date}x${bar.split}`).join(",")}`,
  );
}
process.exit(failures ? 1 : 0);

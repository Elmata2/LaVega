import type { TradeWithoutId } from "../investing/hash.js";
import type { Position, TradeSide } from "../investing/model.js";
import { headerIndex, parseAmount, parseDate, splitRows } from "./primitives.js";
import { norm } from "../hash.js";

export type ParsedBrokerFile = {
  positions: Omit<Position, "entity" | "tenantId">[];
  trades: Omit<TradeWithoutId, "tenantId">[];
  source: string;
  problems: string[];
};

function delimiter(text: string): string {
  const head = text.split(/\r?\n/).slice(0, 3).join("\n");
  const candidates = [";", ",", "\t", "|"];
  return candidates.reduce((best, candidate) =>
    head.split(candidate).length > head.split(best).length ? candidate : best,
  );
}

function pick(index: Record<string, number>, names: string[]): number {
  for (const name of names) {
    const key = norm(name);
    if (key in index) return index[key];
  }
  return -1;
}

function value(row: string[], index: number): string {
  return index < 0 ? "" : String(row[index] ?? "").trim();
}

function parsedAmount(row: string[], index: number): number | null {
  return parseAmount(value(row, index));
}

function side(raw: string, quantity: number | null, amount: number | null): TradeSide {
  if (/^(buy|purchase|koop|aankoop|bought)$/i.test(raw)) return "buy";
  if (/^(sell|sale|verkoop|verkocht)$/i.test(raw)) return "sell";
  if (quantity != null && quantity < 0) return "sell";
  if (amount != null && amount < 0) return "buy";
  if (amount != null && amount > 0) return "sell";
  return "other";
}

function finish(trades: Omit<TradeWithoutId, "tenantId">[], source: string): ParsedBrokerFile {
  if (trades.length) return { positions: [], trades, source, problems: [] };
  return {
    positions: [],
    trades: [],
    source,
    problems: [`formaat herkend (${source}) maar geen transacties gevonden`],
  };
}

function finishPositions(positions: Omit<Position, "entity" | "tenantId">[]): ParsedBrokerFile {
  if (positions.length) return { positions, trades: [], source: "DeGiro", problems: [] };
  return { positions: [], trades: [], source: "DeGiro", problems: ["formaat herkend (DeGiro portfolio) maar geen posities gevonden"] };
}

/**
 * Parses DeGiro's transaction export. Verified export shape (Dutch/English):
 * semicolon-delimited CSV with Date/Datum, Product, ISIN, Quantity/Aantal,
 * Price/Koers, Total/Totaal, Currency/Valuta and Order ID columns. DeGiro's
 * cash-flow export has no product/order fields and is reported, not discarded.
 * Portfolio exports are parsed as positions when no transaction shape matches.
 */
export function parseBrokerFile(filename: string, text: string): ParsedBrokerFile {
  if (!text.trim()) return { positions: [], trades: [], source: "", problems: ["onbekend of leeg bestand — geen transacties herkend"] };

  const rows = splitRows(text, delimiter(text));
  if (!rows.length) return { positions: [], trades: [], source: "", problems: ["onbekend of leeg bestand — geen transacties herkend"] };
  const header = rows[0].map((cell) => cell.trim());
  const h = header.map(norm).join("|");
  const idx = headerIndex(header);
  const date = pick(idx, ["date", "datum"]);
  const product = pick(idx, ["product", "instrument", "naam"]);
  const isin = pick(idx, ["isin"]);
  const quantity = pick(idx, ["quantity", "aantal", "qty"]);
  const price = pick(idx, ["price", "koers"]);
  const total = pick(idx, ["total", "totaal", "amount", "bedrag"]);
  const currency = pick(idx, ["currency", "valuta"]);
  const action = pick(idx, ["type", "action", "transaction type", "transactietype"]);
  const commission = pick(idx, ["transaction costs", "transactiekosten", "commission", "kosten"]);
  const orderId = pick(idx, ["order id", "orderid", "order-id"]);

  const symbol = pick(idx, ["symbol", "ticker", "product", "instrument", "naam"]);
  const positionQuantity = pick(idx, ["quantity", "aantal", "qty", "amount", "units", "positie"]);
  const averagePrice = pick(idx, ["average price", "average price per unit", "gemiddelde koers", "gemiddelde prijs", "average cost"]);
  const marketPrice = pick(idx, ["market price", "price", "koers", "current price", "huidige koers"]);
  const marketValue = pick(idx, ["market value", "value", "waarde", "total value", "value in eur", "waarde in eur", "local value"]);
  const asOf = pick(idx, ["as of", "date", "datum", "peildatum", "valuation date"]);

  const identifiedAsDeGiro = /degiro/i.test(filename) ||
    (isin > -1 && currency > -1 && (product > -1 || symbol > -1) && (date > -1 || asOf > -1));
  const transactionExport = identifiedAsDeGiro && date > -1 && product > -1 && quantity > -1 && price > -1 && total > -1 && (isin > -1 || orderId > -1);
  const cashflowExport = date > -1 && total > -1 && product < 0 && (/cash ?flow|cashflow|value date|valutadatum|description|omschrijving/.test(h) || /degiro/i.test(filename));
  if (!transactionExport) {
    if (cashflowExport) return { positions: [], trades: [], source: "DeGiro cashflow", problems: ["DeGiro cashflow-export bevat geen transacties"] };
    const portfolioHint = /portfolio|position|posities|overzicht/i.test(filename) ||
      (symbol > -1 && positionQuantity > -1 && (marketValue > -1 || marketPrice > -1 || averagePrice > -1));
    if (portfolioHint && symbol > -1 && positionQuantity > -1 && (isin > -1 || pick(idx, ["symbol", "ticker"]) > -1)) {
      const positions: Omit<Position, "entity" | "tenantId">[] = [];
      for (let rowNo = 1; rowNo < rows.length; rowNo++) {
        const row = rows[rowNo];
        const symbolValue = value(row, symbol);
        const quantityValue = parsedAmount(row, positionQuantity);
        if (!symbolValue || quantityValue == null) continue;
        positions.push({
          symbol: symbolValue,
          ...(value(row, isin) ? { isin: value(row, isin) } : {}),
          quantity: quantityValue,
          averagePrice: parsedAmount(row, averagePrice),
          marketPrice: parsedAmount(row, marketPrice),
          marketValue: parsedAmount(row, marketValue),
          currency: value(row, currency) || "EUR",
          asOf: parseDate(value(row, asOf)) ?? "",
        });
      }
      return finishPositions(positions);
    }
    return { positions: [], trades: [], source: "", problems: ["onbekend of leeg bestand — geen transacties of posities herkend"] };
  }

  const trades: Omit<TradeWithoutId, "tenantId">[] = [];
  for (let rowNo = 1; rowNo < rows.length; rowNo++) {
    const row = rows[rowNo];
    const dateValue = parseDate(value(row, date));
    const rawQuantity = parseAmount(value(row, quantity));
    const rawPrice = parseAmount(value(row, price));
    const amount = parseAmount(value(row, total));
    if (!dateValue || rawQuantity == null || rawPrice == null || amount == null) continue;
    const productValue = value(row, product);
    if (!productValue) continue;
    const sideValue = side(value(row, action), rawQuantity, amount);
    trades.push({
      entity: "",
      date: dateValue,
      symbol: productValue,
      ...(value(row, isin) ? { isin: value(row, isin) } : {}),
      side: sideValue,
      quantity: Math.abs(rawQuantity),
      price: Math.abs(rawPrice),
      amount,
      currency: value(row, currency) || "EUR",
      commission: commission > -1 ? parseAmount(value(row, commission)) : null,
      ...(value(row, orderId) ? { brokerTradeId: value(row, orderId) } : {}),
    });
  }
  return finish(trades, "DeGiro");
}

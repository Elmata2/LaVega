const EXCHANGE_SUFFIX_MAP: Record<string, string> = {
  NASDAQ: "", NMS: "", NYSE: "", AMEX: "", ARCA: "", LSE: ".L", LSEETF: ".L",
  XETRA: ".DE", XETR: ".DE", IBIS: ".DE", FWB: ".F", GETTEX: ".DE",
  AMS: ".AS", XAMS: ".AS", AEB: ".AS", EURONEXT: ".AS", SBF: ".PA", "ENEXT.BE": ".BR", BVL: ".LS",
  BVME: ".MI", BM: ".MC", SIX: ".SW", SWX: ".SW", OMX: ".ST", Stockholm: ".ST",
  CPH: ".CO", HEX: ".HE", OSE: ".OL", VSE: ".VI", WSE: ".WA", ATHEX: ".AT",
  HKEX: ".HK", SEHK: ".HK", TYO: ".T", ASX: ".AX", NSE: ".NS", BSE: ".BO", TSX: ".TO",
};
const FALLBACKS = ["", ".AS", ".PA", ".BR", ".DE", ".F", ".L", ".MI", ".MC", ".SW", ".ST", ".CO", ".HE", ".OL", ".VI", ".WA"];
const KNOWN = new Set(Object.values(EXCHANGE_SUFFIX_MAP).concat(FALLBACKS));

export function getYahooSymbol(ticker: string, exchange: string): string {
  if (tickerHasYahooSuffix(ticker)) return ticker;
  return `${ticker.replace(/ /g, "-")}${EXCHANGE_SUFFIX_MAP[exchange] ?? ""}`;
}

export function getYahooSymbolsToTry(ticker: string, exchange: string): string[] {
  if (tickerHasYahooSuffix(ticker)) return [ticker];
  const normalized = ticker.replace(/ /g, "-");
  const suffix = EXCHANGE_SUFFIX_MAP[exchange];
  if (suffix !== undefined) return [getYahooSymbol(normalized, exchange)];
  // Broker tickers like "AMD_US_EQ" (Trading 212) are not Yahoo symbols; also
  // try the stripped base so price sync works when ISIN lookup is rate-limited.
  const stripped = normalized.replace(/_[A-Z]{2}_EQ$/, "");
  const bases = stripped === normalized ? [normalized] : [normalized, stripped];
  return bases.flatMap((base) => FALLBACKS.map((candidate) => `${base}${candidate}`));
}

function tickerHasYahooSuffix(ticker: string): boolean {
  const dot = ticker.indexOf(".");
  return dot >= 0 && KNOWN.has(ticker.slice(dot));
}

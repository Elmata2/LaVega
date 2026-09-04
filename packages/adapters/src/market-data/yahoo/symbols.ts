const EXCHANGE_SUFFIX_MAP: Record<string, string> = {
  NASDAQ: "",
  NMS: "",
  NYSE: "",
  AMEX: "",
  ARCA: "",
  LSE: ".L",
  LSEETF: ".L",
  XETRA: ".DE",
  XETR: ".DE",
  IBIS: ".DE",
  FWB: ".F",
  GETTEX: ".DE",
  AMS: ".AS",
  XAMS: ".AS",
  AEB: ".AS",
  EURONEXT: ".AS",
  SBF: ".PA",
  "ENEXT.BE": ".BR",
  BVL: ".LS",
  BVME: ".MI",
  BM: ".MC",
  SIX: ".SW",
  SWX: ".SW",
  OMX: ".ST",
  Stockholm: ".ST",
  CPH: ".CO",
  HEX: ".HE",
  OSE: ".OL",
  VSE: ".VI",
  WSE: ".WA",
  ATHEX: ".AT",
  HKEX: ".HK",
  SEHK: ".HK",
  TYO: ".T",
  ASX: ".AX",
  NSE: ".NS",
  BSE: ".BO",
  TSX: ".TO",
};
const TRADING212_COUNTRY_SUFFIX_MAP: Record<string, string> = {
  BE: ".BR",
  CA: ".TO",
  DE: ".DE",
  US: "",
};
const TRADING212_VENUE_SUFFIX_MAP: Record<string, string> = {
  Hs: ".SW",
  a: ".AS",
  d: ".DE",
  e: ".MC",
  l: ".L",
  p: ".PA",
  s: ".SW",
};
const FALLBACKS = [
  "",
  ".AS",
  ".PA",
  ".BR",
  ".DE",
  ".F",
  ".L",
  ".MI",
  ".MC",
  ".SW",
  ".ST",
  ".CO",
  ".HE",
  ".OL",
  ".VI",
  ".WA",
];
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
  const trading212 = trading212YahooCandidates(normalized);
  if (trading212.length) return unique(trading212);
  return FALLBACKS.map((candidate) => `${normalized}${candidate}`);
}

function tickerHasYahooSuffix(ticker: string): boolean {
  const dot = ticker.indexOf(".");
  return dot >= 0 && KNOWN.has(ticker.slice(dot));
}

function trading212YahooCandidates(ticker: string): string[] {
  const country = /^(?<base>.+?)_(?<country>[A-Z]{2})_EQ$/.exec(ticker)?.groups;
  if (country) {
    const base = yahooClassSymbol(country.base.replace(/_CORP$/, ""));
    const suffix = TRADING212_COUNTRY_SUFFIX_MAP[country.country];
    if (suffix !== undefined) return expandTrading212Base(base, suffix);
  }

  const venueBody = /^(?<body>.+)_EQ$/.exec(ticker)?.groups?.body;
  if (venueBody) {
    const venues = Object.keys(TRADING212_VENUE_SUFFIX_MAP).sort(
      (left, right) => right.length - left.length,
    );
    for (const venue of venues) {
      if (!venueBody.endsWith(venue) || venueBody.length === venue.length) continue;
      const base = yahooClassSymbol(venueBody.slice(0, -venue.length));
      const suffix = TRADING212_VENUE_SUFFIX_MAP[venue]!;
      return expandTrading212Base(base, suffix);
    }
  }

  return [];
}

function yahooClassSymbol(value: string): string {
  return value.replace(/[/_]/g, "-");
}

function expandTrading212Base(base: string, preferredSuffix: string): string[] {
  return [`${base}${preferredSuffix}`, ...FALLBACKS.map((suffix) => `${base}${suffix}`)];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

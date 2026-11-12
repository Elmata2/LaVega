/*
 * The shared identity of one price series (issue #307).
 *
 * A symbol string alone is not safe as a shared key: two users can hold
 * different instruments under the same plain ticker, and a benchmark has no
 * ISIN at all. The key is computed HERE and nowhere else; callers pass it down.
 *
 * Rules (issue #307 "Exact rules"):
 *  - an ISIN must match `^[A-Z]{2}[A-Z0-9]{9}[0-9]$` after upper-casing; a value
 *    that does not match is ignored and the `sym:` form is used;
 *  - the symbol is used as given, so a `sym:` key never collides with another
 *    one unless the caller changes the symbol;
 *  - the delimiter is `:`. ISINs and currency codes cannot contain it and the
 *    symbol is the middle segment of `sym:`, so parsing is never needed;
 *  - benchmarks and ISIN-less tickers use `sym:`.
 */
const ISIN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

export function instrumentKey(input: { symbol: string; isin?: string; currency: string }): string {
  const currency = input.currency.toUpperCase();
  const isin = input.isin?.toUpperCase();
  return isin && ISIN.test(isin) ? `isin:${isin}:${currency}` : `sym:${input.symbol}:${currency}`;
}

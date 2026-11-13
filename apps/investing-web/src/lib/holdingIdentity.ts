/** An ISIN is a product identifier, not a name. DeGiro reports one as the
 *  symbol while its `description` holds the product name, so the identity line
 *  must not repeat it. */
const ISIN_PATTERN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

export function isIsinSymbol(symbol: string | null | undefined): boolean {
  return typeof symbol === "string" && ISIN_PATTERN.test(symbol.trim().toUpperCase());
}

/** The muted line under a holding's product name. A ticker identifies the
 *  holding and stays; an ISIN repeats what the product name already says, so
 *  the line falls back to the account and quantity instead. */
export function holdingIdentityLine(position: {
  symbol: string;
  description?: string | undefined;
  entity?: string | undefined;
  quantity: number;
}): string {
  const shares = `${position.quantity.toLocaleString("en-GB")} shares`;
  if (position.description && isIsinSymbol(position.symbol))
    return position.entity ? `${position.entity} · ${shares}` : shares;
  return [position.symbol, position.entity, shares]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

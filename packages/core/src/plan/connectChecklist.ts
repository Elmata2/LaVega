/** Brand id to the lower-case name fragments an account's `bank` may carry.
 *  Each fragment matches as a whole word, so "ing" does not match "Leasing". */
export const BANK_ALIASES: Record<string, readonly string[]> = {
  ing: ["ing"],
  abn: ["abn amro", "abn-amro"],
  rabo: ["rabobank", "rabo"],
  "sns-asn-regio": ["sns", "asn", "regiobank"],
  triodos: ["triodos"],
  knab: ["knab"],
  bunq: ["bunq"],
  revolut: ["revolut"],
  n26: ["n26"],
  wise: ["wise"],
  openbank: ["openbank"],
  "trade-republic": ["trade republic"],
  crypto: ["bybit", "kraken", "plutus"],
  amex: ["american express", "amex"],
  ics: ["international card services", "ics"],
  anwb: ["anwb"],
  nexo: ["nexo"],
};

/** Brands with no bank-link path: never listed, like "other". */
export const NOT_LINKABLE: readonly string[] = ["other", "other-brand", "crypto", "nexo"];

export type ConnectItem = { brand: string; connected: boolean };

export type ConnectChecklistInput = {
  statedBanks: readonly string[];
  impliedBanks: readonly string[];
  accounts: readonly { bank: string; linkedAt?: string }[];
};

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether an account's bank name is this brand, by whole-word alias match. */
export const bankMatchesBrand = (bank: string, brand: string): boolean => {
  const name = bank.toLowerCase();
  const aliases = BANK_ALIASES[brand] ?? [brand];
  return aliases.some((a) => new RegExp(`(^|[^a-z0-9])${escapeRe(a)}($|[^a-z0-9])`).test(name));
};

/** The banks the person says they use (stated, or implied by a card), and
 *  whether a live bank link already covers each. "other" is never listed, and a
 *  CSV account (no `linkedAt`) does not count as connected. */
export function connectChecklist(i: ConnectChecklistInput): ConnectItem[] {
  const brands = [...new Set([...i.statedBanks, ...i.impliedBanks])].filter(
    (b) => !NOT_LINKABLE.includes(b),
  );
  const linked = i.accounts.filter((a) => a.linkedAt !== undefined);
  return brands.map((brand) => ({
    brand,
    connected: linked.some((a) => bankMatchesBrand(a.bank, brand)),
  }));
}

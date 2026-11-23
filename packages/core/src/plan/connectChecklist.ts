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
  "trading-212": ["trading 212", "trading212"],
};

/** Brands with no bank-link path: never listed, like "other". */
export const NOT_LINKABLE: readonly string[] = ["other", "other-brand", "crypto", "nexo"];

/** Brands the bank link cannot reach but a file export can. They are listed with
 *  the "file" route, never the bank link. */
export const FILE_ROUTE_BRANDS: readonly string[] = ["amex", "trading-212"];

export type ConnectItem = { brand: string; connected: boolean; route: "bank" | "file" };

export type ConnectChecklistInput = {
  statedBanks: readonly string[];
  impliedBanks: readonly string[];
  accounts: readonly {
    bank: string;
    linkedAt?: string;
    source?: "file";
    statedCardId?: string;
    balanceFetchedAt?: string;
  }[];
};

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether an account's bank name is this brand, by whole-word alias match. */
export const bankMatchesBrand = (bank: string, brand: string): boolean => {
  const name = bank.toLowerCase();
  const aliases = BANK_ALIASES[brand] ?? [brand];
  return aliases.some((a) => new RegExp(`(^|[^a-z0-9])${escapeRe(a)}($|[^a-z0-9])`).test(name));
};

/** Whether an account stands for a connected card or bank: a live bank link
 *  (stamped `linkedAt`, not marked as file-fed) or a file imported FOR a stated
 *  card (`statedCardId`). The placeholder list and this checklist both use it, so
 *  they cannot disagree. */
export const countsAsLinked = (a: {
  linkedAt?: string;
  source?: "file";
  statedCardId?: string;
}): boolean => (a.linkedAt !== undefined && a.source !== "file") || a.statedCardId !== undefined;

/** The banks the person says they use (stated, or implied by a card), and
 *  whether a link already covers each. "other" is never listed. A bank-route
 *  brand needs a live link (`linkedAt`, not file-fed) or a file imported for its
 *  stated card; a file-route brand needs the file-for-card stamp (Amex also keeps
 *  its older rule: an imported account with `linkedAt`). An account without
 *  `linkedAt` (a hand-made one) never counts. */
export function connectChecklist(i: ConnectChecklistInput): ConnectItem[] {
  const all = [...new Set([...i.statedBanks, ...i.impliedBanks])];
  const brands = all.filter((b) => !NOT_LINKABLE.includes(b) && !FILE_ROUTE_BRANDS.includes(b));
  const fileBrands = all.filter((b) => FILE_ROUTE_BRANDS.includes(b));
  const linked = i.accounts.filter(countsAsLinked);
  // Only a file can feed these brands: it counts once it was imported FOR the
  // stated card (`statedCardId`). Trading 212 has ONE account (card and cash
  // rows); it counts once a file for the stated card stamped it. Amex also keeps
  // what it always had: an account imported from a file before cards were
  // stamped (`linkedAt` set, never a live link) counts.
  const filed = i.accounts.filter(
    (a) =>
      a.statedCardId !== undefined ||
      (a.linkedAt !== undefined && a.balanceFetchedAt === undefined),
  );
  return [
    ...brands.map((brand) => ({
      brand,
      connected: linked.some((a) => bankMatchesBrand(a.bank, brand)),
      route: "bank" as const,
    })),
    ...fileBrands.map((brand) => ({
      brand,
      connected: (brand === "amex"
        ? filed
        : filed.filter((a) => a.statedCardId !== undefined)
      ).some((a) => bankMatchesBrand(a.bank, brand)),
      route: "file" as const,
    })),
  ];
}

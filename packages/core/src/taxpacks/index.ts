import { NL_TAX_PACK } from "./nl.js";
import { DE_TAX_PACK } from "./de.js";
import type { TaxPack } from "./types.js";

export * from "./types.js";
export { NL_TAX_PACK } from "./nl.js";
export { DE_TAX_PACK } from "./de.js";

/** THE registry. A new country is one import and one entry here — the engine in
 *  `../tax.ts` reads packs, never country names. */
export const TAX_PACKS = [NL_TAX_PACK, DE_TAX_PACK] as const;

/** The countries LaVega has rules for, derived from the registry so the type
 *  and the data can never drift apart. */
export type CountryCode = (typeof TAX_PACKS)[number]["country"];

export const DEFAULT_COUNTRY: CountryCode = "NL";

/** For a country picker: `[{ code: "NL", label: "Nederland" }, …]`. */
export const COUNTRY_OPTIONS: readonly { code: CountryCode; label: string }[] = TAX_PACKS.map(
  (p) => ({
    code: p.country,
    label: p.label,
  }),
);

const BY_CODE = new Map<string, TaxPack>(TAX_PACKS.map((p) => [p.country, p]));

/** The rules for a country. Unset falls back to NL (LaVega's home country, and
 *  what every vault written before this feature implicitly was). An unknown code
 *  — a vault from a newer build, a typo — also falls back rather than throwing:
 *  these packs are read while rendering, and a blank screen is worse than the
 *  previous behaviour. */
export function taxPack(country?: string): TaxPack {
  return BY_CODE.get(country ?? DEFAULT_COUNTRY) ?? BY_CODE.get(DEFAULT_COUNTRY)!;
}

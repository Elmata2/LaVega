/* ── WHAT A COUNTRY RULE PACK IS ───────────────────────────────────────────
 *
 * A tax pack is DATA, never code: the rules of one country expressed as plain
 * fields. All the arithmetic — period boundaries, deadline dates, the
 * reservation, the prepayment schedule — lives once in `../tax.ts` and is
 * driven by these fields.
 *
 * That is the whole design goal of item 8: **a third country is a new pack and
 * nothing else.** Adding, say, Belgium means writing `taxpacks/be.ts` and
 * adding it to the registry in `taxpacks/index.ts` — no new branch anywhere in
 * the engine, no `if (country === ...)` in a view, no new type.
 *
 * A pack may not contain functions, and the engine may not contain a country
 * name. If a new country needs a rule shape that is not expressible here, the
 * fix is to add a FIELD to this file (and implement it once in the engine), not
 * a special case.
 */

/** How often VAT is filed. Lives here rather than in `model.ts` because it is a
 *  tax rule, and a pack declares which of these its country actually allows. */
export type VatFrequency = "monthly" | "quarterly" | "yearly";

/** One filing period: its label, its exact window, and when it must be paid. */
export type TaxPeriod = {
  periodLabel: string;
  periodStart: string; // ISO
  periodEnd: string; // ISO
  deadline: string; // ISO
};

/** Where a filing deadline falls: `monthsAfterEnd` months after the period end,
 *  on `day` of that month (`"last"` = the last day of it).
 *  NL: 1 month after, last day → 31 July for Q2.
 *  DE: 1 month after, day 10   → 10 July for Q2 (§18 UStG). */
export type DeadlineRule = { monthsAfterEnd: number; day: number | "last" };

export type VatRules = {
  /** What the country calls it, used verbatim in labels: "BTW", "USt". */
  label: string;
  /** Statutory rates, highest first. For the UI; the estimate uses the rate in
   *  the owner's settings. */
  rates: readonly number[];
  /** What a fresh entity in this country should start with. */
  defaultRatePct: number;
  /** Which filing frequencies exist here — drives the frequency dropdown. */
  frequencies: readonly VatFrequency[];
  /** Deadline for a monthly or quarterly return. */
  periodic: DeadlineRule;
  /** Deadline for the annual return. */
  annual: DeadlineRule;
};

/** The rule that makes Germany hurt: profit tax is PREPAID on fixed dates, so
 *  money that looks like yours was never yours. A country with no LaVega-modelled
 *  prepayment sets `profitTax: null`. */
export type ProfitTaxRules = {
  /** Label for one instalment, used verbatim: "Vorauszahlung". */
  label: string;
  /** Label for the balance that lands after the year is assessed:
   *  "Nachzahlung". This is the surprise the owner must see coming. */
  settlementLabel: string;
  /** Indicative all-in rate on profit, in percent. Overridable per entity via
   *  `VatSettings.profitTaxRatePct`, and made irrelevant by
   *  `VatSettings.profitTaxManualCents` once the tax office has assessed. */
  defaultRatePct: number;
  /** How that rate is built up — shown next to the number so it is never a
   *  figure out of nowhere. */
  rateBasis: string;
  /** Statutory prepayment dates as `MM-DD`, in calendar order. */
  prepayDates: readonly string[];
  /** One Dutch sentence explaining the mechanism, for the UI. */
  what: string;
};

export type TaxPack = {
  /** ISO 3166-1 alpha-2. */
  country: string;
  /** Country name in Dutch — the UI language. */
  label: string;
  currency: string;
  /** When these rules were last checked against the tax authority. Every pack
   *  is an INDICATIVE snapshot and says so. */
  rulesAsOf: string;
  vat: VatRules;
  profitTax: ProfitTaxRules | null;
  /** What this pack knowingly does NOT model. Shown to the owner rather than
   *  hidden, so nobody mistakes a partial model for a complete one. */
  caveats: readonly string[];
};

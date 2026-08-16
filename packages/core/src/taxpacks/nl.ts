import type { TaxPack } from "./types.js";

/** Nederland — the rules LaVega shipped with, now expressed as a pack.
 *
 *  BTW: 21 / 9 / 0. A monthly or quarterly aangifte must be filed AND paid by
 *  the last day of the month after the period; the yearly aangifte (only for
 *  entities on a yearly cadence) by 31 March.
 *
 *  Vennootschapsbelasting is deliberately NOT modelled as a prepayment. The
 *  Belastingdienst sets a *voorlopige aanslag* itself and collects it in
 *  monthly instalments — LaVega has no basis to estimate that schedule without
 *  the aanslag, and inventing one would put a wrong number in the forecast.
 *  See `caveats`. */
export const NL_TAX_PACK = {
  country: "NL",
  label: "Nederland",
  currency: "EUR",
  rulesAsOf: "2026-08-04",
  vat: {
    label: "BTW",
    rates: [21, 9, 0],
    defaultRatePct: 21,
    frequencies: ["monthly", "quarterly", "yearly"],
    periodic: { monthsAfterEnd: 1, day: "last" },
    annual: { monthsAfterEnd: 3, day: "last" },
  },
  profitTax: null,
  caveats: [
    "De voorlopige aanslag vennootschapsbelasting wordt door de Belastingdienst opgelegd en in maandtermijnen geïnd — LaVega schat die niet, zet hem als handmatige reservering.",
    "Indicatieve momentopname; controleer bij de Belastingdienst.",
  ],
} as const satisfies TaxPack;

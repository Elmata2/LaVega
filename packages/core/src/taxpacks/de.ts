import type { TaxPack } from "./types.js";

/** Duitsland — the pack that exists because of a customer interview.
 *
 *  A German freelancer judged his income by what was in the bank, "thought he
 *  made more money than he actually did", and then got the bill: in Germany
 *  profit tax is PREPAID, and what the prepayments did not cover lands as a
 *  Nachzahlung right after the year is assessed. 1M profit → a quarter of a
 *  million due at the start of next year, out of money that had already felt
 *  like his. That is what `profitTax` below turns into a reservation and a
 *  forecast entry.
 *
 *  USt: 19 / 7 / 0. The Umsatzsteuer-Voranmeldung (monthly or quarterly) is due
 *  on the 10th of the following month (§18 UStG); the annual
 *  Umsatzsteuererklärung by 31 July of the following year.
 *
 *  Vorauszahlungen on profit tax fall on 10 March / 10 June / 10 September /
 *  10 December — the same four dates for Körperschaftsteuer (§37 KStG) and for
 *  Einkommensteuer (§37 EStG), so one pack serves the GmbH and the freelancer.
 *
 *  The rate is INDICATIVE and meant to be replaced: once the Finanzamt sends a
 *  Vorauszahlungsbescheid the owner enters that amount (`profitTaxManualCents`)
 *  and no estimate is used at all. */
export const DE_TAX_PACK = {
  country: "DE",
  label: "Duitsland",
  currency: "EUR",
  rulesAsOf: "2026-08-16",
  vat: {
    label: "USt",
    rates: [19, 7, 0],
    defaultRatePct: 19,
    frequencies: ["monthly", "quarterly", "yearly"],
    periodic: { monthsAfterEnd: 1, day: 10 },
    annual: { monthsAfterEnd: 7, day: "last" },
  },
  profitTax: {
    label: "Vorauszahlung",
    settlementLabel: "Nachzahlung",
    // 15% Körperschaftsteuer + 5,5% Solidaritätszuschlag over that (= 15,825%)
    // + Gewerbesteuer 3,5% × Hebesatz 400% (= 14%) ≈ 29,8%. Rounded to 30 so the
    // reservation errs high rather than low — the failure this pack exists to
    // prevent is reserving too little.
    defaultRatePct: 30,
    rateBasis: "15% KSt + 5,5% Soli daarover + Gewerbesteuer bij Hebesatz 400% ≈ 29,8% — afgerond op 30%.",
    prepayDates: ["03-10", "06-10", "09-10", "12-10"],
    what: "Duitsland laat winstbelasting vooruitbetalen op vier vaste data. Wat de vooruitbetalingen niet dekken, komt als Nachzahlung kort na afloop van het jaar — dat is het bedrag waar ondernemers op stuklopen.",
  },
  caveats: [
    "Het tarief is indicatief (rechtsvorm en Hebesatz verschillen per gemeente) — vul het bedrag van de Vorauszahlungsbescheid in zodra je die hebt.",
    "Dauerfristverlängerung (een maand uitstel voor de USt-Voranmeldung) is niet meegerekend.",
    "Indicatieve momentopname; controleer bij het Finanzamt.",
    /* Landneutraal, en daarom ook hier: het gaat over wat LaVega LEEST, niet
     * over Duits recht. De drie Nederlandse rechtsfiguren die in de NL-pack bij
     * de grensmodule staan (excessief lenen, pensioen in eigen beheer,
     * terbeschikkingstelling) staan hier bewust NIET — die zou deze pack niet
     * kunnen waarmaken. */
    "LaVega leest je bankrekeningen en je facturen. Wat er in je aangiftes of in je boekhouding staat, ziet het niet — ook een boekhoudbestand dat je hier importeert blijft één bestand in dit tabblad en is geen administratie.",
  ],
} as const satisfies TaxPack;

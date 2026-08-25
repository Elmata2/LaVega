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
    "Een btw-aangifte bevat correcties die LaVega niet ziet: privégebruik, de jaarlijkse correctie in Q4, de KOR en de margeregeling. Het bedrag hier is daardoor structureel te laag, in Q4 het meest.",
    "De voorlopige aanslag vennootschapsbelasting wordt door de Belastingdienst opgelegd en in maandtermijnen geïnd — LaVega schat die niet, zet hem als handmatige reservering.",
    "Indicatieve momentopname; controleer bij de Belastingdienst.",
    /* ── De grens tussen privé en zakelijk: wat de meting NIET is ───────────
     *
     * De module "Privé en zakelijk" meet overboekingen over de grens en zegt
     * verder niets. Deze vier regels staan erbij omdat de lijst anders niet te
     * beoordelen is: een meting zonder haar eigen buitenkant leest als een
     * volledig beeld. Ze staan in de PACK en niet in het scherm, zodat ze in de
     * bestaande "Niet berekend"-module terechtkomen zonder een tweede
     * mechanisme — precies waarvoor `caveats` bestaat.
     *
     * De eerste drie zijn NEDERLANDSE rechtsfiguren en horen daarom alleen hier;
     * de DE-pack mag ze niet claimen. De vierde staat in beide packs, want die
     * gaat over wat LaVega leest en niet over Nederlands recht. */
    "LaVega meet overboekingen tussen je ondernemingen en privé, maar rekent niets uit over de excessief-lenen-regeling: daarvoor is nodig wat je in totaal van je onderneming geleend hebt, en dat staat niet in je vault. Een lening die er al stond voordat je je eerste afschrift importeerde, heeft LaVega nooit gezien.",
    "Een pensioen in eigen beheer rekent LaVega niet uit: de opgebouwde aanspraak en de afspraak eronder staan niet in je transacties.",
    "Terbeschikkingstelling van een pand, een auto of een ander goed aan je eigen onderneming rekent LaVega niet: het ziet de betaling, niet de afspraak eronder.",
    "LaVega leest je bankrekeningen en je facturen. Wat er in je loonaangifte of in je boekhouding staat, ziet het niet — ook een boekhoudbestand dat je hier importeert blijft één bestand in dit tabblad en is geen administratie. Elk bedrag hier is dus gemeten aan wat er in je vault staat, niet aan wat er is aangegeven.",
  ],
} as const satisfies TaxPack;

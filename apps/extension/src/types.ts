/* De vormen die de extensie kent. Klein gehouden met opzet: alles wat hier niet
 * in staat, kan de extensie ook niet per ongeluk doorgeven. */

/** Een bedrag hoort bij een periode, en die twee worden nooit los van elkaar
 *  vervoerd. Een jaarprijs en een maandprijs door elkaar gebruiken is een
 *  factor twaalf, en dat is precies de fout die deze twee letters voorkomen. */
export type FeePeriod = "maand" | "jaar";

/** Een cijfer uit de catalogus met zijn herkomst eraan vast. `conditions` mag
 *  null zijn (dan stond er geen voorwaarde bij), maar sourceUrl en checkedAt
 *  horen er altijd te zijn — een cijfer zonder bron is aan een kassa niets
 *  waard, want de datum is het enige waarop de gebruiker kan afgaan.
 *
 *  `conditions` WORDT GELEZEN, en dat is geen detail: `leesVoorwaarden` in
 *  rank.ts bepaalt eraan of dit cijfer een kaal bedrag mag dragen. Een cijfer
 *  van 2% met "PAID IN CRO, not euro" in dit veld is geen euro-opbrengst. Toen
 *  dit veld alleen werd meegedragen en nergens gelezen, stond er "Dat levert
 *  € 80,00 op" boven precies zo'n cijfer. Vul het dus voluit of laat het null;
 *  een afgekapte voorwaarde is een andere voorwaarde. */
export type Sourced = {
  value: number;
  sourceUrl: string;
  checkedAt: string;
  conditions: string | null;
};

/** Wat het KOSTEN om de kaart te hebben — niet wat een aankoop erop kost. Dat
 *  onderscheid is de hele horizonregel. */
export type CardFee = Sourced & { period: FeePeriod };

export type CheckoutCard = {
  id: string;
  product: string;
  issuer: string;
  kind: string;
  /** Koersopslag bij betalen in een andere munt dan de euro. null = onbekend,
   *  nooit 0. */
  fxFeePct: Sourced | null;
  /** Cashback per bestede euro. null = onbekend, nooit 0. */
  cashbackPct: Sourced | null;
  /** Punten per bestede euro. Wordt GETOOND, nooit in euro's omgerekend. */
  pointsPerEuro: Sourced | null;
  /** Vaste kosten om de kaart te hebben, met periode. null = we weten het niet. */
  fee: CardFee | null;
};

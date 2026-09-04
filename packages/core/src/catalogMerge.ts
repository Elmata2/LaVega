import { isCovered, type CatalogField, type CatalogValue } from "./catalog.js";

/* HOE EEN SWEEP DE CATALOGUS BIJWERKT ZONDER HEM ARMER TE MAKEN.
 *
 * Dit stond in scripts/catalog-sweep.ts en staat nu hier, om twee redenen. Het
 * is puur en dus toetsbaar, en er waren twee schrijfpaden (--only en de volledige
 * run) waarvan er maar één samenvoegde. Het pad dat dat niet deed was juist het
 * pad dat niemand bekijkt.
 *
 * TWEE REGELS, en ze zijn allebei duur geleerd:
 *
 * 1. EEN VELD DAT EEN RUN NIET HEEFT GEMETEN, IS GEEN VELD DAT HIJ HEEFT
 *    WEERLEGD. Een volledige sweep stelt maar twee vragen (fxFeePct en
 *    interestPct), terwijl dezelfde producten inmiddels ook pointsPerEuro,
 *    cashbackPct en accountFee dragen — cijfers die met de hand en zonder model
 *    zijn gevonden. Het oude pad schreef de entries van de run integraal weg en
 *    zou daarmee 68 velden hebben gewist door niets verkeerd te doen.
 *
 * 2. EEN RUN DIE ZIJN WERK NIET KON DOEN MAG DE CATALOGUS NIET SLECHTER MAKEN.
 *    Gemeten: een run zonder API-sleutel verving ABN AMRO betaalpas — 1,2%,
 *    gedekt, uit het informatiedocument — door de 2% van de creditcardrij,
 *    geweigerd en met de datum van vandaag. Er kwam niets fouts in de app, want
 *    geweigerde cijfers worden niet geserveerd, maar een goed cijfer ging
 *    verloren aan een slechter. Die regel geldt PER VELD, niet per product; daar
 *    zat de fout.
 */

export type MergeEntry = {
  id: string;
  product: string;
  issuer?: string;
  kind?: string;
  fields: Partial<Record<CatalogField, CatalogValue>>;
};

export type MergeResult = {
  entries: MergeEntry[];
  /** Welke velden bewust zijn blijven staan, als "id.veld". Een stille overslag
   *  leest als "er is niets veranderd", terwijl er iets is tegengehouden. */
  kept: string[];
};

/** Voeg de resultaten van een run samen met wat er al lag.
 *
 *  `order` is de volgorde waarin producten in state.json staan, zodat de
 *  artefact-diff leesbaar blijft; een id dat daar niet in staat gaat achteraan. */
export function mergeCatalogEntries(
  prev: readonly MergeEntry[],
  rows: readonly MergeEntry[],
  order: readonly string[],
): MergeResult {
  const byId = new Map(prev.map((e) => [e.id, e]));
  const kept: string[] = [];

  const winners = rows.map((row) => {
    const before = byId.get(row.id);
    const fields: Partial<Record<CatalogField, CatalogValue>> = { ...before?.fields };
    for (const name of Object.keys(row.fields) as CatalogField[]) {
      const found = row.fields[name];
      if (isCovered(fields[name]) && !isCovered(found)) {
        kept.push(`${row.id}.${name}`);
        continue;
      }
      fields[name] = found;
    }
    return { ...row, fields };
  });

  const wonIds = new Set(winners.map((e) => e.id));
  const merged = [...prev.filter((e) => !wonIds.has(e.id)), ...winners];
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i === -1 ? order.length : i;
  };
  merged.sort((a, b) => rank(a.id) - rank(b.id));
  return { entries: merged, kept };
}

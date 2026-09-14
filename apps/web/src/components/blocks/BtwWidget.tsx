import { useMemo } from "react";
import type { Account, Invoice, Tx, VatPosition, VatSettings } from "@lavega/core";
import { resolveVatSettings, txsForEntity, vatPosition } from "@lavega/core";
import type { View } from "../../App";
import type { ModuleSpan } from "../../module-grid.js";
import { formatEuroIn } from "../../format.js";
import Module from "../Module.js";
import { useWidgetEnabled } from "../moduleRegistry";
import type { Locale } from "../../locale.js";
import { useAppLocale } from "../../appLocale.js";
import { moneyCopy } from "../../copy/money.js";

/* BTW op de startpagina — "doe default wel btw".
 *
 * Die zin is de reden dat deze kaart als enige NIEUWE widget standaard AAN staat
 * (moduleRegistry, `defaultOn`); de reden staat daar ook, want zonder die reden
 * leest het als een inconsequentie naast de facturenkaart ernaast.
 *
 * ── HET CIJFER KOMT NIET UIT DEZE KAART ───────────────────────────────────
 *
 * De positie wordt berekend door `vatPosition` in packages/core, met dezelfde
 * instellingen (`resolveVatSettings`) en dezelfde transacties (`txsForEntity`)
 * als het scherm Belasting. Die twee functies stonden tot nu toe ALS CODE in
 * Belasting.tsx en zijn naar core getild, niet gekopieerd: in deze repo is meer
 * dan eens een tweede kopie van dezelfde regel ontstaan die daarna uit elkaar
 * liep (de pakketmatcher, de vulregel van de bol), en juist deze regel bepaalt
 * de aangifteperiode. Twee schermen die op dezelfde dag een ander kwartaal
 * noemen is precies het soort verschil dat niemand meldt.
 *
 * Wat deze kaart dus wél zelf doet, is KIEZEN WAT ER GEZEGD WORDT — en dat is
 * per geval iets anders:
 *
 *  1. STELSEL ONBEKEND → GEEN BEDRAG. `vatPosition` valt in dat geval terug op
 *     de marge-benadering en levert wel degelijk een getal op, met een notitie
 *     erbij. Belasting heeft ruimte voor allebei; drie regels op een startpagina
 *     niet — daar zou het getal het antwoord lijken. En het is niet zomaar een
 *     zwakker getal: bij het factuurstelsel valt de btw in de periode van de
 *     FACTUUR en bij het kasstelsel in die van de BETALING, dus zolang die keuze
 *     open staat is zelfs de PERIODE waar het getal bij hoort niet vastgesteld.
 *     Zelf een stelsel kiezen als standaard is geen optie: dat verandert het
 *     bedrag op grond van een aanname.
 *  2. DEKKING ONVOLLEDIG → het bedrag mag, mét hoeveel facturen er geen
 *     btw-bedrag noemen en waar het getal dan wél vandaan komt.
 *  3. EEN GEWONE POSITIE → bedrag, periode, richting, deadline.
 *
 * ── MEERDERE ONDERNEMINGEN: ÉÉN, NIET DE SOM ──────────────────────────────
 *
 * Belasting zet ze onder elkaar; een kaart van een paar regels kan dat niet. De
 * keuze is: ÉÉN onderneming tonen — die waar iets speelt — met het aantal
 * andere erbij, en doorklikken naar Belasting voor de rest.
 *
 * Optellen zou fout zijn, en niet een beetje. Ondernemingen kunnen een ander
 * STELSEL en een andere AANGIFTEFREQUENTIE hebben, dus een som loopt over
 * verschillende perioden en er hoort dan geen enkele periode bij het bedrag —
 * terwijl deze kaart nu juist moet zeggen over welke periode het gaat. En zodra
 * één onderneming geen bedrag heeft (stelsel onbekend, gemengde tarieven, geen
 * transacties) telt die in een som stilzwijgend voor nul mee. Onbekend is geen
 * nul, en een totaal kan die afwezigheid niet dragen.
 *
 * ── WAT DEZE KAART NIET KAN ZIEN ──────────────────────────────────────────
 *
 * Belasting kan zijn eigen boekhouding als basis gebruiken (een CSV die hij daar
 * inleest). Die import blijft bewust in dat tabblad en wordt nergens bewaard —
 * echte omzetcijfers horen niet in gewone localStorage. Deze kaart krijgt hem
 * dus niet, en kan één tree lager op de ladder uitkomen dan Belasting op dat
 * moment toont. Allebei noemen hun bron, dus geen van beide liegt. */

export type BtwRow = {
  entity: string;
  position: VatPosition;
  /** Mag het bedrag op de startpagina staan? Zie punt 1 hierboven: bij een
   *  onbekend stelsel niet, ook al heeft `vatPosition` een benadering. */
  amountShown: boolean;
  /** Waar deze onderneming in de rij staat; 0 is het meest urgent. */
  rank: number;
};

/** Volgorde van urgentie, en dat is bewust dezelfde volgorde als de volgorde van
 *  eerlijkheid: een antwoord dat LaVega NIET kan geven omdat er één keuze
 *  ontbreekt, gaat vóór een bedrag dat het wél kan geven. Die keuze is één klik
 *  en verandert het bedrag; het bedrag zelf staat een scherm verderop. */
function rankOf(position: VatPosition, amountShown: boolean): number {
  if (position.note === "stelsel-onbekend") return 0;
  if (amountShown) return position.direction === "betalen" ? 1 : 2;
  return 3;
}

export type BtwRowsInput = {
  entities: readonly string[];
  txs: readonly Tx[];
  accounts: readonly Account[];
  asOf: string;
  vatSettings: readonly VatSettings[];
  invoices?: readonly Invoice[];
  country?: string;
};

/** De btw-positie van elke onderneming in beeld, meest urgent eerst. Puur:
 *  `asOf` komt binnen, er wordt niets geklokt. */
export function btwRows({
  entities,
  txs,
  accounts,
  asOf,
  vatSettings,
  invoices,
  country,
}: BtwRowsInput): BtwRow[] {
  const saved = new Map(vatSettings.map((s) => [s.entity, s]));
  return entities
    .map((entity) => {
      const settings = resolveVatSettings({ entity, saved: saved.get(entity), country });
      const position = vatPosition({
        txs: txsForEntity(txs, accounts, entity),
        settings,
        asOf,
        // `figures` ontbreekt met opzet — zie de kop van dit bestand.
        invoices,
      });
      const amountShown = position.netCents !== null && position.note !== "stelsel-onbekend";
      return { entity, position, amountShown, rank: rankOf(position, amountShown) };
    })
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      if (a.position.period.deadline !== b.position.period.deadline) {
        return a.position.period.deadline.localeCompare(b.position.period.deadline);
      }
      return a.entity.localeCompare(b.entity, "nl");
    });
}

/** Waarom er geen bedrag staat, of wat er aan het bedrag mankeert. Eén zin, en
 *  die noemt de oorzaak — nooit advies dat in deze toestand niet kan werken.
 *
 *  De lange versies staan in Belasting (`noteText`); dit zijn de korte. De
 *  switch is uitputtend over `VatNote`, dus een nieuwe notitie is hier een
 *  compileerfout. */
function shortNote(row: BtwRow, locale: Locale = "nl"): string | null {
  const c = moneyCopy[locale].btw;
  const { position: p, entity } = row;
  const missing = p.coverage.total - p.coverage.withVat;
  /* Dezelfde reden als in Belasting.tsx: een 0 zonder te zeggen dat zijn factuur
   * in een ander tijdvak staat, is niet te beoordelen. De kaart heeft één regel,
   * dus hij noemt alleen het aantal en niet de datum. */
  const buiten = p.coverage.outside;
  /* ALS ER NIETS TE MELDEN IS MAAR ER WEL FACTUREN BUITEN HET TIJDVAK STAAN, is
   * dat het nuttigste dat de kaart kan zeggen. Zonder deze regel las hij een kale
   * 0 en kon hij niet zien of die klopte. */
  if (p.note === null && buiten > 0 && p.coverage.total === 0) {
    return buiten === 1 ? c.note.geenFactuurEnkele(entity) : c.note.geenFactuurMeerdere(entity, buiten);
  }

  switch (p.note) {
    case null:
      return null;
    case "stelsel-onbekend":
      return c.note.stelselOnbekend(entity);
    case "btw-onbekend-op-facturen":
      return c.note.btwOnbekendOpFacturen(missing, p.coverage.total);
    case "gemengde-tarieven":
      return c.note.gemengdeTarieven;
    case "kasstelsel":
      return c.note.kasstelsel;
    case "omzetfacturen-onbekend":
      return c.note.omzetfacturenOnbekend;
    case "voorbelasting-onbekend":
      return c.note.voorbelastingOnbekend;
    case "boekhouding-andere-periode":
      return c.note.boekhoudingAnderePeriode;
    case "geen-banktransacties":
      return c.note.geenBanktransacties(entity);
  }
}

export type BtwBlockProps = {
  /** De ondernemingen die dit scherm toont — dezelfde lijst die Belasting krijgt. */
  entities: readonly string[];
  txs: readonly Tx[];
  accounts: readonly Account[];
  asOf: string;
  vatSettings: readonly VatSettings[];
  invoices?: readonly Invoice[];
  /** Het land uit het profiel; onbekend valt terug op het standaardland. */
  country?: string;
  span?: ModuleSpan;
  onNavigate: (view: View) => void;
};

export function BtwBlock({
  entities,
  txs,
  accounts,
  asOf,
  vatSettings,
  invoices,
  country,
  span,
  onNavigate,
}: BtwBlockProps) {
  const [locale] = useAppLocale();
  const c = moneyCopy[locale].btw;
  const rows = useMemo(
    () => btwRows({ entities, txs, accounts, asOf, vatSettings, invoices, country }),
    [entities, txs, accounts, asOf, vatSettings, invoices, country],
  );

  // Geen onderneming in beeld = geen btw-positie. Een kaart die dat als "geen
  // bedrag" opschrijft is een leeg blok met een uitleg eromheen.
  if (rows.length === 0) return null;

  const row = rows[0];
  const others = rows.length - 1;
  const { position: p } = row;
  const note = shortNote(row, locale);

  return (
    <Module
      title="BTW"
      span={span}
      height="short"
      menu={
        <button type="button" className="card-link" onClick={() => onNavigate("belasting")}>
          {c.belastingArrow}
        </button>
      }
      footer={
        <>
          {row.amountShown && c.bronPrefix(c.shortBasis[p.basis])}
          {p.vatLabel}
          {c.regelsPer(p.rulesAsOf)}
          {others > 0 && c.nogNAndereOnderneming(others)}
        </>
      }
    >
      <div className="module-figure">
        <span
          className={`module-figure-value ${!row.amountShown ? "" : p.direction === "terugvragen" ? "text-pos" : "text-neg"}`}
        >
          {row.amountShown ? formatEuroIn(locale, Math.abs(p.netCents as number) / 100) : c.geenBedrag}
        </span>
        {row.amountShown && <span className="figure-vs">{c.direction[p.direction]}</span>}
      </div>

      <p className="module-figure-label">
        {/* De onderneming staat er alleen bij als er meer dan één in beeld is:
            bij één zou hij op elke regel hetzelfde zeggen. */}
        {rows.length > 1 && c.entiteitPrefix(row.entity)}
        {p.period.periodLabel} · {c.uiterlijk(p.period.deadline)}
        {p.stage === "loopt" ? c.looptNogTm(p.period.periodEnd) : ""}
      </p>

      {note && <p className="cell-sub">{note}</p>}
    </Module>
  );
}

/** De kaart zoals de startpagina hem hoort te plaatsen: zichzelf als de widget
 *  aan staat, en niets als hij uit staat. Zelfde patroon als `PositieWidget`;
 *  de gesloten variant is ook de default-export, zodat Overzicht via de
 *  gewone import meteen de schakelbare kaart krijgt. */
export function BtwWidget(props: BtwBlockProps) {
  return useWidgetEnabled("btw-stand") ? <BtwBlock {...props} /> : null;
}

export default BtwWidget;

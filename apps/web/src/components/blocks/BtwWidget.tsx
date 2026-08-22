import { useMemo } from "react";
import type { Account, Invoice, Tx, VatBasis, VatPosition, VatSettings } from "@lavega/core";
import { resolveVatSettings, txsForEntity, vatPosition } from "@lavega/core";
import type { View } from "../../App";
import type { ModuleSpan } from "../../module-grid.js";
import { formatEuro } from "../../format.js";
import Module from "../Module.js";
import { useWidgetEnabled } from "../moduleRegistry";

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

/** Korte bronnamen. De volledige zinnen staan in Belasting (`BASIS_LABEL`); dit
 *  zijn de korte vormen van dezelfde `VatBasis`, en omdat het een `Record` over
 *  die union is, is een nieuwe bron hier een compileerfout in plaats van een
 *  stilzwijgend gat. */
const SHORT_BASIS: Record<VatBasis, string> = {
  manual: "je eigen bedrag",
  sheet: "je boekhouding",
  invoices: "je facturen",
  proxy: "een marge-benadering uit je banktransacties",
};

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
export function btwRows({ entities, txs, accounts, asOf, vatSettings, invoices, country }: BtwRowsInput): BtwRow[] {
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
function shortNote(row: BtwRow): string | null {
  const { position: p, entity } = row;
  const missing = p.coverage.total - p.coverage.withVat;
  switch (p.note) {
    case null:
      return null;
    case "stelsel-onbekend":
      return `Voor ${entity} is niet gekozen tussen factuurstelsel en kasstelsel. Bij het factuurstelsel valt de btw in de periode van de factuur, bij het kasstelsel in die van de betaling — dat scheelt echt geld, dus LaVega noemt hier geen bedrag. Het stelsel kies je bij Belasting.`;
    case "btw-onbekend-op-facturen":
      return `Van ${missing} van de ${p.coverage.total} facturen in deze periode is het btw-bedrag onbekend, dus je facturen zijn hier niet de basis.`;
    case "gemengde-tarieven":
      return "Gemengde tarieven: LaVega rekent hier niets uit en zet ook geen nul.";
    case "kasstelsel":
      return "Kasstelsel: de btw valt in de periode van de betaling, niet van de factuur, dus je facturen zijn hier niet de basis.";
    case "omzetfacturen-onbekend":
      return "In deze periode staan alleen inkoopfacturen; wat er aan btw over je omzet tegenover staat, ziet LaVega niet.";
    case "voorbelasting-onbekend":
      return "Geen inkoopfactuur met een btw-bedrag in deze periode, dus de voorbelasting is onbekend.";
    case "boekhouding-andere-periode":
      return "Je geïmporteerde boekhouding dekt deze periode niet volledig, dus LaVega gebruikt hem niet half.";
    case "geen-banktransacties":
      return `LaVega ziet geen transacties van ${entity} in deze periode. Dat is geen nul: er is niets om een bedrag uit te lezen.`;
  }
}

const DIRECTION_WORD: Record<VatPosition["direction"], string> = {
  betalen: "te betalen",
  terugvragen: "terug te vragen",
  onbekend: "richting onbekend",
};

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
  const note = shortNote(row);

  return (
    <Module
      title="BTW"
      span={span}
      height="short"
      menu={
        <button type="button" className="card-link" onClick={() => onNavigate("belasting")}>
          Belasting →
        </button>
      }
      footer={
        <>
          {row.amountShown && `Bron: ${SHORT_BASIS[p.basis]}. `}
          {p.vatLabel} · regels per {p.rulesAsOf}.
          {others > 0 && (
            <>
              {" "}
              Nog {others} andere onderneming{others === 1 ? "" : "en"} — Belasting toont ze apart. LaVega telt ze hier
              niet bij elkaar op: ze kunnen een ander stelsel en een andere aangifteperiode hebben, en dan hoort er bij
              die som geen periode.
            </>
          )}
        </>
      }
    >
      <div className="module-figure">
        <span className={`module-figure-value ${!row.amountShown ? "" : p.direction === "terugvragen" ? "text-pos" : "text-neg"}`}>
          {row.amountShown ? formatEuro(Math.abs(p.netCents as number) / 100) : "geen bedrag"}
        </span>
        {row.amountShown && <span className="figure-vs">{DIRECTION_WORD[p.direction]}</span>}
      </div>

      <p className="module-figure-label">
        {/* De onderneming staat er alleen bij als er meer dan één in beeld is:
            bij één zou hij op elke regel hetzelfde zeggen. */}
        {rows.length > 1 && `${row.entity} · `}
        {p.period.periodLabel} · uiterlijk {p.period.deadline}
        {p.stage === "loopt" ? ` · loopt nog t/m ${p.period.periodEnd}` : ""}
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

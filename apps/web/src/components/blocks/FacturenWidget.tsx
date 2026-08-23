import { useMemo } from "react";
import type { Invoice } from "@lavega/core";
import type { View } from "../../App";
import type { ModuleSpan } from "../../module-grid.js";
import { formatEuro } from "../../format.js";
import Module from "../Module.js";
import { useWidgetEnabled } from "../moduleRegistry";

/* Facturen op de startpagina — "dan moet de factuur ook in het overzicht komen,
 * als de gebruiker dat wilt".
 *
 * Die tweede helft is de reden dat deze kaart standaard UIT staat
 * (moduleRegistry, `defaultOn`). Wat de kaart zegt is drie dingen en niet meer:
 * hoeveel facturen er open staan, welk bedrag daarmee gemoeid is, en wat er over
 * zijn vervaldatum heen is. De rest van het verhaal — wie, welk nummer, welke
 * bron — staat op Facturen, en daar linkt de kaart naartoe.
 *
 * DRIE DINGEN DIE DEZE KAART NADRUKKELIJK NIET DOET:
 *
 *  - AR EN AP OPTELLEN. Een inkomende factuur (`direction: "in"`, geld dat
 *    komt) en een uitgaande (geld dat gaat) tot één "openstaand bedrag"
 *    optellen levert een getal op dat geen van beide vragen beantwoordt. De twee
 *    kanten staan daarom op hun eigen regel, en de grote figuur is een AANTAL —
 *    het enige getal dat over beide kanten tegelijk waar is.
 *
 *  - EEN VREEMDE VALUTA ALS EURO'S TELLEN. Een factuur draagt zijn eigen
 *    valuta. Wat niet in euro's staat (of waar de valuta ontbreekt) zit niet in
 *    het bedrag, en de kaart zegt hoeveel dat er zijn. Onbekend is geen euro.
 *
 *  - EEN LEEG BLOK TONEN. Kent LaVega binnen deze scope geen enkele factuur, dan
 *    is er niets te zeggen en staat de kaart er niet. Zijn ze er wél en staat er
 *    niets meer open, dan is dat een ANTWOORD ("niets staat open") en geen
 *    afwezigheid — dat is de keerzijde van de regel: een uitgesproken nul is een
 *    bekende nul. */

/** Eén kant van de administratie: te ontvangen (AR) of te betalen (AP). */
export type InvoiceSide = {
  /** Openstaande facturen aan deze kant. */
  count: number;
  /** Daarvan met een bedrag in euro's — alleen die zitten in `eurTotal`. */
  eurCount: number;
  /** Som van die euro-facturen, in hele euro's (bruto, altijd positief). */
  eurTotal: number;
  /** Openstaand én over de vervaldatum heen. */
  lateCount: number;
  lateEurCount: number;
  lateEurTotal: number;
};

export type FacturenSummary = {
  /** Facturen binnen deze scope, open of niet. 0 = LaVega kent er geen. */
  inScope: number;
  /** Daarvan nog open (`status: "expected"`) — dezelfde definitie die
   *  `scheduledInvoiceFlows` gebruikt om ze in de forecast te zetten. */
  open: number;
  ontvangen: InvoiceSide;
  betalen: InvoiceSide;
  /** Openstaande facturen zonder bedrag in euro's, over beide kanten. */
  zonderEuroBedrag: number;
};

function emptySide(): InvoiceSide {
  return { count: 0, eurCount: 0, eurTotal: 0, lateCount: 0, lateEurCount: 0, lateEurTotal: 0 };
}

/** Staat deze factuur in euro's? Een lege of onleesbare valuta is ONBEKEND en
 *  wordt hier dus niet als euro geteld — Facturen weigert zo'n regel al bij het
 *  invoeren, en wat er ondanks dat toch staat mag geen bedrag opblazen. */
function isEuro(invoice: Invoice): boolean {
  return (invoice.currency ?? "").trim().toUpperCase() === "EUR";
}

/**
 * Wat er open staat, binnen de ondernemingen die dit scherm laat zien.
 *
 * `entities` is de lijst waar de rest van de startpagina op gefilterd is. Is die
 * LEEG, dan bestaat de dimensie hier niet (geen enkele rekening in beeld draagt
 * een onderneming — de zelfstandige zonder entiteiten) en telt elke factuur mee.
 * Filteren tegen een lege lijst zou alles wegfilteren en "niets staat open"
 * opleveren: een conclusie die het ontbreken van entiteiten niet kan dragen.
 *
 * Puur: `asOf` bepaalt wat te laat is, nooit de klok.
 */
export function openInvoiceSummary(
  invoices: readonly Invoice[],
  entities: readonly string[],
  asOf: string,
): FacturenSummary {
  const scope = new Set(entities);
  const mine = invoices.filter((i) => scope.size === 0 || scope.has(i.entity));
  const summary: FacturenSummary = {
    inScope: mine.length,
    open: 0,
    ontvangen: emptySide(),
    betalen: emptySide(),
    zonderEuroBedrag: 0,
  };

  for (const invoice of mine) {
    if (invoice.status !== "expected") continue;
    summary.open++;
    const side = invoice.direction === "in" ? summary.ontvangen : summary.betalen;
    const late = invoice.dueDate < asOf;
    const euro = isEuro(invoice);
    const amount = Math.abs(invoice.amount);

    side.count++;
    if (late) side.lateCount++;
    if (!euro) {
      summary.zonderEuroBedrag++;
      continue;
    }
    side.eurCount++;
    side.eurTotal += amount;
    if (late) {
      side.lateEurCount++;
      side.lateEurTotal += amount;
    }
  }

  return summary;
}

/** Eén regel per kant, en alleen voor een kant waar iets staat. Een kant zonder
 *  facturen krijgt geen "€ 0": dat zou een bedrag suggereren dat gemeten is. */
function SideRow({ label, side }: { label: string; side: InvoiceSide }) {
  if (side.count === 0) return null;
  return (
    <div className="entity-row">
      <span className="entity-row-name">
        {label} · {side.count} factu{side.count === 1 ? "ur" : "ren"}
      </span>
      <span className="entity-row-balance">
        {side.eurCount === 0 ? "bedrag onbekend" : formatEuro(side.eurTotal)}
      </span>
    </div>
  );
}

/** De zin over wat te laat is. Per kant, want "€ 5.000 te laat" waarin geld dat
 *  binnenkomt en geld dat weggaat bij elkaar geteld zijn, is geen bedrag dat
 *  ergens over gaat. */
function lateSentence(s: FacturenSummary): string | null {
  const total = s.ontvangen.lateCount + s.betalen.lateCount;
  if (total === 0) return null;
  const parts: string[] = [];
  if (s.ontvangen.lateEurCount > 0) parts.push(`${formatEuro(s.ontvangen.lateEurTotal)} te ontvangen`);
  if (s.betalen.lateEurCount > 0) parts.push(`${formatEuro(s.betalen.lateEurTotal)} te betalen`);
  const bedragen = parts.length > 0 ? `: ${parts.join(", ")}` : "";
  return `${total} factu${total === 1 ? "ur is" : "ren zijn"} over de vervaldatum${bedragen}.`;
}

export type FacturenBlockProps = {
  /** Alle facturen; deze kaart snijdt zelf op `entities`. */
  invoices: readonly Invoice[];
  /** De ondernemingen die dit scherm toont — leeg = geen enkele scope. */
  entities: readonly string[];
  /** Vandaag, ISO. Een vervaldatum ervóór is te laat. */
  asOf: string;
  span?: ModuleSpan;
  onNavigate: (view: View) => void;
};

export function FacturenBlock({ invoices, entities, asOf, span, onNavigate }: FacturenBlockProps) {
  const s = useMemo(() => openInvoiceSummary(invoices, entities, asOf), [invoices, entities, asOf]);

  // Geen enkele factuur in beeld: dan heeft deze kaart niets te melden en staat
  // hij er niet. Hij vroeg eerder al om geen lege blokken.
  if (s.inScope === 0) return null;

  const late = lateSentence(s);

  return (
    <Module
      title="Facturen"
      span={span}
      height="short"
      menu={
        <button type="button" className="card-link" onClick={() => onNavigate("facturen")}>
          Facturen →
        </button>
      }
      footer={
        s.zonderEuroBedrag > 0 ? (
          <>
            Van {s.zonderEuroBedrag} factu{s.zonderEuroBedrag === 1 ? "ur" : "ren"} is het bedrag niet in euro&apos;s
            bekend; {s.zonderEuroBedrag === 1 ? "die zit" : "die zitten"} niet in de bedragen hierboven.
          </>
        ) : undefined
      }
    >
      {s.open === 0 ? (
        /* Een UITGESPROKEN nul: er zijn facturen, en geen enkele staat nog
           open. Dat is iets anders dan niets weten, en mag dus gezegd worden. */
        <p className="module-figure-label">
          Niets staat open — alle {s.inScope} factu{s.inScope === 1 ? "ur" : "ren"} die LaVega kent zijn betaald of
          vervallen.
        </p>
      ) : (
        <>
          <div className="module-figure">
            <span className="module-figure-value">{s.open}</span>
            <span className="figure-vs">openstaand</span>
          </div>
          <p className="module-figure-label">{late ?? "Geen enkele openstaande factuur is over zijn vervaldatum."}</p>
          <div className="entity-rows">
            <SideRow label="Te ontvangen" side={s.ontvangen} />
            <SideRow label="Te betalen" side={s.betalen} />
          </div>
        </>
      )}
    </Module>
  );
}

/** De kaart zoals de startpagina hem hoort te plaatsen: zichzelf als de widget
 *  aan staat, en HELEMAAL NIETS als hij uit staat — geen lege kaart en geen
 *  briefje waar de schakelaar zit. Zelfde patroon als `PositieWidget`.
 *
 *  De gesloten variant is ook de default-export, om de reden die in
 *  BetaalschemaBlock staat: Overzicht importeert de default, en dan schakelt de
 *  schakelaar vanaf de eerste render echt iets. */
export function FacturenWidget(props: FacturenBlockProps) {
  return useWidgetEnabled("facturen-open") ? <FacturenBlock {...props} /> : null;
}

export default FacturenWidget;

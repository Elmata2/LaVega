import { useMemo, useState } from "react";
import type { ScheduledFlow, Tx } from "@lavega/core";
import { detectScheduleStreams } from "@lavega/core";
import { formatEuro, monthShortNL } from "../../format.js";
import Module from "../Module.js";
import { useWidgetEnabled } from "../moduleRegistry";
import { daysBetween, shiftDate } from "./dates.js";

/* Betaalagenda — the reference's "Payment schedule": what is due next, with a
 * date tile per row.
 *
 * Two sources, and the row says which:
 *
 *  - PLANNED flows the app already keeps (BTW reservations, expected invoices,
 *    manual items). These are dates someone committed to.
 *  - RECURRING flows core detected in the transaction history
 *    (detectScheduleStreams: a party paid — or paying — at a steady cadence with
 *    a repeating amount). Their next date is the last occurrence rolled forward
 *    by the detected cadence. That is a PREDICTION, not a commitment, so it is
 *    labelled as one and carries the cadence that produced it — never mixed in
 *    silently with the confirmed rows.
 *
 * The detector is `detectScheduleStreams`, NOT the forecast's
 * `detectRecurringStreams` this block used until 20 Aug 2026. Measured, on the
 * shapes a Dutch export actually produces (app review 2, item 5): the forecast's
 * detector groups on the verbatim counterparty, so one Simyo incasso written
 * three ways became three streams of one and never appeared; and it rejects a
 * stream that skipped a cycle, so a failed incasso in June deleted the whole
 * subscription. It also never merged "DUO", "DUO Groningen" and "Dienst
 * Uitvoering Onderwijs". An INCOMING recurring stream belongs on this agenda
 * exactly as much as an outgoing one — DUO paying him is a date he can count on.
 *
 * LaVega never pays anything, so there is no action here — only the date, the
 * amount, where the row came from and whether it is late. */

const ROWS = 6;

/** How far ahead the agenda looks. A recurring stream repeats forever; past a
 *  quarter the list stops being an agenda and becomes a subscription report. */
const HORIZON_DAYS = 92;

/** Dutch label for a flow's status. `paid`/`cancelled` never reach the list. */
const STATUS_LABEL: Record<ScheduledFlow["status"], string> = {
  expected: "verwacht",
  confirmed: "bevestigd",
  paid: "betaald",
  cancelled: "vervallen",
};

/** How a detected cadence reads in Dutch. Covers every cadence
 *  `detectScheduleStreams` can return, plus the two short ones an older stream
 *  may still carry. */
export function cadenceLabel(days: number): string {
  if (days === 7) return "wekelijks";
  if (days === 14) return "elke 2 weken";
  if (days === 30) return "maandelijks";
  if (days === 61) return "tweemaandelijks";
  if (days === 91) return "elk kwartaal";
  if (days === 182) return "halfjaarlijks";
  if (days === 365) return "jaarlijks";
  return `elke ${days} dagen`;
}

export type AgendaRow = {
  id: string;
  date: string;
  label: string;
  /** Signed euros: negative is money out. */
  amount: number;
  note: string;
  /** A detected pattern rather than a committed date. */
  predicted: boolean;
};

/** The next occurrence of a stream on or after `asOf`, rolled forward from its
 *  last observed date by the detected cadence. */
export function nextOccurrence(lastDate: string, cadenceDays: number, asOf: string): string {
  const behind = daysBetween(lastDate, asOf);
  if (behind <= 0) return shiftDate(lastDate, cadenceDays);
  const steps = Math.ceil(behind / cadenceDays) || 1;
  return shiftDate(lastDate, steps * cadenceDays);
}

/** Planned flows and detected recurring payments, merged and sorted by date.
 *  Pure — `asOf` decides what is late, never the clock. */
export function agendaRows(scheduledFlows: ScheduledFlow[], txs: Tx[], asOf: string, limit = ROWS): AgendaRow[] {
  const planned: AgendaRow[] = scheduledFlows
    .filter((f) => f.status !== "paid" && f.status !== "cancelled")
    .map((f) => ({
      id: `flow:${f.id}`,
      date: f.dueDate,
      label: f.label,
      amount: (f.sign * f.amountCents) / 100,
      note: `${f.entity ? `${f.entity} · ` : ""}${STATUS_LABEL[f.status]}`,
      predicted: false,
    }));

  const horizon = shiftDate(asOf, HORIZON_DAYS);
  const recurring: AgendaRow[] = detectScheduleStreams(txs, { asOf })
    .map((s) => ({ s, date: nextOccurrence(s.lastDate, s.cadenceDays, asOf) }))
    .filter(({ date }) => date <= horizon)
    .map(({ s, date }) => ({
      id: `stream:${s.key}`,
      date,
      label: s.label,
      amount: (s.sign * s.amountCents) / 100,
      note: `${cadenceLabel(s.cadenceDays)} · ${s.occurrences}× gezien`,
      predicted: true,
    }));

  return [...planned, ...recurring]
    .sort((a, b) => (a.date === b.date ? a.label.localeCompare(b.label) : a.date.localeCompare(b.date)))
    .slice(0, limit);
}

type BetaalschemaBlockProps = {
  scheduledFlows: ScheduledFlow[];
  /** Needed for the recurring detection; the same list Overzicht already has. */
  txs: Tx[];
  /** Today, ISO — a date before it makes a row overdue. */
  asOf: string;
};

export function BetaalschemaBlock({ scheduledFlows, txs, asOf }: BetaalschemaBlockProps) {
  const upcoming = useMemo(() => agendaRows(scheduledFlows, txs, asOf), [scheduledFlows, txs, asOf]);
  const overdueCount = upcoming.filter((r) => r.date < asOf).length;
  const predictedCount = upcoming.filter((r) => r.predicted).length;
  /* De rij die OPEN staat, en waarom dat een toestand is en geen tooltip.
   *
   * REVIEW 4, PUNT 7 — EERST GEMETEN, EN DE UITKOMST IS DEELS EEN NEE. Hij noemde
   * zelf drie mogelijke oorzaken van "V…"; alle drie zijn nagerekend:
   *
   *  - Een verkeerde AFKAPFUNCTIE: nee. Er wordt in code niets afgekapt. De test
   *    hiernaast rendert zijn eigen voorbeeld en vindt de hele naam letterlijk
   *    terug, zonder ellips.
   *  - Een verkeerd VELD: nee, niet voor dit geval. `scheduleParty` geeft de
   *    tegenpartij verbatim terug (of de naam van een herkende instantie), en
   *    "B Steunenberg en/of mevr. A L Dimitrova" komt er ook zo uit.
   *  - Een te SMALLE KOLOM: ja, maar niet zó smal. De Betaalagenda is één kolom
   *    in een raster van drie, en dan blijft er op 1280 px ±196 px over voor de
   *    naam — ongeveer 27 tekens, op een telefoon (één kolom, 375 px) een stuk of
   *    twintig. Het afkappen is dus echt, en het is CSS.
   *
   * Eén letter volgt uit geen van de drie, en dat wordt hier niet weggeschreven
   * als "waarschijnlijk toch de kolom". Wat er precies op zijn scherm stond is uit
   * deze code niet te reproduceren; wat er WEL reproduceerbaar misgaat is een
   * lange naam die afkapt zonder dat je de rest ooit te zien krijgt, plus de pil
   * hieronder. Daarvoor is dit gebouwd. Blijft er een naam over die na deze
   * ingreep nog steeds onleesbaar is, dan is de meting hierboven het beginpunt en
   * niet een afgesloten zaak.
   *
   * Een breder blok is daarom wél een oorzaak maar niet de oplossing: elke naam
   * kan langer zijn dan elke kolom. De volle naam moet BEREIKBAAR zijn, en op
   * drie manieren, want op een telefoon bestaat hover niet — dat heeft hij in
   * review 3 punt 8 al gezegd en het is daar op dezelfde manier opgelost
   * (`.spend-pie-name` in charts.css): muis (:hover), toetsenbord
   * (:focus-visible) en tik (data-open). Een title-attribuut blijft eronder
   * liggen voor wie met de muis wacht, maar draagt de belofte niet alleen. */
  const [open, setOpen] = useState<string | null>(null);

  return (
    <Module
      title="Betaalagenda"
      height="tall"
      footer={
        upcoming.length > 0 ? (
          <>
            {overdueCount > 0 && `${overdueCount} datum${overdueCount === 1 ? "" : "s"} al verstreken. `}
            {predictedCount > 0
              ? `${predictedCount} regel${predictedCount === 1 ? "" : "s"} voorspeld uit je eigen geschiedenis, niet bevestigd.`
              : "Alle regels zijn ingeplande bedragen."}
          </>
        ) : undefined
      }
    >
      {upcoming.length === 0 ? (
        <p className="block-empty">
          Niets ingepland — hier komen je BTW-reserveringen, openstaande facturen en herkende vaste lasten te staan.
        </p>
      ) : (
        <div className="pay-list">
          {upcoming.map((r) => {
            const overdue = r.date < asOf;
            const isOpen = open === r.id;
            return (
              /* De hele rij is de knop, niet alleen de naam: hij vroeg om te
                 kunnen hoveren "boven op die transactie", en een naam van drie
                 tekens is een doel dat je op een telefoon niet raakt. Elke rij
                 is een knop, ook een korte naam die nergens afgekapt wordt —
                 welke naam past hangt van de vensterbreedte af en die kan dit
                 component niet meten, dus één gedrag voor alle rijen is het
                 enige dat niet soms liegt. */
              <button
                type="button"
                className="pay-row"
                key={r.id}
                data-open={isOpen ? "on" : "off"}
                aria-expanded={isOpen}
                onClick={() => setOpen((cur) => (cur === r.id ? null : r.id))}
              >
                <span className={`pay-date ${overdue ? "pay-date-overdue" : ""}`} aria-hidden="true">
                  <span className="pay-date-day">{r.date.slice(8, 10)}</span>
                  <span className="pay-date-month">{monthShortNL(r.date)}</span>
                </span>
                <span className="pay-info">
                  <span className="pay-label">
                    {/* De naam staat in een eigen span, en dat is niet
                        cosmetisch: het afkappen zat op hetzelfde vakje als de
                        "voorspeld"-pil, dus bij een lange naam viel die pil
                        buiten het zichtbare deel en zag een voorspelde regel
                        eruit als een bevestigde. Nu kapt alleen de naam af en
                        houdt de pil zijn eigen plek. */}
                    <span className="pay-name" title={r.label}>
                      {r.label}
                    </span>
                    {r.predicted && <span className="pay-tag">voorspeld</span>}
                  </span>
                  <span className="eyebrow pay-meta">
                    {r.date} · {r.note}
                    {overdue ? " · te laat" : ""}
                  </span>
                </span>
                <span className={`pay-amount ${r.amount >= 0 ? "text-pos" : "text-neg"}`}>{formatEuro(r.amount)}</span>
              </button>
            );
          })}
        </div>
      )}
    </Module>
  );
}

/** De Betaalagenda als SCHAKELBARE kaart (review 4, punt 8) — zelfde patroon als
 *  `AandachtWidget` en `PositieWidget`: het blok weet niets van de voorkeur, de
 *  wrapper leest hem en laat de kaart weg. */
export function BetaalschemaWidget(props: BetaalschemaBlockProps) {
  return useWidgetEnabled("betaalagenda") ? <BetaalschemaBlock {...props} /> : null;
}

/** ...en die wrapper is hier ook de DEFAULT export, anders dan bij Aandacht en
 *  Positie. Dat is geen slordigheid maar de les van commit f4ee5fb: die twee
 *  kregen hun schakelaar in één lane en hun wrapper werd in een ANDERE lane in
 *  Overzicht gezet, dus tussendoor stond er een schakelaar in Profiel die niets
 *  deed en een zin eronder die niet waar was. Overzicht.tsx hoort bij geen enkele
 *  lane; de import daar is `import BetaalschemaBlock from "./BetaalschemaBlock"`,
 *  en door de gesloten variant op die naam te zetten schakelt de schakelaar vanaf
 *  de eerste render echt iets. Wie Overzicht later omzet naar de expliciete
 *  `BetaalschemaWidget` krijgt precies hetzelfde component. */
export default BetaalschemaWidget;

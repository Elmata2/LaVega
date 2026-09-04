import { useState } from "react";
import type { RewardProgram, RewardsBalance, TrackedStatus, TrackingState } from "@lavega/core";
import {
  makeRewardsBalance,
  REWARD_PROGRAMS,
  rewardsTracked,
  trackingStatuses,
  applyRewardsReply,
  snoozeTracker,
  parseBalanceReply,
  norm,
} from "@lavega/core";
import { formatEuro } from "../format";
import "../styles/views.css";

/* Punten — the hand-kept side of the money picture.
 *
 * What this screen may and may not claim:
 *   - It knows ONE thing about a balance: the number the owner typed, and when.
 *     Every figure is therefore labelled with the date it was confirmed, and the
 *     screen says out loud that nothing here is fetched from the programme.
 *   - It does NOT price points. A Membership Rewards point has no single honest
 *     value — 0,5 cent as a statement credit, several cents through a transfer
 *     partner — so an "indicatieve waarde" was removed once for inventing
 *     precision and is not coming back. Where the unit genuinely IS euros
 *     (bunq's cashback), the balance is its own value and is shown as euros.
 *     Nowhere else does a euro sign appear.
 *   - It never sums across programmes. Avios plus Bonvoy is not a number.
 */

/** Write a balance over the row with the same id, or append it.
 *
 *  A new figure replaces the FIGURE, not the row. Everything the owner set
 *  himself on that row — the reminder interval, his note — is carried over,
 *  because `makeRewardsBalance` only ever produces programme/points/date and a
 *  plain replace therefore silently reset his interval to the 90-day default.
 *  A user-entered fact outranks a default. The one field deliberately dropped
 *  is `snoozedUntil`: "vraag me later" is a question, and a fresh figure has
 *  just answered it (same reasoning as `applyRewardsReply` in core). */
export function upsertBalance(list: RewardsBalance[], b: RewardsBalance): RewardsBalance[] {
  const i = list.findIndex((x) => x.id === b.id);
  if (i === -1) return [...list, b];
  const next = [...list];
  const { snoozedUntil: _answered, ...kept } = list[i];
  next[i] = { ...kept, ...b };
  return next;
}

/* ---------------------------------------------------------------------------
 * ING PUNTEN — een programma met regels, zonder koers.
 *
 * Waarom dit hier staat en niet in REWARD_PROGRAMS (core): dat was tijdens deze
 * run een bestand van een andere lane. De weerlegde core-regel
 * { name: "ING", note: "ING NL heeft geen puntenprogramma" } is inmiddels WEG —
 * rewards.ts draagt nu ING_NOTE met de echte drempels, het citaat uit de
 * voorwaarden en de bron erbij, en er staan tests op die de note tegen
 * docs/research/2026-08-20-punten-koersen.md leggen in plaats van tegen
 * zichzelf. Deze lijst en die note mogen dus samengevoegd worden; dat is
 * opruimwerk en geen correctie meer.
 *
 * Wat we van ING weten (bron: ING's eigen pagemodel-API achter
 * ing.nl/particulier/ing-punten/zo-spaar-je-ing-punten, opgehaald 21-08-2026,
 * plus de Voorwaarden ING Punten geldig vanaf 01-10-2025 —
 * docs/research/2026-08-20-punten-koersen.md):
 *
 *   - Er is GEEN koers per bestede euro. ING beloont drempels: "meer dan € 100
 *     uitgeven" geeft 250 punten bij € 100 én bij € 4.000. Delen door de drempel
 *     levert 2,5 punt per euro op — een koers die niet bestaat en die bij normaal
 *     gebruik een factor 40 te hoog uitvalt. `pointsPerEuro` blijft dus leeg en
 *     op het scherm staan de regels zelf, in ING's eigen woorden.
 *   - Aan de inwisselkant zegt ING het zelf: "ING Punten hebben geen geldwaarde.
 *     Je kan je ING Punten niet inwisselen voor geld." Dat is een UITGESPROKEN
 *     nul, met bron en datum, en dus iets anders dan onbekend. Hij staat er als
 *     nul: "in geld: niets".
 *   - Wat een punt aan korting waard is in de ING Winkel is NIET openbaar (die
 *     winkel zit achter Mijn ING). Dat is onbekend, en het staat er als onbekend.
 *   - De Platinumcard staat niet in ING's tabel. Of die onder een van de regels
 *     valt is niet vastgesteld: geen regel, en ook geen nul.
 *
 * Daarom komt er bij ING nergens een euro-bedrag op het scherm. De euro's die je
 * hieronder ziet staan zijn ING's eigen DREMPELS (€ 700 instroom, € 100
 * besteding) — een voorwaarde om punten te krijgen, geen waarde van een punt.
 * De test in views/Punten.test.tsx pint dat verschil vast.
 * ------------------------------------------------------------------------- */

/** Eén verdienregel zoals de aanbieder hem publiceert: een voorwaarde en wat je
 *  ervoor krijgt. Geen koers, geen omrekening. */
export type EarnRule = { what: string; reward: string };

export type ProgramFacts = {
  /** Canonieke programmanaam; de rij-id is norm(name). */
  program: string;
  /** Wat je moet doen en wat je krijgt — letterlijk de tabel van de aanbieder. */
  earn: readonly EarnRule[];
  /** Opslag per pakket, in de bewoordingen van de aanbieder. */
  packages: readonly string[];
  /** Waarom er geen koers per euro staat. */
  noRate: string;
  /** Dezelfde mededeling in één regel, voor de plek waar de uitleg nog dicht
   *  staat. Apart veld en geen afkapping van `noRate`: een halve zin over een
   *  koers die niet bestaat is precies de zin die verkeerd wordt gelezen. */
  noRateShort: string;
  /** De geldkant. `stated-none` = de aanbieder zegt zélf dat er geen geldwaarde
   *  is; dat is een bekende nul, met bron en datum, en geen "onbekend". */
  cash: { kind: "stated-none"; quote: string; source: string; validFrom: string };
  /** Wat niet is vastgesteld, met de reden erbij. Nooit als nul opgeschreven. */
  unknowns: readonly string[];
  /** Voorbehoud van de aanbieder zelf. */
  caveat: string;
  /** Herkomst als tekst. Geen link en geen <a>: er valt niets op te halen. */
  sources: readonly string[];
};

const ING_PUNTEN: ProgramFacts = {
  program: "ING Punten",
  earn: [
    {
      what: "Elke maand minimaal € 700 bijschrijven op je Betaalrekening",
      reward: "250 punten per maand",
    },
    { what: "10 transacties met je Betaalrekening", reward: "100 punten per maand" },
    {
      what: "Meer dan € 100 uitgeven met je ING Creditcard Extra of Max",
      reward: "250 punten per maand",
    },
    {
      what: "Meer dan € 100 uitgeven met je ING (studenten) Creditcard More",
      reward: "100 punten per maand",
    },
    { what: "Rond af & Spaar actief gebruiken", reward: "100 punten per maand" },
    { what: "Een hypotheek hebben", reward: "250 punten per maand" },
    { what: "Je eerste Betaalrekening openen", reward: "2.500 punten, eenmalig" },
    { what: "Je eerste Oranje Spaarrekening openen", reward: "500 punten, eenmalig" },
    { what: "Je creditcard aan je wallet toevoegen", reward: "100 punten, eenmalig" },
  ],
  packages: [
    "ING Go: het aantal hierboven",
    "ING More: 10% meer punten",
    "ING Extra: 20% meer punten",
    "ING Max: 30% meer punten",
  ],
  noRate:
    "Er is geen aantal punten per bestede euro. “Meer dan € 100 uitgeven” levert bij € 100 evenveel punten op als bij € 4.000: het is een drempel, geen tarief. Door die drempel delen zou een koers opleveren die niet bestaat, dus die staat hier niet.",
  // "per bestede euro" en niet "per euro": de test hieronder verbiedt die twee
  // woorden naast elkaar in dit hele object, ook in een ontkenning. Bot, maar
  // terecht — de regex kan geen ontkenning lezen, en één ontsnapping erin maakt
  // hem waardeloos voor de zin die er ooit wél een koers van maakt.
  noRateShort: "Geen koers per bestede euro: ING beloont drempels per maand, niet wat je uitgeeft.",
  cash: {
    kind: "stated-none",
    quote:
      "ING Punten hebben geen geldwaarde. Je kan je ING Punten niet inwisselen voor geld en niet overdragen aan anderen.",
    source: "Voorwaarden ING Punten",
    validFrom: "1 oktober 2025",
  },
  unknowns: [
    "Wat een punt aan korting oplevert in de ING Winkel maakt ING niet openbaar. Dat cijfer is onbekend — niet nul.",
    "De ING Platinumcard staat niet in ING's tabel. Of je daarmee punten spaart, is niet vastgesteld: er staat hierboven geen regel voor, en ook geen nul.",
  ],
  caveat: "ING schrijft erbij dat zij het aantal punten per bankzaak bepalen en kunnen wijzigen.",
  sources: [
    "ing.nl/particulier/ing-punten/zo-spaar-je-ing-punten, opgehaald op 21 augustus 2026",
    "Voorwaarden ING Punten, geldig vanaf 1 oktober 2025",
  ],
};

/** Programma's die deze view kent en core (nog) niet. Zie de kop hierboven. */
export const EXTRA_PROGRAMS: readonly RewardProgram[] = [
  { name: ING_PUNTEN.program, category: "Bank" },
];

/** Alles wat deze view over programma's weet: core eerst, daarna wat deze view
 *  zelf kent, zonder dubbele namen. Dit is de OPZOEKLIJST — categorie, eenheid,
 *  de note van core — en hij blijft compleet, ook voor namen die niet meer te
 *  kiezen zijn (zie `PICK_PROGRAMS`). Een saldo dat ooit onder "ING" is
 *  opgeslagen houdt zo zijn categorie in plaats van als "eigen programma" te
 *  gaan lezen. */
export const ALL_PROGRAMS: readonly RewardProgram[] = [
  ...REWARD_PROGRAMS,
  ...EXTRA_PROGRAMS.filter((e) => !REWARD_PROGRAMS.some((r) => norm(r.name) === norm(e.name))),
];

/** TWEE KEER ING IN ÉÉN KEUZELIJST, en dat is wat hij zag.
 *
 *  Gemeten op 21 augustus, met een lege puntenlijst: de keuzelijst bood zowel
 *  "ING" (de losse regel uit core) als "ING Punten" (de regel met de
 *  gepubliceerde verdienregels) aan. Wie de eerste koos, kreeg een rij zonder
 *  regels en zonder bron — dezelfde naam, het slechtere antwoord. De note die
 *  core sinds 20 augustus bij "ING" draagt lost dat niet op, want die note wordt
 *  nergens afgedrukt: `programUnit` leest hem alleen om te zien of er "cashback
 *  in euro" in staat.
 *
 *  Waarom de core-regel hier wegvalt en niet in core zelf: die note gáát sinds
 *  gisteren over ING Punten — hij noemt de drempels en citeert de voorwaarden —
 *  dus de twee regels beschrijven aantoonbaar hetzelfde programma. Dat is de
 *  toets die hieronder staat, en het is een toets op de INHOUD en niet alleen op
 *  de naam: zodra core's "ING" ooit weer over iets anders gaat (een
 *  cashbackactie), verandert die note en komt de regel vanzelf terug in de
 *  keuzelijst. `rewards.ts` is deze run van een andere lane, dus opruimen doen we
 *  hier; verdwijnt de dubbele regel daar, dan valt dit filter droog en kan het
 *  weg zonder dat er iets aan het scherm verandert. */
function describesFacts(p: RewardProgram): boolean {
  return EXTRA_PROGRAMS.some(
    (e) => norm(e.name) !== norm(p.name) && (p.note ?? "").includes(e.name),
  );
}

/** De lijst waaruit hij KIEST: elk programma één keer. */
export const PICK_PROGRAMS: readonly RewardProgram[] = ALL_PROGRAMS.filter(
  (p) => !describesFacts(p),
);

/** De gepubliceerde regels van dit programma, of null als we ze niet hebben.
 *  Matcht alleen op de canonieke naam: de losse core-regel "ING" kan iets anders
 *  zijn (cashback, een actie), en daar de puntenregels bij zetten zou een claim
 *  zijn over het verkeerde ding. */
export function programFacts(program: string): ProgramFacts | null {
  return norm(program) === norm(ING_PUNTEN.program) ? ING_PUNTEN : null;
}

/** De waarde-regel onder het saldo. Drie verschillende zinnen, omdat het drie
 *  verschillende situaties zijn: euro's (het bedrag is de waarde), een bekende
 *  nul aan de geldkant (de aanbieder zegt het zelf, met bron), en onbekend. */
export function worthLine(program: string, unit: "eur" | "points"): string {
  if (unit === "eur") {
    return "Waarde: dit bedrag zelf — dit programma keert uit in euro's, er zit geen omrekening tussen.";
  }
  const facts = programFacts(program);
  if (facts) {
    return (
      `In geld: niets. ${facts.cash.source} (geldig vanaf ${facts.cash.validFrom}): “${facts.cash.quote}”` +
      " Wat één punt aan korting oplevert, is niet gepubliceerd: dat is onbekend en niet nul."
    );
  }
  return "Waarde: niet vast te stellen zonder te weten waarvoor je ze inwisselt.";
}

/** De gepubliceerde regels, uitgeschreven. Alles wat hier een euroteken heeft is
 *  een DREMPEL van de aanbieder; er staat nergens wat een punt waard is.
 *
 *  OPGEVOUWEN, met het antwoord op de vouw. Negen verdienregels, vier pakketten,
 *  twee onbekenden en twee bronnen: als dat allemaal openstaat leest de kaart als
 *  een voorwaardendocument in plaats van als een saldo (app review 4, het thema
 *  boven alle punten). Wat NIET meevouwt is de mededeling zelf — "geen koers per
 *  euro" staat in de samenvatting, want dat is het antwoord op zijn vraag en niet
 *  de onderbouwing ervan. De onderbouwing blijft volledig en één klik weg; dicht
 *  staat ze nog steeds in de DOM, dus ctrl-F en een schermlezer vinden haar. */
function ProgramFactsBlock({ facts }: { facts: ProgramFacts }) {
  return (
    <details className="field-note punt-facts">
      <summary className="punt-facts-lead" style={{ cursor: "pointer" }}>
        <strong>Zo spaar je {facts.program}.</strong> {facts.noRateShort}{" "}
        <span className="eyebrow">Toon de regels</span>
      </summary>
      <p style={{ margin: "0.5rem 0 0" }}>{facts.noRate}</p>
      <ul className="punt-facts-earn" style={{ margin: "0.5rem 0", paddingLeft: "1.1rem" }}>
        {facts.earn.map((r) => (
          <li key={r.what}>
            {r.what}: {r.reward}
          </li>
        ))}
      </ul>
      <p style={{ margin: "0.5rem 0" }}>
        Pakket: {facts.packages.join(" · ")}. {facts.caveat}
      </p>
      {facts.unknowns.map((u) => (
        <p key={u} style={{ margin: "0.5rem 0" }}>
          {u}
        </p>
      ))}
      <p className="eyebrow" style={{ margin: "0.5rem 0 0" }}>
        Bron: {facts.sources.join(" — ")}
      </p>
    </details>
  );
}

/** What one unit of this programme IS. "eur" only for programmes the reference
 *  list documents as paying out in euros — then the balance is the value, with
 *  no rate and no conversion in between. Everything else is "points", which this
 *  screen refuses to price. An unknown programme name is points, never euros:
 *  guessing the other way would put a euro sign on a number that has none. */
export function programUnit(program: string): "eur" | "points" {
  const p = ALL_PROGRAMS.find((r) => norm(r.name) === norm(program));
  return p && /cashback in euro/i.test(p.note ?? "") ? "eur" : "points";
}

/** The reference list's category ("Airline", "Hotel", …), or null for a
 *  programme the owner typed himself — we don't invent one for it. */
export function programCategory(program: string): string | null {
  return ALL_PROGRAMS.find((r) => norm(r.name) === norm(program))?.category ?? null;
}

/* ---------------------------------------------------------------------------
 * ALLE PROGRAMMA'S OP HET SCHERM — waarom dit blok er is.
 *
 * "Waarom staan de ING-punten er niet?" (app review 4, punt 29 — en het is de
 * derde keer dat ING terugkomt). Gemeten voordat er iets veranderde: met een
 * lege puntenlijst kwam het woord ING op dit scherm NERGENS voor. Niet omdat het
 * programma ontbrak — het stond in de keuzelijst, zelfs twee keer — maar omdat
 * de keuzelijst een <datalist> is. Die is onzichtbaar tot je in het veld begint
 * te typen, en dit scherm toonde verder alleen kaarten voor saldi die hij al had
 * ingevoerd. Een programma zonder saldo bestond dus visueel niet, en "ik zie het
 * niet" is dan een juiste waarneming en geen vergissing van hem.
 *
 * Dit blok zet die lijst op het scherm: elk programma dat LaVega kent, met zijn
 * saldo als hij er een heeft en met "nog geen saldo" als hij er geen heeft. Dat
 * antwoordt in één keer op punt 29 (ING is er, en je kunt hem hier kiezen) en op
 * punt 30 (toon Amex en alle andere punten).
 *
 * WAT ER NIET STAAT IS EEN NUL. "Nog geen saldo" is een lege plek, geen 0
 * punten; de eerste is waar en de tweede zou een bewering zijn over een rekening
 * die we nooit hebben gezien.
 * ------------------------------------------------------------------------- */

export type RosterRow = {
  name: string;
  /** "Bank", "Airline", … of "eigen programma" voor iets dat hij zelf typte. */
  category: string;
  unit: "eur" | "points";
  /** Zijn eigen ingevoerde saldo, of null — nooit een nul die daarvoor doorgaat. */
  balance: RewardsBalance | null;
  /** Eén regel over de koers, alleen waar we er een hebben. Null = we hebben
   *  hier niets te melden, en dan staat er ook niets. */
  rateNote: string | null;
};

/** Wat er over de koers van dit programma te zeggen valt in één regel.
 *
 *  Drie uitkomsten en niet meer: gepubliceerde regels (dan staat er waarom er
 *  geen koers per euro is), een programma dat in euro's uitkeert (dan is het
 *  saldo de waarde), en verder niets. Die laatste is bewust leeg: dezelfde zin
 *  ("wat een punt waard is hangt af van hoe je hem inwisselt") acht keer onder
 *  elkaar is geen informatie meer, en hij staat één keer boven de lijst. */
function rateNoteFor(program: string, unit: "eur" | "points"): string | null {
  const facts = programFacts(program);
  if (facts) return facts.noRateShort;
  return unit === "eur" ? "Keert uit in euro's; het saldo is de waarde." : null;
}

/** De lijst zoals hij op het scherm komt: eerst de programma's waar hij een
 *  saldo van heeft, dan de rest in de volgorde van de referentielijst. Programma's
 *  die hij zelf heeft getypt staan er ook bij — anders zou "alle programma's" een
 *  lijst zijn die zijn eigen invoer weglaat.
 *
 *  Geen `asOf` en geen statusberekening hier: dit blok zegt WAT er is en van
 *  wanneer, de kaarten hierboven zeggen wat er moet gebeuren. Twee keer dezelfde
 *  aanmaning op één scherm maakt geen van beide dringender. */
export function programRoster(balances: readonly RewardsBalance[]): RosterRow[] {
  const byId = new Map(balances.map((b) => [b.id, b]));
  const row = (name: string, category: string, balance: RewardsBalance | null): RosterRow => {
    const unit = programUnit(name);
    return { name, category, unit, balance, rateNote: rateNoteFor(name, unit) };
  };
  const listed = PICK_PROGRAMS.map((p) => row(p.name, p.category, byId.get(norm(p.name)) ?? null));
  const listedIds = new Set(PICK_PROGRAMS.map((p) => norm(p.name)));
  const own = balances
    .filter((b) => !listedIds.has(b.id))
    .map((b) => row(b.program, programCategory(b.program) ?? "eigen programma", b));
  const all = [...listed, ...own];
  return [...all.filter((r) => r.balance !== null), ...all.filter((r) => r.balance === null)];
}

/** Het cijfer in de regel, met de DATUM eraan vast.
 *
 *  Een saldo zonder datum is niet half zo goed als een saldo met datum, het is
 *  iets anders: niemand kan zien of het van gisteren of van vorig jaar is. Dat
 *  wordt straks nog belangrijker — het idee is dat de extensie deze getallen
 *  gebruikt en af en toe om een verversing vraagt, en "af en toe" heeft een
 *  ijkpunt nodig. */
export function rosterFigure(r: RosterRow): string {
  if (r.balance === null) return "nog geen saldo";
  const amount =
    r.unit === "eur"
      ? `${formatEuro(r.balance.points)} cashback`
      : `${r.balance.points.toLocaleString("nl-NL")} ${r.balance.points === 1 ? "punt" : "punten"}`;
  return `${amount} — van ${dateNL(r.balance.updatedAt)}`;
}

/** A programme id (a normalised name, so it carries spaces) turned into
 *  something legal in an HTML id attribute. */
const slug = (s: string): string => s.replace(/[^a-z0-9]+/gi, "-");

export function addDaysISO(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

const MONTHS_NL = [
  "januari",
  "februari",
  "maart",
  "april",
  "mei",
  "juni",
  "juli",
  "augustus",
  "september",
  "oktober",
  "november",
  "december",
];

/** "2026-05-12" → "12 mei 2026". */
export function dateNL(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return MONTHS_NL[m - 1] ? `${d} ${MONTHS_NL[m - 1]} ${y}` : iso;
}

export type PuntenRow = { balance: RewardsBalance; status: TrackedStatus; unit: "eur" | "points" };

/** Rows in the order they deserve attention: over time first, then due, then
 *  snoozed, then fresh; within a state the oldest number first, ties by name so
 *  the list never reshuffles on its own. */
const STATE_RANK: Record<TrackingState, number> = { overdue: 0, due: 1, snoozed: 2, fresh: 3 };

export function puntenRows(balances: readonly RewardsBalance[], asOf: string): PuntenRow[] {
  const statuses = trackingStatuses(rewardsTracked(balances), asOf); // index-aligned with balances
  return balances
    .map((balance, i) => ({ balance, status: statuses[i], unit: programUnit(balance.program) }))
    .sort(
      (a, b) =>
        STATE_RANK[a.status.state] - STATE_RANK[b.status.state] ||
        b.status.ageDays - a.status.ageDays ||
        a.status.label.localeCompare(b.status.label, "nl"),
    );
}

const STATE_LABEL: Record<TrackingState, string> = {
  fresh: "actueel",
  due: "bevestigen",
  overdue: "verouderd",
  snoozed: "later",
};

/** How old the number is, in the owner's words — never a claim about the real
 *  balance today, only about when he last confirmed it. */
function ageSentence(s: TrackedStatus): string {
  const age =
    s.ageDays === 0
      ? "vandaag ingevoerd"
      : `${s.ageDays} ${s.ageDays === 1 ? "dag" : "dagen"} geleden ingevoerd`;
  if (s.state === "fresh")
    return `${age}. LaVega vraagt hier vanaf ${dateNL(s.dueDate)} weer naar.`;
  if (s.state === "snoozed")
    return `${age}. Je vroeg om later — LaVega vraagt weer vanaf ${dateNL(s.snoozedUntil ?? s.dueDate)}.`;
  if (s.state === "overdue")
    return `${age}, ${s.daysOverdue} ${s.daysOverdue === 1 ? "dag" : "dagen"} over de afgesproken termijn.`;
  return `${age}. Tijd om te bevestigen.`;
}

const INTERVALS: { days: number; label: string }[] = [
  { days: 30, label: "elke maand" },
  { days: 90, label: "elk kwartaal" },
  { days: 180, label: "elk half jaar" },
  { days: 365, label: "elk jaar" },
];

export default function Punten({
  balances,
  asOf,
  busy,
  onSave,
}: {
  balances: RewardsBalance[];
  asOf: string;
  busy: boolean;
  onSave: (next: RewardsBalance[]) => void;
}) {
  const [program, setProgram] = useState(REWARD_PROGRAMS[0].name);
  const [points, setPoints] = useState("");
  const [updatedAt, setUpdatedAt] = useState(asOf);
  const [addError, setAddError] = useState("");
  // The one row whose "wat staat er nu?" box is open.
  const [ask, setAsk] = useState<{ id: string; text: string; error: string } | null>(null);
  /* The row "Verwijder" just took away, kept so it can come back. These figures
   * exist nowhere else — nothing fetches them, he typed them — so a single
   * mis-click next to the reminder dropdown must not be the end of one. An undo
   * rather than a confirm dialog: the click keeps working, and the way back is
   * one click too. Dropped the moment he writes a figure himself, so the undo can
   * never put an old number back over a newer one. */
  const [removed, setRemoved] = useState<RewardsBalance | null>(null);

  const rows = puntenRows(balances, asOf);
  const attention = rows.filter(
    (r) => r.status.state === "due" || r.status.state === "overdue",
  ).length;
  const addUnit = programUnit(program);
  // De regels van het programma waar dit formulier nú op gericht staat, zodat hij
  // ze ziet vóórdat hij een getal opslaat en niet pas op de kaart erna.
  const addFacts = programFacts(program);
  /* The row this form is currently aimed at, if it already exists. The id IS the
   * normalised programme name, so saving would write straight over that row —
   * and the field is pre-filled (with the first reference programme on a fresh
   * mount). A number typed into a form he did not re-aim used to replace a
   * balance he entered weeks ago without a word: the loss reported on 20-08.
   * So the form says which figure it is about to replace, and the button stops
   * calling it "Opslaan". */
  const existing = balances.find((b) => b.id === norm(program));

  function add() {
    const pts = parseBalanceReply(points);
    if (pts === null || pts < 0) {
      setAddError(
        "Ik kon hier geen getal in vinden — vul alleen het saldo in, bijvoorbeeld 245000 of 245k.",
      );
      return;
    }
    if (!program.trim()) {
      setAddError(
        "Bij welk programma hoort dit saldo? Kies of typ een programma — anders weet ik niet waar dit getal thuishoort.",
      );
      return;
    }
    if (!updatedAt) {
      setAddError("Vul de datum in waarop je dit saldo zag.");
      return;
    }
    setAddError("");
    setRemoved(null);
    onSave(
      upsertBalance(
        balances,
        makeRewardsBalance({ program: program.trim(), points: Math.round(pts), updatedAt }),
      ),
    );
    setPoints("");
    // Leave the form aimed at nothing. Keeping the programme he just saved here
    // is what turned the next number he typed into an overwrite of it.
    setProgram("");
  }

  function remove(id: string) {
    setRemoved(balances.find((b) => b.id === id) ?? null);
    onSave(balances.filter((b) => b.id !== id));
  }

  /** Put the removed row back exactly as it was — interval, note and all. */
  function undoRemove() {
    if (removed === null) return;
    const back = removed;
    setRemoved(null);
    onSave(upsertBalance(balances, back));
  }

  function submitAsk(id: string) {
    const next = applyRewardsReply(balances, id, ask?.text ?? "", asOf);
    if (next === null) {
      setAsk({
        id,
        text: ask?.text ?? "",
        error: "Ik kon daar geen enkel getal in vinden — stuur alleen het saldo.",
      });
      return;
    }
    setAsk(null);
    setRemoved(null);
    onSave(next);
  }

  function changeInterval(id: string, days: number) {
    onSave(balances.map((b) => (b.id === id ? { ...b, intervalDays: days } : b)));
  }

  return (
    <section className="card" aria-label="Punten">
      <div className="view-head">
        <h2>Punten</h2>
        {/* SALDI TELLEN, GEEN PROGRAMMA'S. Dit getal telt de rijen waar hij een
            cijfer van heeft ingevoerd, en zolang dat de enige lijst op het scherm
            was, was "programma's" daar het goede woord voor. Sinds de
            programmalijst eronder staat is het dat niet meer: "0 programma's"
            stond boven een scherm dat er tien opsomde, en dan is een van de twee
            fout. Wat er wordt geteld, staat er nu ook. */}
        <span className="eyebrow">
          {rows.length} {rows.length === 1 ? "saldo" : "saldi"}
          {attention > 0 ? ` · ${attention} te bevestigen` : ""}
        </span>
      </div>
      {/* GEEN INLEIDING EN GEEN WAAROM-BLOK MEER, op zijn verzoek (22 augustus).
          Er stond een alinea over wat LaVega hier NIET doet en een uitklap over
          waarom er geen euro-waarde is. Allebei waar, allebei weg: het scherm
          begint nu bij het saldo.

          Wat NIET is meeverdwenen en ook niet mag: bij ING Punten staat op de
          programmaregel zelf waarom daar geen koers per euro is. Dat is geen
          uitleg over het scherm maar een eigenschap van dat programma, en zonder
          die zin zou een lege plek als een ontbrekend cijfer lezen. */}

      {rows.length === 0 ? (
        <div className="empty-guide">
          <p>Nog geen punten- of cashback-saldi.</p>
          <ul>
            <li>Zoek het saldo op in de app of de mail van het programma zelf.</li>
            <li>Voeg het hieronder toe met de datum waarop je het zag.</li>
            <li>
              LaVega vraagt je daarna elk kwartaal om het te bevestigen — dat interval kun je per
              programma aanpassen.
            </li>
          </ul>
        </div>
      ) : (
        <div className="punt-list">
          {rows.map(({ balance: b, status, unit }) => {
            const category = programCategory(b.program);
            const facts = programFacts(b.program);
            const asking = ask && ask.id === b.id ? ask : null;
            return (
              <article className={`punt-card punt-${status.state}`} key={b.id}>
                <header className="punt-head">
                  <div className="punt-id">
                    <div className="punt-program">{b.program}</div>
                    <div className="punt-category">{category ?? "eigen programma"}</div>
                  </div>
                  <span className={`badge punt-badge-${status.state}`}>
                    {STATE_LABEL[status.state]}
                  </span>
                </header>

                <div className="punt-figure">
                  <span className="punt-value">
                    {unit === "eur" ? formatEuro(b.points) : b.points.toLocaleString("nl-NL")}
                  </span>
                  <span className="punt-unit">{unit === "eur" ? "cashback" : "punten"}</span>
                </div>
                <p className="punt-asof">
                  Stand van {dateNL(b.updatedAt)} — {ageSentence(status)}
                </p>
                <p className="punt-worth">{worthLine(b.program, unit)}</p>
                {facts ? <ProgramFactsBlock facts={facts} /> : null}

                {asking ? (
                  <div className="punt-ask">
                    <label htmlFor={`punt-ask-${slug(b.id)}`}>{status.question}</label>
                    <div className="punt-ask-row">
                      <input
                        id={`punt-ask-${slug(b.id)}`}
                        className="saldo-input"
                        inputMode="decimal"
                        placeholder={unit === "eur" ? "bijv. 42" : "bijv. 245000"}
                        value={asking.text}
                        disabled={busy}
                        onChange={(e) => setAsk({ id: b.id, text: e.target.value, error: "" })}
                      />
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={busy}
                        onClick={() => submitAsk(b.id)}
                      >
                        Opslaan
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={busy}
                        onClick={() => setAsk(null)}
                      >
                        Annuleer
                      </button>
                    </div>
                    {asking.error ? <p className="punt-error">{asking.error}</p> : null}
                  </div>
                ) : null}

                <footer className="punt-actions">
                  {!asking && (
                    <button
                      type="button"
                      className="card-link"
                      disabled={busy}
                      onClick={() => setAsk({ id: b.id, text: "", error: "" })}
                    >
                      Saldo bijwerken
                    </button>
                  )}
                  {(status.state === "due" || status.state === "overdue") && (
                    <button
                      type="button"
                      className="card-link"
                      disabled={busy}
                      onClick={() => onSave(snoozeTracker(balances, b.id, addDaysISO(asOf, 30)))}
                    >
                      Niet nu
                    </button>
                  )}
                  <label className="punt-interval">
                    <span className="eyebrow">Vraag me</span>
                    <select
                      aria-label={`Herinnering ${b.program}`}
                      value={String(b.intervalDays ?? 90)}
                      disabled={busy}
                      onChange={(e) => changeInterval(b.id, Number(e.target.value))}
                    >
                      {INTERVALS.map((i) => (
                        <option key={i.days} value={String(i.days)}>
                          {i.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="card-link card-link-danger"
                    disabled={busy}
                    onClick={() => remove(b.id)}
                  >
                    Verwijder
                  </button>
                </footer>
              </article>
            );
          })}
        </div>
      )}

      {removed ? (
        <p className="field-note punt-undo" role="status">
          <strong>{removed.program}</strong> is verwijderd —{" "}
          {programUnit(removed.program) === "eur"
            ? `${formatEuro(removed.points)} cashback`
            : `${removed.points.toLocaleString("nl-NL")} punten`}{" "}
          van {dateNL(removed.updatedAt)}. Dat getal stond alleen hier.{" "}
          <button type="button" className="card-link" disabled={busy} onClick={undoRemove}>
            Zet terug
          </button>
        </p>
      ) : null}

      <div className="view-head">
        <h3>Saldo toevoegen</h3>
        <span className="eyebrow">of een bestaand programma overschrijven</span>
      </div>
      <div className="stack-form punt-form">
        <div className="stack-form-row">
          <label>
            Programma
            <input
              list="reward-programs"
              value={program}
              disabled={busy}
              aria-label="Programma"
              placeholder="bijv. Marriott Bonvoy"
              onChange={(e) => setProgram(e.target.value)}
            />
            {/* PICK_PROGRAMS en niet ALL_PROGRAMS: elk programma één keer. Zie
                daar waarom core's losse "ING" hier niet meer bij staat. */}
            <datalist id="reward-programs">
              {PICK_PROGRAMS.map((p) => (
                <option key={p.name} value={p.name} />
              ))}
            </datalist>
          </label>
          <label>
            {addUnit === "eur" ? "Cashback in hele euro's" : "Punten"}
            <input
              className="saldo-input"
              inputMode="decimal"
              value={points}
              disabled={busy}
              aria-label={addUnit === "eur" ? "Cashback in hele euro's" : "Punten"}
              placeholder={addUnit === "eur" ? "bijv. 42" : "bijv. 245000"}
              onChange={(e) => setPoints(e.target.value)}
            />
          </label>
          <label>
            Gezien op
            <input
              type="date"
              value={updatedAt}
              disabled={busy}
              aria-label="Bijgewerkt op"
              onChange={(e) => setUpdatedAt(e.target.value)}
            />
          </label>
        </div>
        {addFacts ? <ProgramFactsBlock facts={addFacts} /> : null}
        {/* "ING" is uit de keuzelijst verdwenen (zie PICK_PROGRAMS), maar hij kan
            het nog steeds typen — en het is precies wat je typt als je ING Punten
            zoekt. Dan levert opslaan een rij zonder verdienregels op, met een
            eigen id, náást ING Punten. Deze wijzer kan hier wél werken: de optie
            staat één veld hoger in dezelfde lijst. */}
        {norm(program) === "ing" ? (
          <p className="field-note">
            Spaar je ING Punten? Kies dan <strong>ING Punten</strong> in het veld hierboven — daar
            staan de verdienregels van ING bij. Wat “ING” zelf bijhoudt, weet LaVega niet.
          </p>
        ) : null}
        {existing ? (
          <p className="field-note punt-overwrite">
            <strong>{existing.program}</strong> staat al in de lijst:{" "}
            {programUnit(existing.program) === "eur"
              ? `${formatEuro(existing.points)} cashback`
              : `${existing.points.toLocaleString("nl-NL")} punten`}{" "}
            van {dateNL(existing.updatedAt)}. Overschrijven zet jouw nieuwe getal daarvoor in de
            plaats — dat oude saldo is er dan niet meer. Je herinnering blijft wel staan. Wil je een
            ander programma toevoegen, verander dan eerst het veld hierboven.
          </p>
        ) : null}
        <div className="stack-form-actions">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={add}>
            {existing ? "Overschrijven" : "Opslaan"}
          </button>
        </div>
        {addError ? <p className="punt-error">{addError}</p> : null}
      </div>
    </section>
  );
}

/* Centen en Nederlandse notatie. Puur: geen datum, geen I/O.
 *
 * ALLES IN HELE CENTEN. Niet uit netheid maar omdat de uitkomsten van elkaar
 * worden afgetrokken: € 7,50 opbrengst min € 2,55 kaartkosten. In floats levert
 * dat 4,949999999999999 op, en dat verschil kruipt door naar de vraag of iets
 * boven of onder nul uitkomt — precies de grens waar "wel een aanbeveling" en
 * "geen aanbeveling" van elkaar afhangen. */

/** Een percentage van een bedrag in centen, afgerond op hele centen.
 *  `Math.round` en niet `Math.trunc`: bij 2,5% van € 299,99 is 749,975 cent
 *  dichter bij 750 dan bij 749, en een halve cent kwijtraken per rij maakt de
 *  ranglijst niet eerlijker. */
export function pctOfCents(amountCents: number, pct: number): number {
  return Math.round((amountCents * pct) / 100);
}

/** Euro's uit de catalogus (2.55, 270) naar centen. Ook hier ronden, want 2.55
 *  is in binaire floats 2.5499999999999998 en `2.55 * 100` geeft 254.99999. */
export function eurosToCents(euros: number): number {
  return Math.round(euros * 100);
}

const EURO_FORMAT = new Intl.NumberFormat("nl-NL", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "€ 7,50". Vaste nl-NL-notatie; Intl doet de komma en het scheidingsteken.
 *  Bewust ALTIJD twee decimalen, ook bij hele bedragen: naast elkaar in een
 *  lijst lezen "€ 7" en "€ 7,50" als verschillende soorten getallen.
 *
 *  DE SPATIE NA HET EUROTEKEN IS EEN HARDE SPATIE (U+00A0) en dat is niet te
 *  zien maar wel te merken. Intl zet hem daar zelf neer voor nl-NL, en dat
 *  blijft zo: in het paneel staat het bedrag in een smalle kolom in de hoek van
 *  een winkelpagina, en met een gewone spatie mag de regel afbreken tussen het
 *  teken en het getal — dan staat er een eenzame € aan het eind van een regel
 *  en begint de volgende met "14,00". Een bedrag dat over twee regels valt,
 *  lees je aan een kassa verkeerd. lines.test.ts stond eerst met een gewone
 *  spatie en gaf toen de melding "expected 'Kost € 14,00 aan koersopslag.' to
 *  be 'Kost € 14,00 aan koersopslag.'" — twee identiek ogende strings. De test
 *  is naar de harde spatie gebracht, niet deze formatter naar de gewone.
 *
 *  HET MINTEKEN STAAT VOOR HET EUROTEKEN en daarin wijken we WEL van Intl af.
 *  Intl schrijft in nl-NL "€ -2,00": het teken zit dan achter het euroteken en
 *  de harde spatie, op de derde positie, terwijl het oog na "€ " al besloten
 *  heeft dat er een bedrag komt. In "Netto over 1 maand: € -2,00 — dat is
 *  achteruit" draagt dat ene teken de hele uitkomst, en het mag niet het teken
 *  zijn dat je over het hoofd ziet. Daarom "-€ 2,00": eerst de richting, dan
 *  het bedrag. Intl doet nog steeds de cijfers, wij verplaatsen alleen het
 *  teken. Math.abs vangt ook -0: dat is geen verlies en krijgt geen minteken. */
export function euro(cents: number): string {
  const teken = cents < 0 ? "-" : "";
  return teken + EURO_FORMAT.format(Math.abs(cents) / 100);
}

/** Een percentage zoals de rest van de app het schrijft: "2,5%", "1,4%", "0%".
 *  Maximaal twee decimalen, geen opgevulde nullen — 0% hoort er niet als 0,00%
 *  te staan, want dan lijkt een uitgesproken nul een meting met precisie. */
export function pct(value: number): string {
  return `${new Intl.NumberFormat("nl-NL", { maximumFractionDigits: 2 }).format(value)}%`;
}

/** Punten: hele punten, want een halve KLM-mijl bestaat niet. Naar beneden,
 *  omdat afronden naar boven een punt zou beloven die er niet komt. */
export function points(amountCents: number, perEuro: number): number {
  return Math.floor((amountCents / 100) * perEuro);
}

/** "2026-06-15" → "15 juni 2026". Een kaartvoorwaarde zonder leesbare datum is
 *  aan een kassa het gevaarlijkst van alles, dus een onleesbare datum wordt
 *  onveranderd doorgegeven in plaats van stil weggelaten: liever "2026-06" op
 *  het scherm dan een lege plek waar de gebruiker een verse meting invult. */
const MAANDEN = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december",
];
export function dateNL(iso: string): string {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(iso.trim());
  if (!m) return iso.trim();
  const maand = MAANDEN[Number(m[2]) - 1];
  if (!maand) return iso.trim();
  return m[3] ? `${Number(m[3])} ${maand} ${m[1]}` : `${maand} ${m[1]}`;
}

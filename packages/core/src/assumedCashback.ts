/* AANGENOMEN: GEEN CASHBACK — de enige plek in deze app waar een nul wordt
 * ingevuld die in geen enkel document staat.
 *
 * ZIJN OPDRACHT, letterlijk (app review 4, punt 22): "for most cards — ING, ABN,
 * most normal ones — they don't have cashback… if there's no case then it's
 * zero." Dat klopt ook: een gewone Nederlandse betaalpas kent geen cashback, en
 * de module bleef daardoor op "onbekend" staan bij precies de kaarten waarvan het
 * antwoord het minst spannend is.
 *
 * MAAR HET RAAKT DE REGEL DIE DE APP DRAAGT, en daarom staat dit in een eigen
 * bestand met een eigen type in plaats van als `?? 0` ergens in een view.
 * "Onbekend is nooit nul" heeft hier meerdere keren een verkeerd cijfer
 * tegengehouden — er zijn ooit acht valse nullen in de puntenkoersen geslopen
 * doordat een getal uit het verkeerde document kwam, en niemand kon achteraf zien
 * welke nul gemeten was en welke verzonnen. Een stille nul is niet fout omdat hij
 * fout is; hij is fout omdat je hem niet meer kunt terugvinden.
 *
 * VIER DINGEN LIGGEN HIER VAST:
 *
 *  1. DRIE TOESTANDEN, EN HET VERSCHIL ZIT IN HET TYPE. `gemeten` (een bron zegt
 *     het, óók als de bron nul zegt), `aangenomen` (geen bron, wel een soort
 *     product waar cashback vrijwel niet bestaat) en `onbekend` (we mogen niets
 *     invullen). Drie varianten van één unie, met `tier` als discriminant, zodat
 *     een scherm het onderscheid niet kán laten vallen: een aangenomen nul heeft
 *     geen `sourceUrl` en een onbekende heeft überhaupt geen `pct`.
 *
 *  2. DE AANGENOMEN NUL IS TYPE-MATIG ALTIJD NUL (`pct: 0`, een literal). Er
 *     bestaat geen manier om "aangenomen 1,5%" te construeren. Een aanname mag
 *     alleen de kant op die niets belooft.
 *
 *  3. DE AFBAKENING IS EEN LIJST, GEEN HEURISTIEK. Wie op de lijst staat is te
 *     lezen en te weerleggen; een regex op "is het een bank?" is dat niet. Zie
 *     `ORDINARY_NL_ISSUERS` voor wie erop staat en `blockingKind` voor wat er
 *     nooit onder valt.
 *
 *  4. DE AANNAME HEEFT EEN HOUDBAARHEIDSDATUM. Hij vroeg zelf om een jaarlijkse
 *     sweep "voor als er tóch cashback verschijnt", en dat hoort in de code te
 *     staan en niet alleen in een agenda: `ASSUMPTION_REVIEW_MONTHS` plus
 *     `assumptionDueForReview`, zodat het scherm kan zeggen dat een aanname oud
 *     is in plaats van hem stil te blijven herhalen.
 *
 * Puur, zoals alles in packages/core: geen I/O, geen klok. `asOf` komt als
 * parameter binnen.
 */
import { norm } from "./hash.js";
import type { FactSource } from "./facts.js";

/** Hoe hard het cijfer is. Dit woord staat ook LETTERLIJK op het scherm — zie
 *  `describeCashback` — want een lezer die "aangenomen" ziet staan kan de vraag
 *  stellen; een lezer die alleen "0%" ziet kan dat niet. */
export type CashbackTier = "gemeten" | "aangenomen" | "onbekend";

/** Waarom er niets mag worden aangenomen. De reden hoort erbij: "dit is een
 *  spaarrekening" en "deze uitgever verkoopt juist cashback" zijn twee
 *  verschillende antwoorden op dezelfde vraag, en een melding die zijn eigen
 *  oorzaak niet noemt kan de lezer niet verder helpen. */
export type NoAssumptionReason =
  /** Prepaid- en cryptokaarten. Cashback is bij deze producten het
   *  VERKOOPARGUMENT — alle acht aantoonbare cashbackcijfers in de catalogus
   *  (augustus 2026) staan op zo'n kaart. Daar nul aannemen zou de reden
   *  wegpoetsen waarom iemand zo'n kaart überhaupt neemt. */
  | "verkoopargument"
  /** Een uitgever die zijn kaarten op de beloning verkoopt: American Express en
   *  de co-brandkaarten (Flying Blue, KLM). Membership Rewards is geen cashback,
   *  maar de vraag "wat krijg ik terug" is bij deze kaarten het hele product en
   *  het antwoord verschilt per kaart. */
  | "beloningsuitgever"
  /** Een spaar- of beleggingsrekening. Daar is geen kaart en dus geen vraag; nul
   *  invullen zou een product verzinnen dat hij niet heeft. */
  | "geen-betaalproduct"
  /** De uitgever staat niet op de lijst. Neobanken met betaalde niveaus
   *  (Revolut, N26, bunq, Wise, Trade Republic, Openbank, Trading 212) verkopen
   *  die niveaus juist op wat je terugkrijgt, en daar is nul een gok. */
  | "uitgever-buiten-de-aanname"
  /** De soort van het product is niet vastgesteld. Zonder soort weten we niet
   *  of het een gewone pas of een cryptokaart is, en dan is er niets om op te
   *  steunen. */
  | "soort-onbekend";

/** Een cijfer dat in een bron staat. Ook nul: zegt een tarievenblad "geen
 *  cashback", dan is dat een GEMETEN nul en hoort hij niet met een aanname op één
 *  hoop. Dat is de keerzijde van de regel, en die geldt net zo hard. */
export type MeasuredCashback = {
  tier: "gemeten";
  pct: number;
  sourceUrl: string;
  /** De datum die de BRON noemt, niet de dag dat wij keken. */
  asOf: string;
  conditions: string | null;
};

/** De nul die wij invullen. Draagt geen bron en geen datum, want die zijn er
 *  niet — en een veld dat er niet is kan niet per ongeluk als bewijs worden
 *  getoond. Wat hij wél draagt is waar de aanname op steunt, zodat het scherm
 *  precies dat kan opschrijven. */
export type AssumedNoCashback = {
  tier: "aangenomen";
  /** Literal 0: "aangenomen 1,5%" bestaat niet en kan niet worden gebouwd. */
  pct: 0;
  /** De familie uit `ORDINARY_NL_ISSUERS` waar de aanname op steunt. */
  issuerFamily: string;
  /** De productsoort waar de aanname op steunt. */
  kind: AssumableKind;
  /** De laatste dag waarop iemand de voorwaarden van dit soort product echt
   *  heeft gelezen, als de aanroeper dat weet — de peildatum van de catalogus.
   *  Null als niemand het weet, en dan zegt het scherm dat ook. */
  lastCheckedAt: string | null;
};

export type UnknownCashback = { tier: "onbekend"; reason: NoAssumptionReason };

export type CashbackKnowledge = MeasuredCashback | AssumedNoCashback | UnknownCashback;

/* ─────────────────────────────────────────────────────────── de afbakening */

/** De productsoorten waarover de aanname mag gaan: gewone betaalproducten.
 *  `betaalrekening` en `betaalpakket` staan erbij omdat de catalogus de pas soms
 *  onder het pakket hangt (SNS noemt zijn Basis een pakket, ASN noemt hetzelfde
 *  ding een bankrekening) — dezelfde reden waarom `FeeGroup` in accountCosts.ts
 *  die twee samenneemt. */
export const ASSUMABLE_KINDS = ["betaalpas", "betaalrekening", "betaalpakket", "creditcard"] as const;
export type AssumableKind = (typeof ASSUMABLE_KINDS)[number];

/** Welke catalogussoorten bij dit soort EIGEN rekening horen — de brug tussen
 *  een geïmporteerde rekening (die alleen "Creditcard" of iets anders is) en de
 *  soorten die de catalogus onderscheidt.
 *
 *  Een creditcard wordt alleen tegen creditcardrijen gehouden; een betaalpas ook
 *  tegen de rekening- en pakketrijen, want de catalogus hangt de pas soms onder
 *  het pakket (SNS noemt zijn Basis een pakket, ASN noemt hetzelfde ding een
 *  bankrekening). Twee schermen vragen dit — Optimalisatie voor de peildatum van
 *  een aanname, Profiel voor dezelfde regel in de feedbackmodule — en toen het
 *  er twee keer stond kon het uit elkaar lopen zonder dat een test dat zag. */
export const CATALOGUE_KINDS_FOR: Record<"betaalpas" | "creditcard", readonly AssumableKind[]> = {
  creditcard: ["creditcard"],
  betaalpas: ["betaalpas", "betaalrekening", "betaalpakket"],
};

/** Soorten die de aanname per definitie blokkeren, met de reden. Een soort die
 *  hier niet in staat en ook niet in `ASSUMABLE_KINDS` is simpelweg onbekend. */
const BLOCKING_KINDS: Record<string, NoAssumptionReason> = {
  prepaid: "verkoopargument",
  crypto: "verkoopargument",
  spaarrekening: "geen-betaalproduct",
  beleggingsrekening: "geen-betaalproduct",
};

/** DE LIJST. Wie hierop staat is een gewone Nederlandse aanbieder van
 *  betaalproducten: een bank die zijn pas en zijn creditcard verkoopt als
 *  betaalmiddel, niet als spaarprogramma. Van geen van hen noemt enig
 *  tarievenblad in de catalogus een cashbackpercentage, en dat is precies wat
 *  hij bedoelt met "most normal ones".
 *
 *  WAT ER BEWUST NIET OP STAAT, want dit is de helft die de lijst verdedigbaar
 *  maakt:
 *    · American Express en de Flying Blue/KLM-co-brands. Die kaarten worden
 *      verkocht op wat je ermee verdient. Nul aannemen is daar niet voorzichtig
 *      maar onjuist — en het is ook nog eens de kaart waar hij zelf punten op
 *      heeft staan.
 *    · Revolut, N26, bunq, Wise, Trade Republic, Openbank, Trading 212, Kraken,
 *      Plutus, Bybit, Nexo. Allemaal aanbieders met BETAALDE niveaus, en een
 *      betaald niveau wordt verkocht op zijn extraatjes. Een nul daar zou de
 *      duurste kaart als de zuinigste laten ranken.
 *    · Alles wat de catalogus `prepaid` of `crypto` noemt; zie `BLOCKING_KINDS`.
 *
 *  VOLGORDE IS BETEKENISVOL: specifieker eerst. De uitgever van de RegioBank-pas
 *  staat in de catalogus als "ASN Bank N.V. (formerly RegioBank N.V.)", dus zonder
 *  RegioBank vóór ASN zou de melding de verkeerde bank noemen.
 *
 *  ICS staat erop omdat hij het moet: de creditcards van ING, ABN AMRO, Rabobank,
 *  SNS, ASN en RegioBank worden allemaal door International Card Services
 *  uitgegeven, en zonder deze regel valt precies de helft van zijn eigen kaarten
 *  buiten de aanname die over hen gaat. */
const ORDINARY_NL_ISSUERS: readonly { family: string; pattern: RegExp }[] = [
  { family: "RegioBank", pattern: /\bregiobank\b/i },
  { family: "ASN Bank", pattern: /\basn\b/i },
  { family: "SNS Bank", pattern: /\bsns\b|\bde volksbank\b/i },
  { family: "ING", pattern: /\bing\b/i },
  { family: "ABN AMRO", pattern: /\babn\s*amro\b/i },
  { family: "Rabobank", pattern: /\brabo(?:bank)?\b/i },
  { family: "Knab", pattern: /\bknab\b/i },
  { family: "Triodos Bank", pattern: /\btriodos\b/i },
  { family: "International Card Services", pattern: /\bics\b|international card services/i },
];

/** Uitgevers die de aanname UITSLUITEN, ook als een andere naam in dezelfde regel
 *  toevallig wel op de lijst zou passen. Dit gaat vóór: de KLM American Express
 *  Corporate Card bevat het woord "Corporate" en niets van de lijst, maar de
 *  Flying Blue-kaarten worden door Amex uitgegeven en ICS staat wél op de lijst —
 *  een co-brandkaart mag nooit via de uitgever van iemand anders binnenglippen. */
const REWARD_ISSUERS = /american express|\bamex\b|flying blue/i;

/** Mag er voor dit product een nul worden aangenomen?
 *
 *  `issuer` mag alles zijn wat de aanroeper heeft: de lange uitgeversregel uit de
 *  catalogus ("ASN Bank N.V. (formerly SNS Bank N.V. / de Volksbank)") of gewoon
 *  de banknaam van een geïmporteerde rekening ("ING"). Er wordt op woorden
 *  gematcht, niet op gelijkheid, omdat die twee bronnen dezelfde bank nooit
 *  hetzelfde spellen.
 *
 *  `productName` is optioneel en doet er één ding: een co-brandkaart herkennen
 *  waarvan de uitgeversregel de bank noemt en de productnaam het beloningsmerk. */
export function mayAssumeNoCashback(
  issuer: string,
  kind: string,
  productName = "",
): { ok: true; family: string; kind: AssumableKind } | { ok: false; reason: NoAssumptionReason } {
  const k = norm(kind);
  const blocked = BLOCKING_KINDS[k];
  if (blocked) return { ok: false, reason: blocked };
  if (!(ASSUMABLE_KINDS as readonly string[]).includes(k)) return { ok: false, reason: "soort-onbekend" };

  const hay = `${issuer} ${productName}`;
  // De uitsluiting eerst. Zie REWARD_ISSUERS: anders wint de eerste regel op de
  // lijst die toevallig ook in de zin staat.
  if (REWARD_ISSUERS.test(hay)) return { ok: false, reason: "beloningsuitgever" };

  const hit = ORDINARY_NL_ISSUERS.find((o) => o.pattern.test(hay));
  if (!hit) return { ok: false, reason: "uitgever-buiten-de-aanname" };
  return { ok: true, family: hit.family, kind: k as AssumableKind };
}

/** De aanname, of het eerlijke "onbekend" als hij niet mag.
 *
 *  Dit is de enige constructor van een `AssumedNoCashback`: elders in de app kan
 *  niemand er per ongeluk een maken zonder door `mayAssumeNoCashback` te gaan. */
export function assumeNoCashback(input: {
  issuer: string;
  kind: string;
  productName?: string;
  /** De peildatum van de bron die WEL bekeken is (het tarievenblad van dit
   *  product, als de catalogus dat heeft). Zonder is null; het scherm zegt dan
   *  dat niemand een datum kan noemen in plaats van er een te kiezen. */
  lastCheckedAt?: string | null;
}): AssumedNoCashback | UnknownCashback {
  const verdict = mayAssumeNoCashback(input.issuer, input.kind, input.productName ?? "");
  if (!verdict.ok) return { tier: "onbekend", reason: verdict.reason };
  return {
    tier: "aangenomen",
    pct: 0,
    issuerFamily: verdict.family,
    kind: verdict.kind,
    lastCheckedAt: input.lastCheckedAt ?? null,
  };
}

/* ───────────────────────────────────────────── de houdbaarheid van een aanname */

/** Hoe lang een aanname mag blijven staan zonder dat iemand er opnieuw naar
 *  kijkt. Zijn eigen vraag: een jaarlijkse sweep "voor als er tóch cashback
 *  verschijnt". Twaalf maanden, omdat een Nederlandse bank zijn tarievenblad
 *  jaarlijks herziet — vaker kijken vindt niets, minder vaak mist een wijziging
 *  een heel jaar lang. */
export const ASSUMPTION_REVIEW_MONTHS = 12;

/** Is deze aanname aan een nieuwe blik toe?
 *
 *  Rekent op de ISO-string en niet op een Date: core is klokvrij en `asOf` komt
 *  van buiten. Een aanname zonder peildatum is per definitie toe — niemand kan
 *  zeggen wanneer er voor het laatst gekeken is, en dat is geen reden om aan te
 *  nemen dat het gisteren was. */
export function assumptionDueForReview(lastCheckedAt: string | null, asOf: string): boolean {
  if (!lastCheckedAt) return true;
  // Beide op maandniveau: catalogusdata staan er soms als "2026-01" in, en een
  // vergelijking op tekst die de ene keer tien en de andere keer zeven tekens
  // telt geeft antwoorden die van de schrijfwijze afhangen in plaats van van de
  // tijd.
  const [ly, lm] = lastCheckedAt.split("-").map(Number);
  const [ay, am] = asOf.split("-").map(Number);
  if (!Number.isFinite(ly) || !Number.isFinite(lm) || !Number.isFinite(ay) || !Number.isFinite(am)) return true;
  return (ay * 12 + am) - (ly * 12 + lm) >= ASSUMPTION_REVIEW_MONTHS;
}

/* ─────────────────────────────────────────────────────────────── de woorden */

/** Waarom er niets is aangenomen, in één Nederlandse zin. Staat in core en niet
 *  in een view, om dezelfde reden als `describeNetBenefit`: er zijn twee schermen
 *  die over hetzelfde gat praten (Optimalisatie en het reisblok) en die mogen
 *  niet op een dag iets anders beweren. */
export const NO_ASSUMPTION_NL: Record<NoAssumptionReason, string> = {
  verkoopargument:
    "Bij prepaid- en cryptokaarten is cashback juist het verkoopargument, dus daar mag LaVega geen nul aannemen.",
  beloningsuitgever:
    "Deze uitgever verkoopt zijn kaarten op wat je ermee verdient, dus wat je terugkrijgt verschilt per kaart en staat hier niet vast.",
  "geen-betaalproduct":
    "Bij dit soort rekening hoort geen kaart, dus er valt geen cashback op te geven.",
  "uitgever-buiten-de-aanname":
    "Deze aanbieder verkoopt betaalde niveaus met extraatjes, dus nul aannemen zou een gok zijn.",
  "soort-onbekend":
    "LaVega weet niet wat voor product dit is, en zonder dat is er niets om op te steunen.",
};

/** Het cijfer in woorden, met de hardheid ervoor. De aangenomen tak zegt
 *  LETTERLIJK "aangenomen" — dat is het hele punt van deze module: een lezer moet
 *  aan de zin kunnen zien dat er niemand is die dit heeft opgeschreven. */
export function describeCashback(k: CashbackKnowledge): string {
  if (k.tier === "gemeten") {
    const p = k.pct.toLocaleString("nl-NL", { maximumFractionDigits: 2 });
    return k.pct === 0
      ? `gemeten: geen cashback — de voorwaarden van dit product noemen het uitdrukkelijk (peildatum ${k.asOf})`
      : `gemeten: ${p}% (peildatum ${k.asOf})`;
  }
  if (k.tier === "aangenomen") {
    return "aangenomen: geen cashback — niet gevonden in de voorwaarden van dit product";
  }
  return `onbekend — ${NO_ASSUMPTION_NL[k.reason]}`;
}

/* ─────────────────────────── wat we van een EIGEN kaart weten, en hoe hard ──
 *
 * Alles hierboven gaat over een CATALOGUSRIJ: een product met een bron-URL en
 * een peildatum. Een kaart die hij zelf heeft heeft die rij niet. Daar komt een
 * gemeten cijfer uit een `LearnedFact`, en dat draagt geen URL maar een bron in
 * de andere betekenis — hij zelf, of de reisagent. Dat verschil hoort op het
 * scherm: "door jou ingesteld" leest heel anders dan een cijfer dat een agent
 * maanden geleden vond.
 *
 * DIT STOND EERST IN Optimalisatie.tsx. Toen de feedbackmodule in Profiel
 * dezelfde vraag moest beantwoorden ("wat denkt LaVega nu van deze kaart?")
 * stonden er twee versies van dezelfde beslissing, en dan zegt de ene op een dag
 * iets anders dan de andere — precies de fout waar `describeNetBenefit` ook voor
 * bestaat. Eén plek, klokvrij, `asOf` komt van buiten.
 */

/** Wat LaVega van één van zijn eigen kaarten weet. Vier takken, want er is er
 *  één bij die core's catalogus niet kent: `uitgezet`. De aanname is een
 *  SCHAKELAAR (Profiel → Cashback corrigeren), en staat hij uit dan is het
 *  antwoord weer "onbekend" — maar met een oorzaak die niet in
 *  `NoAssumptionReason` staat. Een melding die zijn eigen oorzaak niet noemt is
 *  precies wat hier niet mag, dus krijgt die toestand een eigen tak in plaats van
 *  de dichtstbijzijnde reden te lenen. */
export type HeldCashback =
  | { tier: "gemeten"; pct: number; source: FactSource; updatedAt: string }
  | AssumedNoCashback
  | UnknownCashback
  | { tier: "uitgezet" };

/** Wat we van deze kaart weten, in de volgorde waarin het telt.
 *
 *  EEN GESTELD CIJFER WINT ALTIJD VAN EEN AANNAME, of het nu van hem komt of van
 *  de reisagent. Dat is dezelfde rangorde als `upsertFacts`, en het is ook wat de
 *  feedbackmodule in Profiel laat werken: één correctie daar zet deze uitkomst
 *  om, zonder tweede mechanisme ernaast. */
export function heldCashbackOf(input: {
  issuer: string;
  kind: string;
  productName?: string;
  /** Wat er over dit product in de kluis staat, als er iets staat. */
  fact: { pct: number; source: FactSource; updatedAt: string } | null;
  /** Staat de aanname aan? Zie `getCashbackAssumptionEnabled` in de app. */
  assumptionOn: boolean;
  lastCheckedAt?: string | null;
}): HeldCashback {
  if (input.fact) return { tier: "gemeten", ...input.fact };
  if (!input.assumptionOn) return { tier: "uitgezet" };
  return assumeNoCashback({
    issuer: input.issuer,
    kind: input.kind,
    productName: input.productName,
    lastCheckedAt: input.lastCheckedAt ?? null,
  });
}

/** Het percentage waar een vergelijking op mag rekenen, of null.
 *
 *  Alleen `gemeten` en `aangenomen` leveren een getal. De aangenomen nul telt
 *  bewust WEL mee — dat is de hele wens — maar hij komt nooit los van zijn label:
 *  de aanroeper houdt de `HeldCashback` erbij, zodat de regel die het bedrag toont
 *  ook het woord "aangenomen" kan tonen. */
export function cashbackPctOf(k: HeldCashback): number | null {
  if (k.tier === "gemeten" || k.tier === "aangenomen") return k.pct;
  return null;
}

/** Wat er over deze eigen kaart op het scherm hoort, in één Nederlandse zin.
 *
 *  Naast `describeCashback` en niet erin: die gaat over een catalogusrij met een
 *  URL en een peildatum, deze over een kaart met een feit en een bron. Ze in één
 *  functie proppen zou betekenen dat beide vormen overal optioneel worden, en dan
 *  is het type niet langer wat het onderscheid bewaakt. */
export function describeHeldCashback(k: HeldCashback): string {
  if (k.tier === "gemeten") {
    const p = k.pct.toLocaleString("nl-NL", { maximumFractionDigits: 2 });
    return `${p}%, ${k.source === "user" ? "door jou ingesteld" : "gevonden door de reisagent"} op ${k.updatedAt}`;
  }
  if (k.tier === "uitgezet") {
    return "onbekend — je hebt de aanname “geen cashback” uitgezet bij Profiel → Cashback corrigeren.";
  }
  return describeCashback(k);
}

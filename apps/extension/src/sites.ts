/* WAAR DE EXTENSIE MAG MEEKIJKEN. Eén lijst, en hij is kort met opzet.
 *
 * Elke regel hieronder is een verzoek aan de gebruiker om ons de inhoud van zijn
 * winkelpagina's te laten lezen. Dat is niet gratis en het is niet terug te
 * draaien nadat je het gelezen hebt, dus de drempel is niet "de winkel is
 * populair" maar: KUNNEN WE AANTONEN DAT HET BEDRAG DAT WE LEZEN OOK ECHT HET
 * BEDRAG OP DIE PAGINA IS. Zo niet, dan staat de winkel er niet in en zegt de
 * extensie daar niets. Zwijgen is een prima uitkomst; een verkeerd bedrag niet.
 *
 * ── DE METING VAN 21 AUGUSTUS 2026 ─────────────────────────────────────────
 *
 * Eenentwintig Nederlandse winkelpagina's, curl, gewone browser-UA, redirects
 * gevolgd. Dertien uit de eerste ronde (zie de kop van read.ts) en acht nieuwe.
 * Wat er terugkwam:
 *
 *   ikea.com/nl/nl/p/   200, JSON-LD Offer met price EN priceCurrency,
 *                       en het artikel KLOPTE                        ← leesbaar
 *   coolblue.nl         200, JSON-LD Offer met price en priceCurrency,
 *                       maar het artikel klopte NIET                 ← gevaarlijk
 *   wehkamp.nl          200, wel "price"-getallen in app-state, geen munt en
 *                       geen schema.org
 *   bol.com             200, JSON-LD Offer ZONDER price
 *   megekko.nl          200, één JSON-LD-blok zonder priceCurrency
 *   alternate.nl        200, geen JSON-LD
 *   hema.nl             200, alleen Organization en WebSite
 *   mediamarkt.nl       200, nul JSON-LD-blokken
 *   praxis.nl / bcc.nl / blokker.nl / fonq.nl / amazon.nl / wehkamp-product
 *                       404 op de gebruikte URL — dus geen meting van de winkel
 *   ah.nl / conrad.nl / decathlon.nl / thuisbezorgd.nl / debijenkorf.nl /
 *   kruidvat.nl / azerty.nl        403
 *   gamma.nl            429
 *   bax-shop.nl         406
 *   zalando.nl          verbinding mislukte, geen HTTP-status
 *
 * ── WAAROM COOLBLUE ER NIET IN STAAT, terwijl de fixture er wél ligt ────────
 *
 * Dit is de belangrijkste beslissing in dit bestand en hij gaat tegen het werk
 * van de vorige ronde in, dus hij staat hier voluit.
 *
 * De eerste meting noteerde Coolblue als de ENIGE winkel met een machineleesbaar
 * bedrag mét munt, en de lezer is eromheen gebouwd. Bij de hermeting bleek het
 * bedrag te kloppen als bedrag en niet te kloppen als antwoord:
 *
 *   /product/949341/apple-airpods-pro-3.html   → Samsonite kofferset, € 420
 *   /product/865867/sonos-era-100-zwart.html   → PlayStation 5, € 490
 *
 * Twee URL's, twee andere artikelen, twee andere prijzen — en geen van beide het
 * artikel waar de gebruiker naar kijkt. De lezer heeft daar geen verweer tegen:
 * het is geldige schema.org met een geldige munt, dus readCheckout geeft
 * `{ ok: true, amountCents: 49000 }` terug op een Sonos van € 279. Vervolgens
 * rekent rank.ts daar een percentage over uit en rolt er een aanbeveling uit die
 * op niets slaat, zonder dat er ergens een twijfel in beeld komt.
 *
 * Dat is precies de fout die erger is dan zwijgen, dus zwijgen we. De fixture
 * blijft liggen omdat hij de PARSER test (een JSON-getal met priceCurrency
 * ernaast) en omdat sites.test.ts hem gebruikt om te bewijzen dat het domein
 * buiten de lijst blijft. Een fixture is bewijsmateriaal, geen toestemming.
 *
 * Wat het NIET bewijst: dat Coolblue in een echte browser met een echte sessie
 * ook het verkeerde artikel serveert. Goed mogelijk van niet — dit kan een
 * rand-cache voor bots zijn. Maar "waarschijnlijk gaat het in het echt wel goed"
 * is geen meting, en op dit oppervlak is een vermoeden niet genoeg. Wie het
 * tegendeel meet in een echte browser, zet Coolblue erbij met die meting eronder.
 *
 * ── WAAROM BOL.COM ER NIET IN STAAT ────────────────────────────────────────
 *
 * Andere reden, zelfde uitkomst. Bol geeft opmaak zonder prijs, dus de lezer
 * weigert netjes met "vul het bedrag zelf in". Dat werkt — maar dan koopt de
 * leestoestemming niets: het handmatige veld in de popup doet exact hetzelfde
 * op elke site, zonder dat wij één pagina hoeven te lezen. Een toestemming die
 * niets oplevert, vraag je niet.
 *
 * ── WAAROM HET PAD ERIN ZIT, EN WIE HET AFDWINGT ───────────────────────────
 *
 * `/nl/nl/p/*` is de productpagina. De winkelwagen, het bestelproces en de
 * accountpagina's vallen er buiten.
 *
 * DE EERSTE VERSIE VAN DIT BESTAND SCHOOF DAT DOOR NAAR CHROME. Onder het vinkje
 * stond "niet de winkelwagen, niet je account" en de opzoekfunctie keek alleen
 * naar het hostdeel; het pad zou Chrome wel afdwingen via het matchpatroon in de
 * verleende toestemming. Dat is nooit gemeten, en het is precies de vorm van
 * belofte die hier niet mag staan: waar op het scherm, alleen zolang een ander
 * systeem zich gedraagt zoals wij aannemen. Chrome praat in zijn eigen
 * toestemmingsdialoog bovendien over een DOMEIN, niet over een pad.
 *
 * Daarom staat het pad nu drie keer vast, en de eerste twee zijn van ons:
 *
 *   1. `siteForUrl` hieronder weigert elke URL waarvan het pad niet onder het
 *      vaste stuk van het matchpatroon valt. De service worker leest een pagina
 *      niet zonder dat die functie ja zegt (zie background.ts).
 *   2. copy-static.mjs weigert een patroon dat alleen een domein aanwijst, zodat
 *      `https://www.ikea.com/*` er niet ongemerkt in kan glijden.
 *   3. `registerContentScripts` krijgt hetzelfde patroon mét pad, dus Chrome
 *      draait het content script alleen daar. Dát deel van Chrome's afdwinging
 *      is gedocumenteerd gedrag voor content scripts; de vraag of een verleende
 *      HOST-toestemming het pad ook afdwingt, is hier niet meer relevant — wij
 *      kijken zelf. */

/** Eén ondersteunde winkel. `match` is een Chrome-matchpatroon en gaat
 *  onveranderd naar `chrome.permissions.request` én naar
 *  `chrome.scripting.registerContentScripts`. Die twee moeten letterlijk
 *  hetzelfde patroon gebruiken: vraag je toestemming voor het ene patroon en
 *  registreer je het andere, dan mislukt de registratie met een foutmelding die
 *  niets over de oorzaak zegt. */
export type Site = {
  id: string;
  /** Wat er in de opties staat. */
  label: string;
  match: string;
  /** Waar het patroon op slaat, in gewone taal, voor onder het vinkje. */
  scope: string;
  /** Wat we hebben gemeten. Staat in de UI, niet alleen in dit commentaar: wie
   *  toestemming geeft, hoort te zien waarop die toestemming rust. */
  evidence: string;
};

export const SITES: readonly Site[] = [
  {
    id: "ikea-nl",
    label: "IKEA Nederland",
    match: "https://www.ikea.com/nl/nl/p/*",
    scope:
      "alleen productpagina's onder /nl/nl/p/ — de extensie slaat elk ander pad zelf over, " +
      "ook als Chrome de toestemming voor het hele domein geeft",
    evidence:
      "Gemeten op 21 augustus 2026: twee van de twee productpagina's met prijsopmaak gaven het bedrag " +
      "van het artikel dat er ook echt stond (BILLY € 49,99, KALLAX € 69,99).",
  },
];

/** De patronen die in `optional_host_permissions` van het manifest horen. Het
 *  manifest is JSON en kan deze lijst niet importeren, dus copy-static.mjs
 *  controleert bij elke build of de twee nog gelijk zijn. Dat is de goedkoopste
 *  plek om te merken dat er een site is bijgekomen zonder toestemmingsregel:
 *  anders faalt `permissions.request` pas in de handen van de gebruiker. */
export const SITE_MATCHES: readonly string[] = SITES.map((s) => s.match);

/** Een matchpatroon uit elkaar getrokken: het hostdeel en het VASTE stuk pad dat
 *  ervoor staat. `https://www.ikea.com/nl/nl/p/*` → host `www.ikea.com`,
 *  padPrefix `/nl/nl/p/`.
 *
 *  Geeft `null` bij alles wat geen precies aanwijsbare plek is: een
 *  wildcard-subdomein (`https://*.ikea.com/*`), een ander schema dan https, of
 *  een patroon zonder `*` aan het eind. Een kaal domein (`https://www.ikea.com/*`)
 *  komt er wél uit, maar met padPrefix `/` — en dat is precies waar
 *  `padIsSpecifiek` op afgaat. Zo kan zowel de test als de build op dezelfde
 *  ontleding controleren als de opzoekfunctie hieronder gebruikt, in plaats van
 *  op een eigen regex die er nét naast zit. */
export function ontleedMatch(match: string): { host: string; padPrefix: string } | null {
  const m = /^https:\/\/([a-z0-9.-]+)(\/[^*]*)\*$/.exec(match);
  if (!m) return null;
  return { host: m[1].toLowerCase(), padPrefix: m[2] };
}

/** Wijst dit patroon een deel van een site aan, of de hele site? `/` is de hele
 *  site en telt dus niet als pad. Gebruikt door sites.test.ts en door de build. */
export function padIsSpecifiek(match: string): boolean {
  const d = ontleedMatch(match);
  return d !== null && d.padPrefix.length > 1;
}

/** Welke ondersteunde site is dit, gegeven de VOLLEDIGE URL van een pagina?
 *
 *  Dit is de plek waar "alleen productpagina's" waargemaakt wordt. Er wordt op
 *  drie dingen gecontroleerd en alle drie moeten kloppen:
 *
 *    - het schema is https (een matchpatroon met https erin is geen belofte over
 *      de pagina die ons aanspreekt, alleen over waar we toestemming voor
 *      vroegen);
 *    - de host is letterlijk gelijk, zonder poort. Chrome's matchpatronen negeren
 *      de poort; wij weigeren er een, want een winkel op een afwijkende poort is
 *      niet de winkel die we gemeten hebben en zwijgen is daar het goede
 *      antwoord;
 *    - het pad begint met het vaste stuk uit het patroon.
 *
 *  Geef hier `sender.origin` aan door en het antwoord is altijd `null`: een
 *  origin heeft geen pad (`https://www.ikea.com` → pad `/`). Dat is met opzet —
 *  de aanroeper hoort de volledige URL te hebben. */
export function siteForUrl(url: string): Site | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (u.port !== "") return null;
  const host = u.hostname.toLowerCase();
  for (const s of SITES) {
    const d = ontleedMatch(s.match);
    if (!d) continue;
    if (d.host !== host) continue;
    if (!u.pathname.startsWith(d.padPrefix)) continue;
    return s;
  }
  return null;
}

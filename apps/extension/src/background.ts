/* De service worker. Doet drie dingen en verder niets:
 *
 *   1. hij houdt de registraties in lijn met de werkelijkheid: één
 *      kassa-registratie PER WINKEL uit sites.ts (elk achter zijn eigen vinkje
 *      en zijn eigen host-toestemming) plus een registratie per
 *      aanbiedingenbron (ING/Amex, eveneens elk achter zijn eigen vinkje en
 *      host-toestemming) — en zorgt dat geen van die registraties verder reikt
 *      dan de toestemming die erbij hoort;
 *   2. hij beantwoordt de vraag van het content script met AFGEMAAKTE ZINNEN;
 *   3. hij ruimt op zodra de gebruiker een toestemming intrekt.
 *
 * Wat er in stap 2 bij is gekomen: het puntenblok. Dat leest de saldi uit
 * chrome.storage.local — zijn eigen opgave, geen paginagegevens — en rekent ze
 * met de gebundelde koersen om. Er gaat GEEN saldo naar de pagina: het content
 * script krijgt zinnen, net als bij de kaarten, dus het aantal punten staat
 * alleen in de tekst die op het scherm hoort te komen en nergens als getal.
 *
 * ── WAAROM DE WORKER LEEST EN NIET HET CONTENT SCRIPT ──────────────────────
 *
 * Dat lijkt omslachtig: het content script zit al ín de pagina, waarom stuurt
 * het niet gewoon zelf het bedrag op? Twee redenen, en de tweede is de echte.
 *
 * De eerste is technisch. Een content script in Manifest V3 is een klassiek
 * script en kan niets importeren, dus collectEvidence uit read.ts is daar niet
 * te krijgen zonder de code te verdubbelen. Twee lezers die uit elkaar lopen is
 * hoe je een bedrag verkeerd gaat lezen op precies één van de twee plekken.
 *
 * De tweede is de grens. Door de worker `chrome.scripting.executeScript` te
 * laten doen met collectEvidence als functie, komt er uit de pagina alleen wat
 * die functie teruggeeft: host plus bedragen. Wat de pagina verder bevat, komt
 * de extensie niet binnen — niet omdat we het netjes weggooien, maar omdat het
 * er nooit is geweest. read.test.ts test die grens (zie "wat de extensie van een
 * pagina meeneemt"). Zou het content script de DOM zelf uitpluizen, dan zou die
 * test over de verkeerde code gaan.
 *
 * ── WAAROM ER NIETS OP EEN TIMER STAAT ─────────────────────────────────────
 *
 * Geen alarms, geen periodieke controle, geen bijwerken van de catalogus. De
 * catalogus zit in de bundel (regel: bundelen tijdens build mag, ophalen tijdens
 * runtime niet) en er is dus niets dat vanzelf hoort te gebeuren. Een service
 * worker die alleen leeft als er iets gevraagd wordt, is er ook niet als er
 * niets gevraagd wordt. */

import { collectEvidence, readCheckout, type Evidence } from "./read.js";
import { rankCheckout } from "./rank.js";
import { buildPanel, PANEEL_CAPS } from "./panel.js";
import { pointsCoverage } from "./points.js";
import {
  getHeldIds,
  getEnabledSiteIds,
  setEnabledSiteIds,
  getPointsBalances,
  getBronAan,
  getBronAanbiedingen,
  getBronLezing,
  setBronLezing,
  wisBron,
} from "./store.js";
import {
  leesAanbod,
  aanbodVoorWinkel,
  type AanbodUitkomst,
  type Bron,
  type RuweLezing,
} from "./aanbod-kern.js";
import { BRONNEN, bronVoorUrl, AANBOD_CONTENT_JS } from "./bronnen.js";
import { SITES, siteForUrl, ontleedMatch, type Site } from "./sites.js";
import { aanbodStrook } from "./lines.js";
import { CHECKOUT_CARDS } from "./generated/catalog.generated.js";
import { POINTS_RATES } from "./generated/points-rates.generated.js";

/** Het id waaronder een winkel zijn content script registreert. Eén vaste vorm,
 *  zodat opruimen ook lukt als de sitelijst inmiddels is veranderd: alles met
 *  dit voorvoegsel dat niet meer hoort te bestaan, gaat eraf. */
const REG_PREFIX = "paneel-";
const regId = (site: Site) => `${REG_PREFIX}${site.id}`;

/** Mag het paneel op DEZE winkel draaien? Twee voorwaarden, en ze moeten
 *  allebei waar zijn:
 *
 *   - Chrome heeft ons de host-toestemming voor dit ene patroon gegeven (die
 *     kan de gebruiker in chrome://extensions intrekken zonder ons iets te
 *     vragen);
 *   - het vinkje van deze winkel staat aan in onze eigen opslag.
 *
 *  Twee schakelaars voor één ding lijkt dubbelop, maar ze horen bij
 *  verschillende partijen. De eerste is van Chrome en die wint altijd. De
 *  tweede is van hem: het vinkje uitzetten zonder de toestemming in te trekken
 *  hoort te kunnen, en dan moet het paneel wegblijven ook al MAG het technisch
 *  nog.
 *
 *  `aangevinkt` wordt één keer gelezen en doorgegeven, niet per site opnieuw:
 *  zo kan een schrijfactie tijdens de sync geen half-aangevinkte toestand
 *  opleveren. */
async function magDraaien(site: Site, aangevinkt: readonly string[]): Promise<boolean> {
  if (!aangevinkt.includes(site.id)) return false;
  return chrome.permissions.contains({ origins: [site.match] });
}

/** Brengt de registraties in lijn met de werkelijkheid. Wordt aangeroepen bij
 *  installeren, bij opstarten, en na elke wijziging in opslag of toestemmingen.
 *
 *  Er is één registratie per WINKEL uit sites.ts (elk achter zijn eigen vinkje
 *  en zijn eigen host-toestemming) plus één registratie per aanbiedingenbron
 *  (ING/Amex, elk apart aan of uit).
 *
 *  IDEMPOTENT MET OPZET: hij kijkt eerst wat er al staat en doet alleen het
 *  verschil. Blind opnieuw registreren gooit een fout ("Duplicate script ID") en
 *  die fout laat de worker halverwege stoppen — waarna de ene registratie er
 *  staat en de andere niet, en het van de volgorde afhangt welke. */
function zelfdeLijst(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const xs = a ?? [];
  const ys = b ?? [];
  if (xs.length !== ys.length) return false;
  return xs.every((waarde, i) => waarde === ys[i]);
}

async function syncRegistraties(): Promise<void> {
  const aangevinkt = await getEnabledSiteIds();
  const bestaand = await chrome.scripting.getRegisteredContentScripts();
  const bestaandPerId = new Map(bestaand.map((s) => [s.id, s]));

  const gewensteSites: Site[] = [];
  for (const site of SITES) {
    if (await magDraaien(site, aangevinkt)) gewensteSites.push(site);
  }

  const bronnenAan: Bron[] = [];
  for (const bron of BRONNEN) {
    if (!(await getBronAan(bron))) continue;
    if (!(await chrome.permissions.contains({ origins: [bron.match] }))) continue;
    bronnenAan.push(bron);
  }

  const bronExcludes = BRONNEN.map((b) => b.match);
  const gewenst = new Map<
    string,
    { id: string; match: string; js: string; excludeMatches?: string[] }
  >();
  for (const s of gewensteSites) {
    const id = regId(s);
    gewenst.set(id, { id, match: s.match, js: "content.js", excludeMatches: bronExcludes });
  }
  for (const bron of bronnenAan) {
    const id = `${REG_PREFIX}${bron.id}`;
    gewenst.set(id, { id, match: bron.match, js: AANBOD_CONTENT_JS });
  }

  const wegHalen: string[] = [];
  for (const [id, oud] of bestaandPerId) {
    if (!id.startsWith(REG_PREFIX)) continue;
    const nieuw = gewenst.get(id);
    if (
      !nieuw ||
      !zelfdeLijst(oud.matches, [nieuw.match]) ||
      !zelfdeLijst(oud.js, [nieuw.js]) ||
      !zelfdeLijst(oud.excludeMatches, nieuw.excludeMatches)
    ) {
      wegHalen.push(id);
    }
  }
  if (wegHalen.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: wegHalen });
  }

  const wegSet = new Set(wegHalen);
  const bijZetten = [...gewenst.values()].filter(
    (s) => !bestaandPerId.has(s.id) || wegSet.has(s.id),
  );
  if (bijZetten.length > 0) {
    await chrome.scripting.registerContentScripts(
      bijZetten.map((s) => ({
        id: s.id,
        matches: [s.match],
        excludeMatches: s.excludeMatches,
        js: [s.js],
        runAt: "document_idle",
        persistAcrossSessions: true,
        world: "ISOLATED",
      })),
    );
  }
}

let syncRij: Promise<void> = Promise.resolve();

function planOpRij(taak: () => Promise<void>): Promise<void> {
  syncRij = syncRij.then(taak, taak);
  return syncRij;
}

function planSync(): Promise<void> {
  return planOpRij(syncRegistraties);
}

/** Trekt de gebruiker in chrome://extensions een host-toestemming in, dan is het
 *  vinkje een leugen geworden. Het gaat hier uit, niet pas als hij de opties
 *  opent — anders staat er straks een vinkje aan bij een site waar niets meer
 *  gebeurt, en zoekt hij naar een fout die er niet is. */
chrome.permissions.onRemoved.addListener(() => {
  void planOpRij(async () => {
    const aangevinkt = await getEnabledSiteIds();
    const blijft: string[] = [];
    for (const id of aangevinkt) {
      const site = SITES.find((s) => s.id === id);
      if (!site) continue;
      if (await chrome.permissions.contains({ origins: [site.match] })) blijft.push(id);
    }
    if (blijft.length !== aangevinkt.length) await setEnabledSiteIds(blijft);

    for (const bron of BRONNEN) {
      if (!(await getBronAan(bron))) continue;
      if (await chrome.permissions.contains({ origins: [bron.match] })) continue;
      await wisBron(bron);
    }

    await syncRegistraties();
  });
});

chrome.permissions.onAdded.addListener(() => void planSync());
chrome.runtime.onInstalled.addListener(() => void planSync());
chrome.runtime.onStartup.addListener(() => void planSync());

/* De opties schrijven de aangevinkte winkels naar opslag; hier wordt daarop
 * gereageerd. Zo hoeft het optiescherm niets van registraties te weten en is er
 * één plek waar registratie gebeurt. */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const bronSleutel = BRONNEN.some((b) => b.sleutels.aan in changes);
  if (!("enabledSiteIds" in changes) && !bronSleutel) return;
  void planSync();
});

/** Welke WINKEL hoort bij de afzender van dit bericht? Null als het er geen is.
 *
 *  DIT IS DE LEESGRENS EN GEEN GEMAK. Een bericht kan van elke pagina komen waar
 *  ooit een content script van ons heeft gedraaid, en `sendMessage` is niet te
 *  vertrouwen op zijn woord. `sender.url` en `sender.origin` worden door Chrome
 *  gezet en niet door de pagina, dus dat zijn de enige velden waarop dit mag
 *  rusten.
 *
 *  ── WAAROM HET PAD HIER WORDT GECONTROLEERD EN NIET ALLEEN DE HOST ─────────
 *
 *  Onder het vinkje in de opties staat dat de extensie alleen productpagina's
 *  leest. Deze functie is de plek waar die zin waar wordt gemaakt. Een origin
 *  HEEFT geen pad: `winkelwagen` en `p/billy-boekenkast` zijn er allebei
 *  `https://www.ikea.com`. Wat de zin belooft, wordt daarom hier gecontroleerd
 *  en niet aan Chrome overgelaten.
 *
 *  Vandaar drie eisen, en ze moeten alle drie kloppen:
 *
 *    - `sender.url` — de volledige URL van het frame dat ons aanspreekt — valt
 *      binnen host én pad van een ondersteunde winkel (`siteForUrl`);
 *    - is er ook een `sender.origin`, dan hoort die bij diezelfde URL. Twee
 *      velden die elkaar tegenspreken is geen afzender;
 *    - is de URL van het TABBLAD bekend, dan moet die het ook halen, en bij
 *      dezelfde winkel uitkomen. Dat laatste is geen dubbelop: we lezen zo meteen
 *      het tabblad, niet het frame dat de vraag stelde.
 *
 *  Wat hiermee NIET is dichtgezet: het tabblad kan tussen dit bericht en de
 *  injectie hieronder navigeren. Daar is `documentIds` van executeScript voor,
 *  en dat staat niet in chrome.d.ts — dat bestand is met opzet de complete lijst
 *  van wat de extensie mag aanroepen, en er langs casten om een race van
 *  milliseconden te sluiten is de verkeerde ruil. De schade blijft ook beperkt:
 *  na de injectie wordt de host uit het bewijsmateriaal nog een keer tegen de
 *  site gelegd (zie `beantwoord`), dus wat er overblijft is een navigatie binnen
 *  dezelfde host, precies tussen twee opeenvolgende regels. */
function siteVanAfzender(sender: chrome.runtime.MessageSender): Site | null {
  const url = sender.url;
  if (!url) return null;

  const site = siteForUrl(url);
  if (!site) return null;

  if (sender.origin) {
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      return null;
    }
    if (sender.origin !== origin) return null;
  }

  const tabUrl = sender.tab?.url;
  if (tabUrl !== undefined && siteForUrl(tabUrl)?.id !== site.id) return null;

  return site;
}

async function beantwoord(sender: chrome.runtime.MessageSender): Promise<PaneelAntwoord> {
  const site = siteVanAfzender(sender);
  if (!site) return { soort: "zwijg", reden: "afzender hoort niet bij een ondersteunde winkel" };

  const aangevinkt = await getEnabledSiteIds();
  if (!(await magDraaien(site, aangevinkt))) {
    return { soort: "zwijg", reden: `${site.id} staat uit` };
  }

  const tabId = sender.tab?.id;
  if (tabId === undefined) return { soort: "zwijg", reden: "bericht zonder tabblad" };

  let evidence: Evidence | undefined;
  try {
    const uitkomst = await chrome.scripting.executeScript({
      target: { tabId },
      func: collectEvidence,
      args: [null, null],
    });
    evidence = uitkomst[0]?.result;
  } catch {
    /* Injectie kan mislukken doordat het tabblad inmiddels weg is of doordat de
     * toestemming een seconde geleden is ingetrokken. Geen van beide is iets
     * waar de gebruiker iets aan heeft, dus dan zwijgt het paneel in plaats van
     * een technische fout op zijn winkelpagina te zetten. */
    return { soort: "zwijg", reden: "injectie mislukt" };
  }
  if (!evidence) return { soort: "zwijg", reden: "geen bewijsmateriaal" };

  /* De laatste controle op de herkomst, en de enige die NA de injectie kan. Het
   * bewijsmateriaal draagt de host van de pagina waar het vandaan komt; komt die
   * niet overeen met de site die de vraag stelde, dan is het tabblad onderweg
   * ergens anders heen gegaan en gaat deze lezing over een pagina waar niemand
   * ja tegen heeft gezegd. */
  const verwachteHost = ontleedMatch(site.match)?.host;
  if (!verwachteHost || evidence.host.toLowerCase() !== verwachteHost) {
    return { soort: "zwijg", reden: "de pagina is tijdens het lezen veranderd" };
  }

  const reading = readCheckout(evidence);
  const heldIds = await getHeldIds();

  /* De peildatum komt HIER vandaan en niet uit rank.ts of points.ts: die zijn
   * puur en kennen geen klok. Dit is de enige plek in de service worker waar de
   * tijd wordt afgelezen. */
  const asOf = new Date().toISOString().slice(0, 10);

  /* De puntensaldi komen uit de opslag en niet uit de pagina, en dat is precies
   * waarom dit blok ook werkt als de lezing mislukt: wat hij aan punten heeft
   * liggen hangt niet van deze winkel af. Alleen de DEKKING doet dat, en die
   * blijft null zolang er geen bedrag is. */
  const punten = pointsCoverage({
    balances: await getPointsBalances(),
    rates: POINTS_RATES,
    amountCents: reading.ok && reading.currency === "EUR" ? reading.amountCents : null,
    asOf,
  });

  const ranking = reading.ok
    ? rankCheckout({
        cards: CHECKOUT_CARDS,
        heldIds,
        currency: reading.currency,
        amountCents: reading.amountCents,
        asOf,
      })
    : null;

  /* Het aanbiedingenblok. Staat LOS van de leestoestemming voor deze winkel:
   * wat er in de opslag staat is al gelezen en er wordt hier geen tweede pagina
   * voor aangeraakt. Wel wordt de winkel gekoppeld op het DOMEIN van deze
   * pagina — nooit op de naam in de aanbieding; zie `hoortBijWinkel`. */
  const uitkomsten: { bron: Bron; uitkomst: AanbodUitkomst }[] = [];
  for (const bron of BRONNEN) {
    uitkomsten.push({
      bron,
      uitkomst: aanbodVoorWinkel(
        {
          aan: await getBronAan(bron),
          lezing: await getBronLezing(bron),
          aanbiedingen: await getBronAanbiedingen(bron),
        },
        evidence.host,
        asOf,
        bron,
        evidence.productNaam,
      ),
    });
  }

  return buildPanel({
    reading,
    ranking,
    cards: CHECKOUT_CARDS,
    punten,
    aanbod: { uitkomsten, asOf },
    caps: PANEEL_CAPS,
  });
}

/* ───────────────────── zijn eigen Amex-aanbiedingen lezen ─────────────────── */

/** Welke BRON hoort bij de afzender van dit bericht? Null als het er geen is.
 *
 *  Dezelfde drie eisen als bij `siteVanAfzender` hierboven en om dezelfde
 *  reden: `sender.url` en `sender.origin` worden door Chrome gezet en niet door
 *  de pagina, dus dat zijn de enige velden waarop dit mag rusten. Een origin
 *  heeft geen pad, dus alleen de origin controleren zou "alles op
 *  global.americanexpress.com" of "alles op www.ing.nl" betekenen — inclusief
 *  het rekeningoverzicht met zijn saldo en zijn transacties erop. Dat is precies
 *  wat er NIET gelezen wordt, en het staat hier in code en niet alleen in de
 *  belofte.
 *
 *  HIER WORDT OOK BESLIST WELKE BRON HET IS, en dat gebeurt met opzet aan DEZE
 *  kant. Het content script is één bestand voor beide pagina's en zegt niet wie
 *  het is; als het dat wel deed, zou een pagina zich voor de andere bron kunnen
 *  uitgeven en de lijst van de verkeerde bron laten overschrijven. Nu komt het
 *  antwoord uit `sender.url`, en dat veld zet Chrome. */
function bronVanAfzender(sender: chrome.runtime.MessageSender): Bron | null {
  const url = sender.url;
  if (!url) return null;

  const bron = bronVoorUrl(url);
  if (!bron) return null;

  if (sender.origin) {
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      return null;
    }
    if (sender.origin !== origin) return null;
  }

  const tabUrl = sender.tab?.url;
  if (tabUrl !== undefined && bronVoorUrl(tabUrl)?.id !== bron.id) return null;
  return bron;
}

async function beantwoordAanbod(
  sender: chrome.runtime.MessageSender,
  laatstePoging = false,
): Promise<AanbodAntwoord> {
  const bron = bronVanAfzender(sender);
  if (!bron) return { soort: "zwijg", reden: "afzender hoort niet bij een aanbiedingenbron" };

  if (!(await getBronAan(bron))) return { soort: "zwijg", reden: `${bron.id} staat uit` };
  if (!(await chrome.permissions.contains({ origins: [bron.match] }))) {
    return { soort: "zwijg", reden: `geen toestemming voor ${bron.id}` };
  }

  const tabId = sender.tab?.id;
  if (tabId === undefined) return { soort: "zwijg", reden: "bericht zonder tabblad" };

  const asOf = new Date().toISOString().slice(0, 10);

  let ruw: RuweLezing | undefined;
  try {
    const uitkomst = await chrome.scripting.executeScript({
      target: { tabId },
      func: bron.collect,
      args: [null],
    });
    ruw = uitkomst[0]?.result as RuweLezing | undefined;
  } catch {
    return { soort: "zwijg", reden: "injectie mislukt" };
  }
  if (!ruw) return { soort: "zwijg", reden: "geen lezing" };

  const { lezing, aanbiedingen } = leesAanbod(ruw, asOf, bron);
  const herhaalbaar =
    lezing.uitkomst === "geen-aanbiedingenblok" ||
    lezing.uitkomst === "blok-zonder-kaarten" ||
    lezing.uitkomst === "afgeschermd";
  const soort: "gelezen" | "opnieuw" | "mislukt" =
    lezing.uitkomst === "gelezen"
      ? "gelezen"
      : herhaalbaar && !laatstePoging
        ? "opnieuw"
        : "mislukt";

  if (soort !== "opnieuw") {
    await setBronLezing(bron, lezing, aanbiedingen);
  }

  const strook = aanbodStrook(
    lezing,
    aanbiedingen.map((a) => a.winkel),
    bron,
  );
  return {
    soort,
    regel: strook.regel,
    noot: strook.noot,
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const m = message as PaneelVerzoek | AanbodVerzoek | undefined;
  if (m?.soort === "aanbod-vragen") {
    void beantwoordAanbod(sender, m.laatstePoging === true).then(sendResponse);
    return true;
  }
  if (!m || m.soort !== "paneel-vragen") return;
  void beantwoord(sender).then(sendResponse);
  return true;
});

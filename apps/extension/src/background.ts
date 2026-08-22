/* De service worker. Doet drie dingen en verder niets:
 *
 *   1. hij houdt bij op welke winkels het paneel geregistreerd staat, en zorgt
 *      dat die registratie nooit verder reikt dan de toestemming;
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

import { SITES, siteForUrl, ontleedMatch, type Site } from "./sites.js";
import { collectEvidence, readCheckout, type Evidence } from "./read.js";
import { rankCheckout } from "./rank.js";
import { buildPanel, PANEEL_CAPS } from "./panel.js";
import { pointsCoverage } from "./points.js";
import { getHeldIds, getEnabledSiteIds, setEnabledSiteIds, getPointsBalances } from "./store.js";
import { CHECKOUT_CARDS } from "./generated/catalog.generated.js";
import { POINTS_RATES } from "./generated/points-rates.generated.js";

/** Het id waaronder een site zijn content script registreert. Eén vaste vorm,
 *  zodat opruimen ook lukt als de sitelijst inmiddels is veranderd: alles met
 *  dit voorvoegsel dat niet meer hoort te bestaan, gaat eraf. */
const REG_PREFIX = "paneel-";
const regId = (site: Site) => `${REG_PREFIX}${site.id}`;

/** Mag het paneel op deze site draaien? Twee voorwaarden, en ze moeten allebei
 *  waar zijn:
 *
 *   - Chrome heeft ons de host-toestemming gegeven (die kan de gebruiker in
 *     chrome://extensions intrekken zonder ons iets te vragen);
 *   - het vinkje staat aan in onze eigen opslag.
 *
 *  Twee schakelaars voor één ding lijkt dubbelop, maar ze horen bij verschillende
 *  partijen. De eerste is van Chrome en die wint altijd. De tweede is van hem:
 *  het vinkje uitzetten zonder de toestemming in te trekken hoort te kunnen, en
 *  dan moet het paneel wegblijven ook al MAG het technisch nog. */
async function magDraaien(site: Site, aangevinkt: readonly string[]): Promise<boolean> {
  if (!aangevinkt.includes(site.id)) return false;
  return chrome.permissions.contains({ origins: [site.match] });
}

/** Brengt de registraties in lijn met de werkelijkheid. Wordt aangeroepen bij
 *  installeren, bij opstarten, en na elke wijziging in opslag of toestemmingen.
 *
 *  IDEMPOTENT MET OPZET: hij kijkt eerst wat er al staat en doet alleen het
 *  verschil. Blind opnieuw registreren gooit een fout ("Duplicate script ID") en
 *  die fout laat de worker halverwege stoppen — waarna de helft van de sites
 *  geregistreerd is en de andere helft niet, en het van de volgorde afhangt
 *  welke. */
async function syncRegistraties(): Promise<void> {
  const aangevinkt = await getEnabledSiteIds();
  const bestaand = await chrome.scripting.getRegisteredContentScripts();
  const bestaandeIds = new Set(bestaand.map((s) => s.id));

  const gewenst: Site[] = [];
  for (const site of SITES) {
    if (await magDraaien(site, aangevinkt)) gewenst.push(site);
  }
  const gewensteIds = new Set(gewenst.map(regId));

  const wegHalen = [...bestaandeIds].filter((id) => id.startsWith(REG_PREFIX) && !gewensteIds.has(id));
  if (wegHalen.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: wegHalen });
  }

  const bijZetten = gewenst.filter((s) => !bestaandeIds.has(regId(s)));
  if (bijZetten.length > 0) {
    await chrome.scripting.registerContentScripts(
      bijZetten.map((s) => ({
        id: regId(s),
        matches: [s.match],
        js: ["content.js"],
        /* document_idle: de pagina is klaar met laden. Eerder heeft geen zin —
         * de prijsopmaak staat er dan misschien nog niet — en het paneel dat
         * over een half geladen winkel heen springt is onrustig. */
        runAt: "document_idle",
        persistAcrossSessions: true,
        world: "ISOLATED",
      })),
    );
  }
}

/** Trekt de gebruiker in chrome://extensions een host-toestemming in, dan is het
 *  vinkje een leugen geworden. Het gaat hier uit, niet pas als hij de opties
 *  opent — anders staat er straks een vinkje aan bij een site waar niets meer
 *  gebeurt, en zoekt hij naar een fout die er niet is. */
chrome.permissions.onRemoved.addListener(() => {
  void (async () => {
    const aangevinkt = await getEnabledSiteIds();
    const blijft: string[] = [];
    for (const id of aangevinkt) {
      const site = SITES.find((s) => s.id === id);
      if (!site) continue;
      if (await chrome.permissions.contains({ origins: [site.match] })) blijft.push(id);
    }
    if (blijft.length !== aangevinkt.length) await setEnabledSiteIds(blijft);
    await syncRegistraties();
  })();
});

chrome.permissions.onAdded.addListener(() => void syncRegistraties());
chrome.runtime.onInstalled.addListener(() => void syncRegistraties());
chrome.runtime.onStartup.addListener(() => void syncRegistraties());

/* De opties schrijven het vinkje naar opslag; hier wordt daarop gereageerd.
 * Zo hoeft het optiescherm niets van registraties te weten en is er één plek
 * waar registratie gebeurt. */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (!("enabledSiteIds" in changes)) return;
  void syncRegistraties();
});

/** Welke site hoort bij de afzender van dit bericht?
 *
 *  DIT IS EEN CONTROLE EN GEEN GEMAK. Een bericht kan van elke pagina komen
 *  waar ooit een content script van ons heeft gedraaid, en `sendMessage` is niet
 *  te vertrouwen op zijn woord. `sender.url` en `sender.origin` worden door
 *  Chrome gezet en niet door de pagina, dus dat zijn de enige velden waarop dit
 *  mag rusten.
 *
 *  ── WAAROM HET PAD HIER WORDT GECONTROLEERD EN NIET ALLEEN DE HOST ─────────
 *
 *  Onder het vinkje in de opties staat dat de extensie alleen productpagina's
 *  leest. Deze functie is de plek waar die zin waar wordt gemaakt. Eerder keek
 *  ze alleen naar `sender.origin`, en een origin HEEFT geen pad: `winkelwagen`
 *  en `p/billy-boekenkast` zijn er allebei `https://www.ikea.com`. Wat de zin
 *  beloofde, werd dus nergens in deze code gecontroleerd.
 *
 *  Vandaar drie eisen, en ze moeten alle drie kloppen:
 *
 *    - `sender.url` — de volledige URL van het frame dat ons aanspreekt — valt
 *      binnen host én pad van een ondersteunde site (`siteForUrl`);
 *    - is er ook een `sender.origin`, dan hoort die bij diezelfde URL. Twee
 *      velden die elkaar tegenspreken is geen afzender;
 *    - is de URL van het TABBLAD bekend, dan moet die het ook halen, en bij
 *      dezelfde site uitkomen. Dat laatste is geen dubbelop: we lezen zo meteen
 *      het tabblad, niet het frame dat de vraag stelde. Vraagt een frame binnen
 *      een productpagina iets terwijl het tabblad ergens anders staat, dan zou
 *      de lezing over een andere pagina gaan dan de controle.
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

  return buildPanel({ reading, ranking, cards: CHECKOUT_CARDS, punten, caps: PANEEL_CAPS });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const m = message as PaneelVerzoek | undefined;
  if (!m || m.soort !== "paneel-vragen") return;
  /* `true` teruggeven houdt het antwoordkanaal open tot sendResponse komt. Zonder
   * dat sluit Chrome het kanaal zodra deze functie terugkeert en krijgt het
   * content script `undefined` — en dat leest daar als "niets te melden", wat
   * iets heel anders is dan "nog even wachten". */
  void beantwoord(sender).then(sendResponse);
  return true;
});

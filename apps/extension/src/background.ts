/* De service worker. Doet drie dingen en verder niets:
 *
 *   1. hij houdt bij op welke winkels het paneel geregistreerd staat, en zorgt
 *      dat die registratie nooit verder reikt dan de toestemming;
 *   2. hij beantwoordt de vraag van het content script met AFGEMAAKTE ZINNEN;
 *   3. hij ruimt op zodra de gebruiker een toestemming intrekt.
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

import { SITES, siteForHost, type Site } from "./sites.js";
import { collectEvidence, readCheckout, type Evidence } from "./read.js";
import { rankCheckout } from "./rank.js";
import { buildPanel, PANEEL_CAPS } from "./panel.js";
import { getHeldIds, getEnabledSiteIds, setEnabledSiteIds } from "./store.js";
import { CHECKOUT_CARDS, CATALOG_GENERATED_AT } from "./generated/catalog.generated.js";

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
 *  te vertrouwen op zijn woord. `sender.origin` wordt door Chrome gezet en niet
 *  door de pagina, dus dat is het enige veld waarop dit mag rusten. */
function siteVanAfzender(sender: chrome.runtime.MessageSender): Site | null {
  const bron = sender.origin ?? sender.url;
  if (!bron) return null;
  let host: string;
  try {
    host = new URL(bron).host;
  } catch {
    return null;
  }
  return siteForHost(host);
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

  const reading = readCheckout(evidence);
  const heldIds = await getHeldIds();

  /* De peildatum komt HIER vandaan en niet uit rank.ts: die is puur en kent geen
   * klok. Dit is de enige plek in de extensie waar de tijd wordt afgelezen. */
  const asOf = new Date().toISOString().slice(0, 10);

  const ranking = reading.ok
    ? rankCheckout({
        cards: CHECKOUT_CARDS,
        heldIds,
        currency: reading.currency,
        amountCents: reading.amountCents,
        asOf,
      })
    : null;

  return buildPanel({ reading, ranking, catalogAt: CATALOG_GENERATED_AT, caps: PANEEL_CAPS });
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

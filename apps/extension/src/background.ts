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

import { collectEvidence, readCheckout, type Evidence } from "./read.js";
import { rankCheckout } from "./rank.js";
import { buildPanel, PANEEL_CAPS } from "./panel.js";
import { pointsCoverage } from "./points.js";
import {
  getHeldIds,
  getKassaOveralAan,
  getPointsBalances,
  getBronAan,
  getBronAanbiedingen,
  getBronLezing,
  setBronLezing,
  setKassaOveralAan,
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
import { aanbodStrook } from "./lines.js";
import { CHECKOUT_CARDS } from "./generated/catalog.generated.js";
import { POINTS_RATES } from "./generated/points-rates.generated.js";

/** Zelfde voorvoegsel als voorheen, nu gedeeld door de bronnen (per-bron id)
 *  en de kassa (één vast id) — zodat opruimen blijft werken op alles wat met
 *  dit voorvoegsel begint en niet meer gewenst is. */
const REG_PREFIX = "paneel-";
const KASSA_REG_ID = `${REG_PREFIX}kassa-overal`;
const KASSA_MATCH = "<all_urls>";

/** Mag het kassa-paneel draaien? Twee voorwaarden, en ze moeten allebei waar
 *  zijn:
 *
 *   - Chrome heeft de <all_urls>-toestemming gegeven (die kan de gebruiker in
 *     chrome://extensions intrekken zonder ons iets te vragen);
 *   - het vinkje staat aan in onze eigen opslag.
 *
 *  Twee schakelaars voor één ding lijkt dubbelop, maar ze horen bij
 *  verschillende partijen. De eerste is van Chrome en die wint altijd. De
 *  tweede is van hem: het vinkje uitzetten zonder de toestemming in te trekken
 *  hoort te kunnen, en dan moet het paneel wegblijven ook al MAG het technisch
 *  nog. */
async function kassaMagDraaien(): Promise<boolean> {
  if (!(await getKassaOveralAan())) return false;
  return chrome.permissions.contains({ origins: [KASSA_MATCH] });
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
  const bestaand = await chrome.scripting.getRegisteredContentScripts();
  const bestaandeIds = new Set(bestaand.map((s) => s.id));

  const gewensteIds = new Set<string>();
  if (await kassaMagDraaien()) gewensteIds.add(KASSA_REG_ID);

  /* Zijn eigen accountpagina's hangen aan APARTE schakelaars en aparte
   * toestemmingen — één per bron. Ze lopen hier mee in dezelfde registratielus
   * omdat het dezelfde twee voorwaarden zijn (vinkje én host-toestemming), maar
   * het zijn aparte vragen met aparte antwoorden: wie ja zei tegen zijn
   * Amex-account heeft daarmee geen ja gezegd tegen zijn ING-account. Zie de kop
   * van amex.ts en van ing.ts. */
  const bronnenAan: Bron[] = [];
  for (const bron of BRONNEN) {
    if (!(await getBronAan(bron))) continue;
    if (!(await chrome.permissions.contains({ origins: [bron.match] }))) continue;
    bronnenAan.push(bron);
    gewensteIds.add(`${REG_PREFIX}${bron.id}`);
  }

  const wegHalen = [...bestaandeIds].filter((id) => id.startsWith(REG_PREFIX) && !gewensteIds.has(id));
  if (wegHalen.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: wegHalen });
  }

  const bijZetten: { id: string; match: string; js: string }[] = [];
  if (gewensteIds.has(KASSA_REG_ID) && !bestaandeIds.has(KASSA_REG_ID)) {
    bijZetten.push({ id: KASSA_REG_ID, match: KASSA_MATCH, js: "content.js" });
  }
  for (const bron of bronnenAan) {
    const id = `${REG_PREFIX}${bron.id}`;
    if (bestaandeIds.has(id)) continue;
    /* ÉÉN content script voor alle bronnen. Het hoeft niet te weten op welke
     * pagina het draait: het stuurt "ik ben er" en krijgt afgemaakte zinnen
     * terug. Zie de uitleg bij AANBOD_CONTENT_JS in bronnen.ts. */
    bijZetten.push({ id, match: bron.match, js: AANBOD_CONTENT_JS });
  }
  if (bijZetten.length > 0) {
    await chrome.scripting.registerContentScripts(
      bijZetten.map((s) => ({
        id: s.id,
        matches: [s.match],
        js: [s.js],
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

/** Eén sync tegelijk, achter elkaar.
 *
 * ── DIT IS GEMETEN EN HET WAS EEN ECHTE FOUT ────────────────────────────────
 *
 * `syncRegistraties` is idempotent zolang hij ALLEEN draait: hij leest eerst wat
 * er staat en doet dan het verschil. Twee keer TEGELIJK is iets anders. Dan lezen
 * ze allebei dezelfde lege lijst, besluiten ze allebei dat er iets bij moet, en
 * roepen ze allebei `registerContentScripts` aan — waarna Chrome de tweede
 * afwijst met "Duplicate script ID" en die fout de worker halverwege laat
 * stoppen.
 *
 * Dat is geen theoretisch geval; het is precies wat het optiescherm doet. Bij het
 * aanzetten van een schakelaar gaat er eerst een `permissions.request` door (die
 * `onAdded` laat afgaan) en meteen daarna een schrijfactie naar de opslag (die
 * `onChanged` laat afgaan). Twee gebeurtenissen, twee syncs, en of ze elkaar in
 * de weg zitten hangt af van de timing van twee await-ketens.
 *
 * Gevonden door background.test.ts: die vuurt twee syncs achter elkaar af en zag
 * `amex-content.js` twee keer in de registratielijst staan. Een wachtrij van één
 * is de goedkoopste oplossing die de eigenschap teruggeeft waar de rest van de
 * functie op rust — dat hij WEET wat er al staat. */
let syncRij: Promise<void> = Promise.resolve();

function planSync(): Promise<void> {
  syncRij = syncRij.then(
    () => syncRegistraties(),
    /* Een mislukte sync mag de rij niet blokkeren: dan zou één fout alle
     * volgende registraties tegenhouden tot de worker opnieuw start. */
    () => syncRegistraties(),
  );
  return syncRij;
}

/** Trekt de gebruiker in chrome://extensions een host-toestemming in, dan is het
 *  vinkje een leugen geworden. Het gaat hier uit, niet pas als hij de opties
 *  opent — anders staat er straks een vinkje aan bij een site waar niets meer
 *  gebeurt, en zoekt hij naar een fout die er niet is. */
chrome.permissions.onRemoved.addListener(() => {
  void (async () => {
    /* Trekt de gebruiker de <all_urls>-toestemming in via chrome://extensions,
     * dan hoort het vinkje in het optiescherm dat ook te tonen — anders zoekt
     * hij naar een fout die er niet is (zie het commentaar bij
     * kassaMagDraaien). */
    if ((await getKassaOveralAan()) && !(await chrome.permissions.contains({ origins: [KASSA_MATCH] }))) {
      await setKassaOveralAan(false);
    }

    /* EN DE BRONNEN, en die doen meer dan een vinkje omzetten: het opgeslagene
     * gaat weg.
     *
     * Dit is de route die buiten ons scherm om loopt. Trekt hij de toestemming
     * in via chrome://extensions, dan komt hij nooit langs de schakelaar in het
     * optiescherm — en zou de gelezen lijst blijven staan terwijl hij zojuist
     * heeft gezegd dat LaVega daar niet meer mag kijken. Een intrekking die
     * alleen toekomstig gedrag verandert, is geen intrekking; dat staat in de
     * kop van amex.ts en het moet dus ook langs deze kant waar zijn.
     *
     * PER BRON, en alleen die ene. Trekt hij de ING-toestemming in, dan hoort
     * zijn Amex-lijst te blijven staan: dat waren twee vragen en dit is één
     * antwoord. `wisBron` raakt alleen de sleutels uit die ene descriptor. */
    for (const bron of BRONNEN) {
      if (!(await getBronAan(bron))) continue;
      if (await chrome.permissions.contains({ origins: [bron.match] })) continue;
      await wisBron(bron);
    }

    await planSync();
  })();
});

chrome.permissions.onAdded.addListener(() => void planSync());
chrome.runtime.onInstalled.addListener(() => void planSync());
chrome.runtime.onStartup.addListener(() => void planSync());

/* De opties schrijven het vinkje naar opslag; hier wordt daarop gereageerd.
 * Zo hoeft het optiescherm niets van registraties te weten en is er één plek
 * waar registratie gebeurt. */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  const bronSleutel = BRONNEN.some((b) => b.sleutels.aan in changes);
  if (!("kassaOveralAan" in changes) && !bronSleutel) return;
  void planSync();
});

/** De host van de afzender, geverifieerd — of null als er iets niet klopt.
 *
 *  Dezelfde drie eisen als voorheen (`siteVanAfzender`), nu zonder een vaste
 *  sitelijst om ze tegen af te zetten: het schema is https, geen poort,
 *  `sender.origin` (indien aanwezig) hoort bij dezelfde URL, en het tabblad
 *  (indien bekend) hoort bij dezelfde ORIGIN — niet meer bij hetzelfde
 *  "site.id", want dat bestaat niet meer sinds er geen sitelijst meer is. */
function hostVanAfzender(sender: chrome.runtime.MessageSender): string | null {
  const url = sender.url;
  if (!url) return null;

  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (u.port !== "") return null;

  if (sender.origin && sender.origin !== u.origin) return null;

  const tabUrl = sender.tab?.url;
  if (tabUrl !== undefined) {
    let tu: URL;
    try {
      tu = new URL(tabUrl);
    } catch {
      return null;
    }
    if (tu.origin !== u.origin) return null;
  }

  return u.hostname.toLowerCase();
}

async function beantwoord(sender: chrome.runtime.MessageSender): Promise<PaneelAntwoord> {
  const host = hostVanAfzender(sender);
  if (!host) return { soort: "zwijg", reden: "afzender is geen geldige https-pagina" };

  if (!(await kassaMagDraaien())) {
    return { soort: "zwijg", reden: "kassa-overal staat uit" };
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
  if (evidence.host.toLowerCase() !== host) {
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
 *  Dezelfde drie eisen als bij een winkel (`siteVanAfzender`) en om dezelfde
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

async function beantwoordAanbod(sender: chrome.runtime.MessageSender): Promise<AanbodAntwoord> {
  const bron = bronVanAfzender(sender);
  if (!bron) return { soort: "zwijg", reden: "afzender hoort niet bij een aanbiedingenbron" };

  /* TWEE SCHAKELAARS, ALLEBEI NODIG, en in deze volgorde. Het vinkje is van hem
   * en de host-toestemming is van Chrome; de tweede wint altijd, maar de eerste
   * hoort te kunnen zonder de tweede in te trekken. Beide worden hier opnieuw
   * gelezen en niet gecachet: tussen het registreren van het script en dit
   * bericht kan hij ze allebei hebben omgezet.
   *
   * EN ZE GELDEN PER BRON. De schakelaar van Amex zegt niets over de ING Winkel
   * en andersom; daarom staat `bron` hier in beide regels. */
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
      /* De lezer van DEZE bron. Chrome verstuurt hem als tekst naar de pagina;
       * zie de uitleg bij `Bron.collect`. */
      func: bron.collect,
      args: [null],
    });
    ruw = uitkomst[0]?.result as RuweLezing | undefined;
  } catch {
    /* Tabblad weg, of de toestemming een seconde geleden ingetrokken. Geen van
     * beide is iets waar hij op deze pagina iets aan heeft. */
    return { soort: "zwijg", reden: "injectie mislukt" };
  }
  if (!ruw) return { soort: "zwijg", reden: "geen lezing" };

  const { lezing, aanbiedingen } = leesAanbod(ruw, asOf, bron);
  await setBronLezing(bron, lezing, aanbiedingen);

  const strook = aanbodStrook(lezing, aanbiedingen.map((a) => a.winkel), bron);
  return {
    soort: "melding",
    gelukt: lezing.uitkomst === "gelezen",
    /* Alleen doorvragen als de pagina nog aan het opbouwen KAN zijn. Bij een
     * inlogscherm is het antwoord definitief: nog vier keer een uitgelogde
     * pagina lezen levert vier keer hetzelfde op, en een strook die pas na tien
     * seconden zegt dat je moet inloggen is tien seconden te laat.
     *
     * "afgeschermd" hoort in dezelfde rij, en juist daar: die uitkomst telt
     * eigen elementen die leeg zijn en geen te openen wortel hebben, en een
     * component die nog niet GEBOUWD is ziet er precies zo uit als een die
     * dicht is. Bij de eerste poging is dat verschil het grootst — dus nog een
     * keer kijken, en pas de laatste lezing op het scherm zetten. */
    opnieuw:
      lezing.uitkomst === "geen-aanbiedingenblok" ||
      lezing.uitkomst === "blok-zonder-kaarten" ||
      lezing.uitkomst === "afgeschermd",
    regel: strook.regel,
    noot: strook.noot,
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const m = message as PaneelVerzoek | AanbodVerzoek | undefined;
  if (m?.soort === "aanbod-vragen") {
    void beantwoordAanbod(sender).then(sendResponse);
    return true;
  }
  if (!m || m.soort !== "paneel-vragen") return;
  /* `true` teruggeven houdt het antwoordkanaal open tot sendResponse komt. Zonder
   * dat sluit Chrome het kanaal zodra deze functie terugkeert en krijgt het
   * content script `undefined` — en dat leest daar als "niets te melden", wat
   * iets heel anders is dan "nog even wachten". */
  void beantwoord(sender).then(sendResponse);
  return true;
});

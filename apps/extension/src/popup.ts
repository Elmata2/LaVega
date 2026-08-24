/* Het venster onder het werkbalkicoon: bedrag intypen, antwoord teruglezen.
 *
 * DIT VENSTER LEEST GEEN ENKELE PAGINA en vraagt daar ook geen toestemming voor.
 * Dat is geen beperking maar het punt: hierdoor werkt het overal — ook op de
 * twintig winkels die niet in sites.ts staan, en ook op een winkel die haar
 * prijs nergens machineleesbaar neerzet. Het handmatige veld is niet het
 * noodgeval, het is het normale geval; het paneel op de winkelpagina is de
 * uitzondering waar we het konden aantonen.
 *
 * WAAROM parseAmountToCents UIT read.ts EN NIET parseFloat. Omdat hier hetzelfde
 * probleem staat als op een winkelpagina: "1.234" kan € 1,23 of € 1.234 zijn en
 * dat scheelt duizend keer. Die functie weigert dat met een reden in plaats van
 * te kiezen, en die reden is al in het Nederlands. Twee keer hetzelfde probleem
 * op twee manieren oplossen is hoe de twee schermen andere antwoorden gaan
 * geven op dezelfde invoer. */

import { parseAmountToCents, reasonTextHandmatig } from "./read.js";
import { rankCheckout } from "./rank.js";
import { panelRows, POPUP_CAPS, footer, puntenBlok, aanbodLijst } from "./panel.js";
import { headline, aanbodGrensRegel } from "./lines.js";
import { euro } from "./money.js";
import { BRONNEN } from "./bronnen.js";
import {
  getHeldIds,
  getPointsBalances,
  getBronAan,
  getBronAanbiedingen,
  getBronLezing,
} from "./store.js";
import { pointsCoverage } from "./points.js";
import { CHECKOUT_CARDS } from "./generated/catalog.generated.js";
import { POINTS_RATES } from "./generated/points-rates.generated.js";

const GROEPKOP: Record<PaneelGroep, string> = {
  mijn: "Jouw kaarten",
  openen: "Zou je kunnen openen",
  achteruit: "Kost na kaartkosten meer dan het oplevert",
  "onbekende-kosten": "Kaartkosten onbekend",
  "geen-euro-uitkomst": "Opbrengst niet in euro's",
  onbekend: "Hier kunnen we niets over zeggen",
};

const PUNTENKOP = "Punten die je hier hebt liggen";

function el(tag: string, klasse: string, tekst?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = klasse;
  if (tekst !== undefined) e.textContent = tekst;
  return e;
}

const uitkomst = document.getElementById("uitkomst") as HTMLDivElement;
const bedragVeld = document.getElementById("bedrag") as HTMLInputElement;
const muntVeld = document.getElementById("munt") as HTMLSelectElement;
const formulier = document.getElementById("formulier") as HTMLFormElement;

function leeg(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

async function bereken(): Promise<void> {
  leeg(uitkomst);
  const ruw = bedragVeld.value.trim();
  const munt = muntVeld.value;

  /* Zonder bedrag wordt er WEL gerangschikt. De volgorde hangt van de
   * percentages af en die staan los van het bedrag, dus er valt iets zinnigs te
   * zeggen — alleen geen euro's, en dat zegt de kop uit lines.ts er zelf bij.
   * Doen alsof er niets te melden is zolang het veld leeg is, zou informatie
   * achterhouden die er gewoon is. */
  let bedragCenten: number | null = null;
  if (ruw) {
    const p = parseAmountToCents(ruw);
    if (!p.ok) {
      /* HIER NIET reasonText GEBRUIKEN, hoe verleidelijk ook. Die teksten zijn
       * geschreven voor het lezen van een PAGINA en eindigen allemaal met "vul
       * het bedrag zelf in". In dit venster heeft hij dat net gedaan: dan staat
       * er "het bedrag op de pagina is niet eenduidig te lezen — vul het bedrag
       * zelf in" onder een veld waar hij zojuist iets in tikte. Dat noemt een
       * oorzaak die er niet is en geeft een advies dat hij al heeft opgevolgd.
       * Gemeten in de browser met invoer "1.234"; het stond er echt.
       *
       * WAT HIER EERST STOND WAS ÉÉN HARDGECODEERDE TEKST, en die was bij vier
       * van de vijf oorzaken onwaar: "vanaf 39,99", "39," en "-5,00" kregen
       * allemaal het verhaal over duizendtallen. Nu komt de tekst per oorzaak
       * uit read.ts, waar hij naast de weigering staat die hem veroorzaakt. */
      const kaart = el("div", "kaart");
      kaart.appendChild(el("div", "kop fout", `"${ruw}" kan LaVega niet als bedrag lezen.`));
      kaart.appendChild(el("div", "noot", reasonTextHandmatig(p.reason)));
      uitkomst.appendChild(kaart);
      return;
    }
    bedragCenten = p.cents;
  }

  const heldIds = await getHeldIds();
  /* De enige klokaflezing in dit scherm, en hij wordt door twee pure functies
   * gedeeld zodat de kaartkant en de puntenkant niet op een andere dag kunnen
   * uitkomen. */
  const asOf = new Date().toISOString().slice(0, 10);
  const punten = pointsCoverage({
    balances: await getPointsBalances(),
    rates: POINTS_RATES,
    /* Alleen bij een euro-aankoop is `bedragCenten` een euro-bedrag waar een
     * puntenkoers op losgelaten mag worden. Staat de munt op USD, dan is het
     * ingevulde bedrag naar eigen zeggen "ongeveer wat er van je rekening af
     * gaat" — dat is euro's, maar de koersopslag zit er nog niet in en het
     * percentage zou dan net te hoog uitvallen. Liever geen percentage. */
    amountCents: munt === "EUR" ? bedragCenten : null,
    asOf,
  });
  const ranking = rankCheckout({
    cards: CHECKOUT_CARDS,
    heldIds,
    currency: munt,
    amountCents: bedragCenten,
    asOf,
  });

  const kaart = el("div", "kaart");
  if (bedragCenten !== null) kaart.appendChild(el("div", "bedrag", euro(bedragCenten)));

  /* De aanbiedingen bovenaan, net als in het paneel, en om dezelfde reden: dit
   * is het enige blok met een einddatum erin. Hier staat de HELE lijst en niet
   * de selectie voor één winkel — dit venster weet niet op welke pagina hij
   * staat en vraagt dat ook niet, dus er wordt niets aan een winkel gekoppeld.
   * Zie `aanbodLijst` voor waarom dat geen inconsistentie is met het paneel. */
  for (const bron of BRONNEN) {
    const aanbod = aanbodLijst(
      {
        aan: await getBronAan(bron),
        lezing: await getBronLezing(bron),
        aanbiedingen: await getBronAanbiedingen(bron),
      },
      asOf,
      bron,
    );
    if (!aanbod.kop) continue;
    kaart.appendChild(el("div", "groep", aanbod.kop));
    if (aanbod.regels.length === 0) {
      kaart.appendChild(el("div", "noot", aanbod.toestand));
    } else {
      for (const r of aanbod.regels) {
        const rij = el("div", "rij");
        rij.appendChild(el("div", "titel", r.titel));
        rij.appendChild(el("div", "regel", r.regel));
        if (r.bron) rij.appendChild(el("div", "bron", r.bron));
        kaart.appendChild(rij);
      }
    }
    /* De grensregel staat hier wél en in het paneel niet. Dit venster opent hij
     * zelf en er is ruimte; het paneel staat over een winkel heen terwijl hij
     * afrekent, en daar hoort een antwoord en geen verantwoording.
     *
     * PER BRON, want de belofte verschilt: bij ING staat "je puntensaldo" in de
     * niet-lijst en bij Amex "je kaartnummer". Eén samengevatte zin zou van twee
     * verschillende beloftes één vage maken. */
    kaart.appendChild(el("div", "bron", aanbodGrensRegel(bron)));
  }

  /* Punten daarna. Dit is wat hij al heeft liggen; de kaartrangschikking
   * eronder gaat over wat hij zou kunnen doen. */
  const blok = puntenBlok(punten, munt === "EUR" ? bedragCenten : null, munt);
  if (blok.leeg) {
    kaart.appendChild(el("div", "groep", PUNTENKOP));
    kaart.appendChild(el("div", "noot", blok.leeg));
  } else if (blok.regels.length > 0) {
    kaart.appendChild(el("div", "groep", PUNTENKOP));
    for (const r of blok.regels) {
      const rij = el("div", "rij");
      rij.appendChild(el("div", "titel", r.titel));
      rij.appendChild(el("div", "regel", r.regel));
      if (r.bron) rij.appendChild(el("div", "bron", r.bron));
      kaart.appendChild(rij);
    }
    if (blok.voetnoot) kaart.appendChild(el("div", "bron", blok.voetnoot));
  }

  kaart.appendChild(el("div", "groep", "Jouw kaarten aan deze kassa"));
  kaart.appendChild(el("div", "kop", headline(ranking)));

  const regels = panelRows(ranking, POPUP_CAPS);
  let vorige: PaneelGroep | null = null;
  for (const r of regels) {
    if (r.groep !== vorige) {
      kaart.appendChild(el("div", "groep", GROEPKOP[r.groep]));
      vorige = r.groep;
    }
    const rij = el("div", "rij");
    rij.appendChild(el("div", "titel", r.titel));
    rij.appendChild(el("div", "regel", r.regel));
    if (r.bron) rij.appendChild(el("div", "bron", r.bron));
    kaart.appendChild(rij);
  }

  kaart.appendChild(el("div", "noot groep", footer(CHECKOUT_CARDS)));
  uitkomst.appendChild(kaart);
}

formulier.addEventListener("submit", (e) => {
  e.preventDefault();
  void bereken();
});

document.getElementById("naar-opties")?.addEventListener("click", (e) => {
  e.preventDefault();
  void chrome.runtime.openOptionsPage();
});

/* Meteen bij openen één keer rekenen. Zonder bedrag geeft dat de volgorde op
 * percentage plus de vraag om het bedrag — nuttiger dan een leeg vlak, en het
 * laat zien dat er kaarten aangevinkt staan (of juist niet). */
void bereken();

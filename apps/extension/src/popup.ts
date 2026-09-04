/* Het venster onder het werkbalkicoon: bedrag intypen, antwoord teruglezen.
 *
 * DIT VENSTER LEEST GEEN ENKELE PAGINA en vraagt daar ook geen toestemming voor.
 * Dat is geen beperking maar het punt: hierdoor werkt het overal — er is geen
 * curated lijst van winkels meer die het paneel wél of niet mag lezen, dus dit
 * venster werkt sowieso op elke winkel, ook een winkel die haar prijs nergens
 * machineleesbaar neerzet. Het handmatige veld is niet het
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
import { aanbodLijst } from "./panel.js";
import { aanbodGrensRegel, puntenLeegRegel, puntenDatumRegel } from "./lines.js";
import { euro, getal } from "./money.js";
import { BRONNEN } from "./bronnen.js";
import { getPointsBalances, getBronAan, getBronAanbiedingen, getBronLezing } from "./store.js";
import { pointsCoverage } from "./points.js";
import { POINTS_RATES } from "./generated/points-rates.generated.js";

const WAARDEKOP = "Wat je punten waard zijn";
const PUNTENKOP = "Punten die je hier hebt liggen";

/** "Bijgewerkt op 21 augustus 2026." — de datum uit puntenBron in lines.ts,
 *  hier los omdat dit venster alleen de datum toont en niet de rest van die
 *  regel (koers, herkomst, verouderingswaarschuwing). Geen lege datum stil
 *  maken: zie de kop van points.ts over waarom een saldo zonder datum niet
 *  als vers mag ogen. */
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

  /* Zonder bedrag wordt er WEL getoond. Wat de punten waard zijn en wat er
   * ligt hangt niet van deze aankoop af — alleen de dekking van een aankoop
   * (die hier niet meer getoond wordt) zou een bedrag nodig hebben. */
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

  /* De enige klokaflezing in dit scherm. */
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

  const kaart = el("div", "kaart");
  if (bedragCenten !== null) kaart.appendChild(el("div", "bedrag", euro(bedragCenten)));

  /* 1. DE KOP VAN DIT VENSTER: wat zijn punten in euro's waard zijn, los van
   * deze aankoop. `saldoWaardeCents` staat al in points.ts uitgerekend — hier
   * wordt alleen gefilterd en geformatteerd, nooit gerekend. Een programma
   * zonder gepubliceerde koers (of met een uitgesproken nul of "geen vaste
   * waarde") heeft geen `saldoWaardeCents` en verschijnt hier dus niet; dat
   * saldo staat wel in het blok eronder. */
  const metWaarde = punten.filter((p) => p.saldoWaardeCents !== null);
  if (metWaarde.length > 0) {
    kaart.appendChild(el("div", "groep", WAARDEKOP));
    for (const p of metWaarde) {
      const rij = el("div", "rij");
      rij.appendChild(el("div", "titel", p.program));
      rij.appendChild(el("div", "regel", euro(p.saldoWaardeCents!)));
      kaart.appendChild(rij);
    }
  }

  /* 2. DE SALDI ZELF, super simpel: naam, aantal, datum — verder niets. De
   * langere uitlegzinnen (koersbron, inwisselroute, verouderingswaarschuwing)
   * staan in het paneel op de winkelpagina, niet hier. */
  kaart.appendChild(el("div", "groep", PUNTENKOP));
  if (punten.length === 0) {
    kaart.appendChild(el("div", "noot", puntenLeegRegel()));
  } else {
    for (const p of punten) {
      const rij = el("div", "rij");
      rij.appendChild(el("div", "titel", `${p.program} · ${getal(p.points, 0)}`));
      rij.appendChild(el("div", "regel", puntenDatumRegel(p)));
      kaart.appendChild(rij);
    }
  }

  /* 3. De aanbiedingen. Hier staat de HELE lijst en niet de selectie voor één
   * winkel — dit venster weet niet op welke pagina hij staat en vraagt dat ook
   * niet, dus er wordt niets aan een winkel gekoppeld. Zie `aanbodLijst` voor
   * waarom dat geen inconsistentie is met het paneel. */
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

/* Meteen bij openen één keer rekenen. Zonder bedrag geeft dat meteen de
 * puntenwaarde en de aanbiedingen te zien — nuttiger dan een leeg vlak. */
void bereken();

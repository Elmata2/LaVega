/* Het optiescherm: welke kaarten heb je, en welke winkels mogen gelezen worden.
 *
 * ── DE TOESTEMMINGSDANS, en waarom de volgorde er echt toe doet ───────────
 *
 * `chrome.permissions.request` mag ALLEEN tijdens een gebruikersgebaar. Een
 * `await` ervóór — bijvoorbeeld om eerst even de opslag te lezen — beëindigt dat
 * gebaar, en dan mislukt de aanroep met "This function must be called during a
 * user gesture". Dat is een fout die je in ontwikkeling niet ziet als je de
 * opslag toevallig al in het geheugen hebt, en in productie altijd. Daarom staat
 * `request` in de klikafhandelaar op de eerste regel en gebeurt al het andere
 * daarna.
 *
 * DE VOLGORDE BIJ AANZETTEN: eerst toestemming vragen, dan pas het vinkje
 * bewaren. Andersom zou het vinkje aan blijven staan als hij in het dialoogje
 * op "weigeren" klikt, en dan belooft dit scherm iets wat Chrome niet toestaat.
 *
 * DE VOLGORDE BIJ UITZETTEN: eerst het vinkje weg, dan pas de toestemming
 * intrekken. Andersom kan de service worker in het gaatje daartussen nog denken
 * dat de site aanstaat terwijl de toestemming al weg is, en dan mislukt de
 * injectie met een fout in plaats van dat het paneel netjes wegblijft.
 *
 * ── WAAROM DE KAARTENLIJST TOONT WAT WE WETEN ──────────────────────────────
 *
 * Onder elke kaart staat welke cijfers we van dat product hebben. Niet als
 * versiering: bij 77 producten heeft lang niet alles een cashbackcijfer, en een
 * kaart aanvinken die daarna nergens in de ranglijst opduikt, ziet eruit als een
 * kapotte extensie. Nu staat er van tevoren "koersopslag bekend, cashback niet"
 * en klopt het gedrag met wat er beloofd is. */

import { SITES, type Site } from "./sites.js";
import {
  getHeldIds,
  setHeldIds,
  getEnabledSiteIds,
  setEnabledSiteIds,
  getPointsBalances,
  setPointsBalances,
} from "./store.js";
import { CHECKOUT_CARDS, CATALOG_GENERATED_AT } from "./generated/catalog.generated.js";
import { POINTS_RATES } from "./generated/points-rates.generated.js";
import { pct, dateNL, euro, eurosToCents, getal } from "./money.js";
import { leesVoorwaarden } from "./rank.js";
import { normaliseerProgramma, zoekKoers, VEROUDERD_NA_DAGEN, type PointsBalance } from "./points.js";
import { citaat } from "./lines.js";
import type { CheckoutCard } from "./types.js";

function el(tag: string, klasse: string, tekst?: string): HTMLElement {
  const e = document.createElement(tag);
  e.className = klasse;
  if (tekst !== undefined) e.textContent = tekst;
  return e;
}
function leeg(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/* ───────────────────────────── de kaarten ────────────────────────────────── */

const lijst = document.getElementById("kaartenlijst") as HTMLDivElement;
const zoek = document.getElementById("zoek") as HTMLInputElement;
const telling = document.getElementById("kaarten-telling") as HTMLParagraphElement;

let aangevinkteKaarten = new Set<string>();

/** Of er bij een cijfer een voorwaarde hoort, en of het een voorwaardelijke NUL
 *  is. Dat laatste apart, want dat is het geval waarin het cijfer op het scherm
 *  precies het tegenovergestelde suggereert van wat er geldt: The Blue Card
 *  staat in de catalogus op € 0 per jaar, met in de voorwaarde "de nul geldt
 *  alleen bij een minimale besteding van € 3.000 per jaar; anders € 35". "Kosten
 *  € 0,00 per jaar" zou daar een uitgesproken nul van maken, en dat is hij niet.
 *
 *  De peildatum is hier de datum van de catalogus zelf. Dit scherm gebruikt
 *  alleen of er een voorwaarde IS, nooit of een einddatum verlopen is — dat
 *  laatste hoort bij een aankoop en niet bij een lijst met producten. */
function voorwaardeNoot(bron: { value: number; conditions: string | null } | null): string {
  if (!bron) return "";
  const vw = leesVoorwaarden(bron.conditions, "kaartkosten", bron.value, CATALOG_GENERATED_AT);
  if (vw.length === 0) return "";
  if (vw.some((v) => v.soort === "voorwaardelijke-nul")) return " (deze nul geldt alleen onder voorwaarden)";
  /* Bewust zwak geformuleerd. Bij twintig van de zevenentwintig kaarten met een
   * prijs is de voorwaardentekst een herkomstnotitie ("de datum is het
   * versiestempel …") en geen beperking. "Er staat een voorwaarde bij" is dan
   * nog steeds waar; "deze prijs geldt onder voorwaarden" zou dat niet zijn. Het
   * paneel spelt de voorwaarde uit; dit scherm meldt alleen dat ze er is. */
  return " (er staat een voorwaarde bij)";
}

/** Wat we van deze kaart weten, in gewone taal. Ontbrekende cijfers worden
 *  GENOEMD en niet weggelaten: een kaart waarvan we de cashback niet kennen, is
 *  iets anders dan een kaart met 0% cashback, en het verschil hoort te zien te
 *  zijn vóór hij hem aanvinkt.
 *
 *  De bedragen lopen door money.ts. Hier stond eerst `€ ${c.fee.value}`, en dat
 *  gaf op een Nederlands scherm "kosten € 37.5 per jaar" — met een Engelse punt,
 *  en niet te onderscheiden van € 37,05. */
function watWeWeten(c: CheckoutCard): string {
  const bits: string[] = [];
  bits.push(c.fxFeePct ? `koersopslag ${pct(c.fxFeePct.value)}${voorwaardeNoot(c.fxFeePct)}` : "koersopslag onbekend");
  bits.push(c.cashbackPct ? `cashback ${pct(c.cashbackPct.value)}${voorwaardeNoot(c.cashbackPct)}` : "cashback onbekend");
  /* Door money.ts, net als de bedragen ernaast. Hier stond
   * `${c.pointsPerEuro.value}` en dat gaf op een Nederlands scherm "0.5 punt(en)
   * per euro" — een Engelse punt, en bij vier van de eenenvijftig kaarten met
   * een puntencijfer viel dat op. Dit is precies dezelfde bevinding als
   * "€ 37.5 per jaar" één veld verderop; die is toen gerepareerd en deze bleef
   * staan omdat er per veld werd gekeken in plaats van per regel. */
  if (c.pointsPerEuro) bits.push(`${getal(c.pointsPerEuro.value)} punt(en) per euro`);
  bits.push(
    c.fee
      ? `kosten ${euro(eurosToCents(c.fee.value))} per ${c.fee.period}${voorwaardeNoot(c.fee)}`
      : "kaartkosten onbekend",
  );
  return bits.join(" · ");
}

const GESORTEERD = [...CHECKOUT_CARDS].sort((a, b) => a.product.localeCompare(b.product, "nl"));

function tekenKaarten(): void {
  const term = zoek.value.trim().toLowerCase();
  const zichtbaar = term
    ? GESORTEERD.filter(
        (c) => c.product.toLowerCase().includes(term) || c.issuer.toLowerCase().includes(term),
      )
    : GESORTEERD;

  leeg(lijst);
  for (const c of zichtbaar) {
    const rij = el("div", "vinkrij");
    const vink = document.createElement("input");
    vink.type = "checkbox";
    vink.id = `kaart-${c.id}`;
    vink.checked = aangevinkteKaarten.has(c.id);
    vink.addEventListener("change", () => {
      if (vink.checked) aangevinkteKaarten.add(c.id);
      else aangevinkteKaarten.delete(c.id);
      void setHeldIds([...aangevinkteKaarten]);
      toonTelling();
    });

    const tekst = document.createElement("label");
    tekst.htmlFor = vink.id;
    tekst.appendChild(el("div", "titel", c.product));
    tekst.appendChild(el("div", "noot", c.issuer));
    tekst.appendChild(el("div", "noot", watWeWeten(c)));

    rij.appendChild(vink);
    rij.appendChild(tekst);
    lijst.appendChild(rij);
  }

  if (zichtbaar.length === 0) {
    lijst.appendChild(el("p", "noot", `Geen kaart gevonden voor "${zoek.value.trim()}".`));
  }
}

function toonTelling(): void {
  const n = aangevinkteKaarten.size;
  telling.textContent =
    n === 0
      ? `${CHECKOUT_CARDS.length} producten in de bundel. Je hebt er nog geen aangevinkt — zonder aangevinkte kaart kan LaVega niet zeggen wat je nu het beste kunt doen, alleen wat er te halen valt.`
      : `${CHECKOUT_CARDS.length} producten in de bundel, ${n} aangevinkt.`;
}

zoek.addEventListener("input", tekenKaarten);

/* ────────────────────────────── de punten ────────────────────────────────── */

/* WAAROM DE SALDI HIER WORDEN INGETYPT EN NIET UIT DE KLUIS KOMEN, staat voluit
 * in de kop van store.ts. Kort: een brug naar de LaVega-tab is een nieuw kanaal
 * met een tweede redactiegrens en hij werkt niet met de tab dicht; twee keer
 * invoeren levert saldi op die uit elkaar lopen. Dat tweede is niet te
 * voorkomen, alleen zichtbaar te maken — en dat gebeurt hier, met de datum bij
 * elk saldo en een waarschuwing zodra hij ouder is dan negentig dagen.
 *
 * WAT ER GEBEURT ALS HET VELD LEEG WORDT GEMAAKT: de regel verdwijnt uit de
 * opslag. Niet "op nul zetten": nul punten en geen saldo zijn twee verschillende
 * uitspraken, en de eerste zou aan een kassa een regel opleveren over een
 * programma waar niets ligt. */

const puntenLijst = document.getElementById("puntenlijst") as HTMLDivElement;
const puntenMelding = document.getElementById("punten-melding") as HTMLParagraphElement;
const puntenFormulier = document.getElementById("punten-toevoegen") as HTMLFormElement;
const puntenNaam = document.getElementById("punten-naam") as HTMLInputElement;
const puntenAantal = document.getElementById("punten-aantal") as HTMLInputElement;

let saldi: PointsBalance[] = [];

/** De peildatum van dit scherm. De enige klokaflezing hier, en hij staat bewust
 *  in één functie: een saldo dat hij vandaag bevestigt, draagt de datum van
 *  vandaag, en points.ts rekent daar later mee zonder zelf een klok te kennen. */
function vandaag(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Alleen hele, niet-negatieve getallen. Een punt of komma erin is bijna altijd
 *  een duizendteken ("42.000") en nooit een decimaal: een halve mijl bestaat
 *  niet. We halen ze dus weg in plaats van te weigeren — maar alleen als er
 *  daarna niets anders dan cijfers overblijft. */
function leesAantal(ruw: string): number | null {
  const t = ruw.trim();
  if (t === "") return null;
  const kaal = t.replace(/[.\s ]/g, "");
  if (!/^\d+$/.test(kaal)) return null;
  const n = Number(kaal);
  if (!Number.isSafeInteger(n) || n < 0 || n > 1_000_000_000) return null;
  return n;
}

/** Horen deze twee namen bij hetzelfde programma?
 *
 *  NIET ALLEEN OP DE LETTERLIJKE NAAM VERGELIJKEN, en dat is gemeten. Wie zijn
 *  saldo onder "Amex" opschrijft, kreeg in dit scherm TWEE rijen: "Membership
 *  Rewards" met de koers en een leeg veld, en daaronder "Amex" met de mededeling
 *  "we kennen geen koers voor dit programma" — wat onwaar is, want die koers
 *  staat één rij hoger. Dezelfde aliaslijst die het paneel gebruikt om de koers
 *  te vinden, hoort dus ook hier te bepalen of twee namen hetzelfde programma
 *  zijn. */
function zelfdeProgramma(a: string, b: string): boolean {
  if (normaliseerProgramma(a) === normaliseerProgramma(b)) return true;
  const ka = zoekKoers(a, POINTS_RATES);
  const kb = zoekKoers(b, POINTS_RATES);
  return ka !== null && kb !== null && ka.program === kb.program;
}

function saldoVan(programma: string): PointsBalance | undefined {
  return saldi.find((b) => zelfdeProgramma(b.program, programma));
}

async function zetSaldo(programma: string, punten: number | null): Promise<void> {
  /* Alles wat bij hetzelfde programma hoort eruit, ook als hij het onder een
   * andere naam had staan. Anders levert een invoer op de rij "Membership
   * Rewards" een tweede saldo naast het bestaande "Amex" op, en dan telt het
   * paneel twee keer punten die hij één keer heeft. */
  saldi = saldi.filter((b) => !zelfdeProgramma(b.program, programma));
  if (punten !== null) saldi.push({ program: programma, points: punten, updatedAt: vandaag() });
  await setPointsBalances(saldi);
  tekenPunten();
}

/** Wat we over de koers van dit programma weten, in één regel onder het veld.
 *  Vier soorten, vier zinnen — zie de kop van points.ts voor waarom "geen koers"
 *  niet één ding is. */
function koersNoot(programma: string): string {
  const rate = POINTS_RATES.find((r) => r.program === programma);
  if (!rate) return "We kennen geen koers voor dit programma. LaVega toont dan alleen dát je punten hebt.";
  switch (rate.soort) {
    case "koers":
      return `Koers bekend: ${citaat(rate.quote)} Geldt voor ${rate.scope}, gelezen ${dateNL(rate.gelezenOp)}.`;
    /* "De uitgever" en niet de programmanaam: "ING Punten zegt zelf" laat een
     * programma spreken, en dat doet het niet. */
    case "uitgesproken-nul":
      return `De uitgever zegt zelf: ${citaat(rate.quote)} Aan een kassa dekken ze dus niets; LaVega zet er geen percentage bij.`;
    case "geen-vaste-waarde":
      return `De uitgever zegt zelf: ${citaat(rate.quote)} Er is dus geen koers om mee te rekenen — en dat is iets anders dan nul.`;
    case "niet-gepubliceerd":
      return "Wij hebben voor dit programma geen koers kunnen lezen. Dat is een gat in onze meting, geen uitspraak van de uitgever.";
  }
}

function dagenSinds(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const toen = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const nuM = /^(\d{4})-(\d{2})-(\d{2})$/.exec(vandaag())!;
  const nu = Date.UTC(Number(nuM[1]), Number(nuM[2]) - 1, Number(nuM[3]));
  return Math.round((nu - toen) / 86_400_000);
}

function tekenPunten(): void {
  leeg(puntenLijst);

  /* Eerst de programma's waarvan we iets weten, in de volgorde van het
   * gegenereerde bestand. Daarna alles wat hij zelf heeft toegevoegd. */
  const bekend = POINTS_RATES.map((r) => r.program);
  const eigen = saldi.map((b) => b.program).filter((naam) => zoekKoers(naam, POINTS_RATES) === null);
  const namen = [...bekend, ...eigen];

  for (const naam of namen) {
    const saldo = saldoVan(naam);
    const rij = el("div", "puntrij");

    const veld = el("div", "veld");
    const invoer = document.createElement("input");
    invoer.type = "text";
    invoer.inputMode = "numeric";
    invoer.id = `punten-${normaliseerProgramma(naam).replace(/ /g, "-")}`;
    invoer.placeholder = "leeg";
    invoer.autocomplete = "off";
    invoer.value = saldo ? getal(saldo.points, 0) : "";
    /* `change` en niet `input`: anders schrijft elke toetsaanslag een nieuwe
     * datum weg, en dan betekent "ingevoerd op" niet meer dat hij het toen heeft
     * bevestigd maar dat hij toen aan het typen was. */
    invoer.addEventListener("change", () => {
      const ruw = invoer.value.trim();
      if (ruw === "") {
        void zetSaldo(naam, null);
        puntenMelding.textContent = `${naam} staat niet meer in de lijst.`;
        puntenMelding.className = "hint";
        return;
      }
      const n = leesAantal(ruw);
      if (n === null) {
        puntenMelding.textContent =
          `"${ruw}" is geen aantal punten. Alleen hele getallen; een duizendpunt mag ("42.000").`;
        puntenMelding.className = "hint fout";
        return;
      }
      puntenMelding.textContent = `${naam}: ${getal(n, 0)} punten, met de datum van vandaag erbij.`;
      puntenMelding.className = "hint";
      void zetSaldo(naam, n);
    });
    veld.appendChild(invoer);

    const tekst = el("div", "tekst");
    const label = document.createElement("label");
    label.htmlFor = invoer.id;
    label.className = "titel";
    label.textContent = naam;
    tekst.appendChild(label);
    tekst.appendChild(el("div", "noot", koersNoot(naam)));
    if (saldo) {
      const dagen = saldo.updatedAt === "" ? null : dagenSinds(saldo.updatedAt);
      const wanneer =
        saldo.updatedAt === ""
          ? "Bij dit saldo staat geen datum, dus we weten niet hoe oud het is."
          : `Ingevoerd op ${dateNL(saldo.updatedAt)}.`;
      const oud =
        dagen !== null && dagen > VEROUDERD_NA_DAGEN
          ? ` Dat is ${dagen} dagen geleden — LaVega zegt er aan de kassa bij dat dit saldo oud is.`
          : "";
      tekst.appendChild(el("div", "noot", wanneer + oud));
    }

    rij.appendChild(veld);
    rij.appendChild(tekst);

    /* Alleen bij zelf toegevoegde programma's een knop, want de vier bekende
     * rijen verdwijnen niet: die horen in de lijst te blijven staan zodat hij
     * ziet dat de extensie ze kent. Leegmaken van het veld is daar het
     * weghalen. */
    if (saldo && zoekKoers(naam, POINTS_RATES) === null) {
      const weg = document.createElement("button");
      weg.type = "button";
      weg.className = "weg";
      weg.textContent = "Weghalen";
      weg.addEventListener("click", () => {
        void zetSaldo(naam, null);
        puntenMelding.textContent = `${naam} is weggehaald.`;
        puntenMelding.className = "hint";
      });
      rij.appendChild(weg);
    }

    puntenLijst.appendChild(rij);
  }
}

puntenFormulier.addEventListener("submit", (e) => {
  e.preventDefault();
  const naam = puntenNaam.value.trim();
  const n = leesAantal(puntenAantal.value);
  if (naam === "") {
    puntenMelding.textContent = "Vul een naam in, anders weet LaVega niet waar dit saldo bij hoort.";
    puntenMelding.className = "hint fout";
    return;
  }
  if (n === null) {
    puntenMelding.textContent = "Vul een aantal punten in — alleen hele getallen.";
    puntenMelding.className = "hint fout";
    return;
  }
  puntenNaam.value = "";
  puntenAantal.value = "";
  puntenMelding.textContent = `${naam}: ${getal(n, 0)} punten toegevoegd, met de datum van vandaag.`;
  puntenMelding.className = "hint";
  void zetSaldo(naam, n);
});

/* ───────────────────────────── de winkels ────────────────────────────────── */

const sitesLijst = document.getElementById("siteslijst") as HTMLDivElement;
const sitesMelding = document.getElementById("sites-melding") as HTMLParagraphElement;

function meld(tekst: string, fout = false): void {
  sitesMelding.textContent = tekst;
  sitesMelding.className = fout ? "hint fout" : "hint";
}

async function zetSite(site: Site, aan: boolean, vink: HTMLInputElement): Promise<void> {
  const ids = new Set(await getEnabledSiteIds());
  if (aan) {
    ids.add(site.id);
    await setEnabledSiteIds([...ids]);
    meld(`${site.label} staat aan. Herlaad een openstaande winkelpagina om het paneel te zien.`);
  } else {
    ids.delete(site.id);
    await setEnabledSiteIds([...ids]);
    /* Pas ná het vinkje: zie de kop van dit bestand. */
    await chrome.permissions.remove({ origins: [site.match] });
    meld(`${site.label} staat uit. De leestoestemming is ingetrokken.`);
  }
  vink.checked = aan;
}

function tekenSites(aangevinkt: Set<string>, toegestaan: Set<string>): void {
  leeg(sitesLijst);
  for (const site of SITES) {
    const rij = el("div", "vinkrij");
    const vink = document.createElement("input");
    vink.type = "checkbox";
    vink.id = `site-${site.id}`;
    /* Aan is aan ALS beide waar zijn. Staat het vinkje in de opslag maar heeft
     * Chrome de toestemming niet (meer), dan is de waarheid "uit" — en die tonen
     * we, want een vinkje dat aanstaat bij een site waar niets gebeurt, laat hem
     * zoeken naar een fout die er niet is. */
    vink.checked = aangevinkt.has(site.id) && toegestaan.has(site.id);

    vink.addEventListener("change", () => {
      const wil = vink.checked;
      if (!wil) {
        void zetSite(site, false, vink);
        return;
      }
      /* EERSTE REGEL van de afhandelaar, zonder await ervoor: anders is het
       * gebruikersgebaar voorbij en weigert Chrome het verzoek. */
      chrome.permissions
        .request({ origins: [site.match] })
        .then((gegeven) => {
          if (!gegeven) {
            vink.checked = false;
            meld(
              `Zonder toestemming voor ${site.match} kan het paneel daar niet verschijnen. Het handmatige veld in het werkbalkvenster werkt wel gewoon.`,
              true,
            );
            return;
          }
          return zetSite(site, true, vink);
        })
        .catch(() => {
          vink.checked = false;
          meld("Chrome heeft het toestemmingsverzoek afgebroken. Probeer het opnieuw.", true);
        });
    });

    const tekst = document.createElement("label");
    tekst.htmlFor = vink.id;
    tekst.appendChild(el("div", "titel", site.label));
    tekst.appendChild(el("div", "noot", `${site.match} — ${site.scope}`));
    tekst.appendChild(el("div", "noot", site.evidence));

    rij.appendChild(vink);
    rij.appendChild(tekst);
    sitesLijst.appendChild(rij);
  }
}

/* ────────────────────────────── opstarten ────────────────────────────────── */

async function start(): Promise<void> {
  aangevinkteKaarten = new Set(await getHeldIds());
  tekenKaarten();
  toonTelling();

  saldi = await getPointsBalances();
  tekenPunten();

  const aangevinkteSites = new Set(await getEnabledSiteIds());
  const toegestaan = new Set<string>();
  for (const site of SITES) {
    if (await chrome.permissions.contains({ origins: [site.match] })) toegestaan.add(site.id);
  }
  tekenSites(aangevinkteSites, toegestaan);

  const herkomst = document.getElementById("herkomst");
  if (herkomst) {
    herkomst.textContent =
      `De kaartgegevens komen uit de LaVega-catalogus van ${dateNL(CATALOG_GENERATED_AT)} en zitten in de ` +
      `bundel; ze worden niet bijgewerkt zonder een nieuwe versie van de extensie. Bij elk cijfer hoort ` +
      `een bron en een controledatum — die staan in de regel onder de uitkomst, zodat je kunt zien hoe ` +
      `oud een cijfer is voordat je erop afgaat.`;
  }
}

void start();

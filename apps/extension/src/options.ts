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
import { getHeldIds, setHeldIds, getEnabledSiteIds, setEnabledSiteIds } from "./store.js";
import { CHECKOUT_CARDS, CATALOG_GENERATED_AT } from "./generated/catalog.generated.js";
import { pct, dateNL } from "./money.js";
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

/** Wat we van deze kaart weten, in gewone taal. Ontbrekende cijfers worden
 *  GENOEMD en niet weggelaten: een kaart waarvan we de cashback niet kennen, is
 *  iets anders dan een kaart met 0% cashback, en het verschil hoort te zien te
 *  zijn vóór hij hem aanvinkt. */
function watWeWeten(c: CheckoutCard): string {
  const bits: string[] = [];
  bits.push(c.fxFeePct ? `koersopslag ${pct(c.fxFeePct.value)}` : "koersopslag onbekend");
  bits.push(c.cashbackPct ? `cashback ${pct(c.cashbackPct.value)}` : "cashback onbekend");
  if (c.pointsPerEuro) bits.push(`${c.pointsPerEuro.value} punt(en) per euro`);
  bits.push(c.fee ? `kosten € ${c.fee.value} per ${c.fee.period}` : "kaartkosten onbekend");
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

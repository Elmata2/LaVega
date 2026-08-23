// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import type { Tx } from "@lavega/core";
import StatistiekBlock, { weggelatenLabelNL } from "./StatistiekBlock";
import { freshTxs, own, rules, txs } from "./fixtures";

/* REVIEW 4, PUNTEN 2 EN 3 — "the usual should be just the graphs and the
 * numbers, and all the text below it should be a show more."
 *
 * Dit bestand bewaakt de gevaarlijke helft van die wens. Opvouwen is makkelijk;
 * de vraag is of de onderbouwing daarna nog te vínden is. Een cijfer waarvan de
 * herkomst verdwenen is, is erger dan een druk scherm — dus elke zin die dicht
 * gaat, wordt hier drie keer nagelopen: hij staat er nog, hij zit in een paneel
 * dat opengaat, en de regel eromheen is standaard dicht.
 *
 * En de andere kant op: een WEIGERING ("te weinig maanden om dit te kunnen
 * zeggen") en een UITKOMST (de percentielzin, de piekdagzin, de twee totalen)
 * mogen nóóit in een paneel belanden. Een weigering wegstoppen laat het scherm
 * leeg lijken terwijl er iets te zeggen valt, en dat is de duurste manier om
 * rustig te ogen.
 *
 * jsdom plus React's eigen root-API: de drie andere weergaven zitten achter een
 * tab, dus er valt niets te zien zonder te klikken, en er is in deze repo geen
 * testbibliotheek geïnstalleerd. jsdom opent een <details> wél op een klik
 * (niet op Enter — zie ToonMeer.tsx), en dat is precies wat hier nodig is. */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function mount(rows: Tx[] = txs, r = rules): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  const el = host;
  act(() => {
    root = createRoot(el);
    root.render(<StatistiekBlock txs={rows} rules={r} own={own} onSelectCategory={() => {}} />);
  });
  return el;
}

function tab(el: HTMLElement, label: string) {
  const button = [...el.querySelectorAll<HTMLButtonElement>("button.module-tab")].find(
    (b) => b.textContent === label,
  );
  if (!button) throw new Error(`geen tab "${label}"`);
  act(() => button.click());
}

/** Het diepste element dat `needle` bevat — dus de <p> zelf en niet de hele
 *  module. Zonder deze filtering zou `closest("details")` altijd null geven,
 *  omdat de bovenste treffer het blok zelf is. */
function node(el: HTMLElement, needle: string): HTMLElement {
  const hits = [...el.querySelectorAll<HTMLElement>("*")].filter((n) => n.textContent?.includes(needle));
  const leaves = hits.filter((n) => !hits.some((o) => o !== n && n.contains(o)));
  if (leaves.length === 0) throw new Error(`niet op het scherm: "${needle}"`);
  return leaves[0];
}

/** De drie eisen aan een opgevouwen zin, in één stap: hij staat er, hij zit in
 *  een paneel, de regel is dicht, en hij gaat open van een klik. Geeft het
 *  label van de regel terug, want dát is wat de lezer met de regel dicht ziet. */
function opvouwbaar(el: HTMLElement, needle: string): string {
  const target = node(el, needle);
  const panel = target.closest(".toonmeer-panel");
  expect(panel, `"${needle}" staat niet in een toon-meer-paneel`).not.toBeNull();

  const details = target.closest("details") as HTMLDetailsElement | null;
  expect(details, `"${needle}" heeft geen <details> om open te klikken`).not.toBeNull();
  expect(details!.open, `"${needle}" staat standaard open`).toBe(false);

  const summary = details!.querySelector("summary")!;
  act(() => summary.click());
  expect(details!.open, `"${needle}" gaat niet open van een klik`).toBe(true);
  // En de zin is er ná het openen nog steeds: opvouwen mag niets vervangen.
  expect(details!.textContent).toContain(needle);
  return summary.textContent ?? "";
}

/** Staat deze zin op de voorgrond — dus in geen enkele <details>? */
function staatVooraan(el: HTMLElement, needle: string) {
  expect(node(el, needle).closest("details"), `"${needle}" is opgevouwen en dat mag niet`).toBeNull();
}

/* Acht maanden boodschappen en energie, oplopend, zodat de percentiellijst een
 * echte plaats kan berekenen in plaats van te weigeren. De weigering zelf wordt
 * verderop met de gewone fixture getest — allebei moeten ze kloppen. */
const langeGeschiedenis: Tx[] = [];
for (let m = 1; m <= 8; m++) {
  const mm = String(m).padStart(2, "0");
  langeGeschiedenis.push(
    { id: `ah${m}`, accountKey: "A1", date: `2026-${mm}-05`, amount: -(80 + m * 12), currency: "EUR", counterparty: "Albert Heijn", description: "", category: "", manual: false },
    { id: `en${m}`, accountKey: "A1", date: `2026-${mm}-02`, amount: -160, currency: "EUR", counterparty: "Vattenfall", description: "", category: "", manual: false },
    { id: `in${m}`, accountKey: "A1", date: `2026-${mm}-01`, amount: 4_000, currency: "EUR", counterparty: "Klant BV", description: "", category: "", manual: false },
  );
}

/* Augustus met twee echte uitgaven en € 20.000 die alleen van plek veranderde:
 * de rijen waarop ooit "2 miljoen aan sparen en beleggen" verscheen. Dat bedrag
 * is de reden dat de regel "buiten deze cijfers gehouden" bestaat, dus het is
 * ook de rij waarop getest wordt of dat bedrag zichtbaar blijft. */
const metVerplaatstGeld: Tx[] = [
  { id: "w1", accountKey: "A1", date: "2026-08-01", amount: 6_000, currency: "EUR", counterparty: "Klant BV", description: "Managementfee", category: "", manual: false },
  { id: "w2", accountKey: "A1", date: "2026-08-03", amount: -85.4, currency: "EUR", counterparty: "Albert Heijn", description: "Boodschappen", category: "", manual: false },
  { id: "w3", accountKey: "A1", date: "2026-08-06", amount: -15_000, currency: "EUR", counterparty: "Trading 212", description: "Storting", category: "", manual: false },
  { id: "w4", accountKey: "A1", date: "2026-08-07", amount: -5_000, currency: "EUR", counterparty: "Spaarrekening", description: "Naar spaarrekening", category: "", manual: false },
];

/** De fixture plus drie kleine uitgaven, zodat er iets is om weg te laten. */
const metKleintjes: Tx[] = [
  ...txs,
  { ...txs[1], id: "m1", date: "2026-08-04", amount: -40, counterparty: "NS", description: "Trein" },
  { ...txs[1], id: "m2", date: "2026-08-05", amount: -30, counterparty: "Apotheek", description: "Zorg" },
  { ...txs[1], id: "m3", date: "2026-08-06", amount: -20, counterparty: "Bioscoop", description: "Film" },
];

test("de uitleg onder de categoriegrafiek is opgevouwen én nog te openen", () => {
  const el = mount(metKleintjes);
  // De zin die hij bij naam noemde ("tien kleinere categorieën…") staat niet
  // meer standaard onder de grafiek, maar hij is er nog wel.
  const label = opvouwbaar(el, "3 kleinere categorieën niet getoond in 9 jun – 11 aug 2026");
  // En de telling is niet mee naar binnen gevouwen: met de regel dicht weet je
  // nog steeds dát er drie categorieën buiten de grafiek zijn gebleven.
  expect(label).toContain("Wat hier niet in staat");
  expect(label).toContain("3 kleinere categorieën");
});

test("zonder weggelaten categorieën staat er ook geen regel die iets belooft", () => {
  // De gewone fixture laat niets weg. Dan hoort er geen "toon meer" te staan die
  // uitnodigt tot een leeg paneel.
  const el = mount(txs);
  expect(el.textContent).not.toContain("Wat hier niet in staat");
});

test("de percentiellijst blijft staan; alleen waaróp hij rust vouwt op", () => {
  const el = mount(langeGeschiedenis);

  // De uitkomst — de plaats in zijn eigen maanden — is het antwoord zelf en
  // staat vooraan. Dit is de val uit de opdracht: dit is geen uitleg.
  const rijen = [...el.querySelectorAll<HTMLElement>(".lv-percentiel-rij")];
  expect(rijen.length).toBeGreaterThan(0);
  for (const rij of rijen) expect(rij.closest("details")).toBeNull();
  expect(el.textContent).toMatch(/hoger dan \d+ van je laatste \d+ maanden|even hoog als|lager dan/);

  // Wélke maand met welke maanden vergeleken wordt, staat ook vooraan: zonder
  // die noemer is "hoger dan 6 van je laatste 7 maanden" een zwevende bewering.
  const kop = node(el, "tegenover je eerdere maanden");
  expect(kop.closest("summary"), "de vergeleken maand mag niet in het paneel").not.toBeNull();

  // Wat er precies naast gelegd is, is de onderbouwing en die vouwt wel op.
  opvouwbaar(el, "en daar liggen dezelfde eerste");
});

test("een weigering wordt nooit opgevouwen — ook niet als het scherm er leeg van oogt", () => {
  // Te weinig maanden om een plaats te bepalen. Dat is de uitkomst, niet de
  // uitleg: wie hem wegstopt, laat het scherm zwijgen terwijl er iets te melden
  // is, en dat is precies het gedrag waar deze app tegen gebouwd is.
  const el = mount(metKleintjes);
  staatVooraan(el, "Nog geen vergelijking met je eigen maanden");
  staatVooraan(el, "Oudere afschriften importeren vult dit aan.");

  // En de weigering van de weekdagweergave, met een venster van twee dagen.
  const kaal = mount(freshTxs);
  tab(kaal, "Weekdagen");
  staatVooraan(kaal, "2 dagen geschiedenis");
  staatVooraan(kaal, "minstens 14 dagen");
  expect(kaal.querySelectorAll("details")).toHaveLength(0);
});

test("gegroeid: de stijger blijft staan, de vergelijkingsperiode vouwt op", () => {
  const el = mount(langeGeschiedenis);
  tab(el, "Gegroeid");

  // De vondst is het antwoord op de vraag waarvoor je de weergave opent.
  const insight = el.querySelector<HTMLElement>(".stat-insight")!;
  expect(insight.closest("details")).toBeNull();
  expect(insight.textContent).toContain("steeg het hardst");

  const label = opvouwbaar(el, "dezelfde lengte als de gekozen periode");
  expect(label).toContain("Welke periode ernaast ligt");
});

test("weekdagen: de piekdagzin blijft staan, de definitie van het gemiddelde vouwt op", () => {
  const el = mount(txs);
  tab(el, "Weekdagen");

  const insight = el.querySelector<HTMLElement>(".stat-insight")!;
  expect(insight.closest("details")).toBeNull();
  expect(insight.textContent).toContain("kost je gemiddeld");

  const label = opvouwbaar(el, "ook de dagen zonder transactie");
  // Het aantal dagen waarover gemeten is, staat in het label: dáár is de
  // hardheid van het gemiddelde aan af te lezen, dus dat blijft in beeld.
  expect(label).toMatch(/Waarop dit gemiddelde rust: \d+ dagen/);
});

test("het bedrag dat buiten de cijfers valt staat vooraan, de reden erachter", () => {
  const el = mount(metVerplaatstGeld, []);
  const moved = el.querySelectorAll<HTMLElement>(".stat-moved");
  // Eén regel voor het hele blok, in elke weergave — dat was al zo en blijft zo.
  expect(moved).toHaveLength(1);
  const summary = moved[0].querySelector("summary")!;
  // € 20.000 mag niet opnieuw stil verdwijnen: dát is waarom deze regel bestaat.
  expect(summary.textContent).toContain("Buiten deze cijfers gehouden");
  expect(summary.textContent).toMatch(/€/);
  opvouwbaar(el, "dezelfde euro op een andere plek");
});

test("geen enkele uitkomst en geen enkel totaal zit achter een klik", () => {
  const el = mount(langeGeschiedenis);
  // De periode waar alles in staat, en de twee bedragen waar hij op afkomt.
  expect(el.querySelector(".stat-window")!.closest("details")).toBeNull();
  expect(el.querySelector(".stat-figures")!.closest("details")).toBeNull();
  for (const v of el.querySelectorAll<HTMLElement>(".module-figure-value")) {
    expect(v.closest("details"), `${v.textContent} is opgevouwen`).toBeNull();
  }
});

test("alles staat standaard dicht — in elke weergave", () => {
  for (const weergave of ["Categorieën", "Verdeling", "Gegroeid", "Weekdagen"]) {
    const el = mount(metKleintjes);
    tab(el, weergave);
    const alles = [...el.querySelectorAll<HTMLDetailsElement>("details")];
    for (const d of alles) {
      expect(d.open, `${weergave}: "${d.querySelector("summary")?.textContent}" staat open`).toBe(false);
    }
    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  }
});

/* De vangrail voor de VOLGENDE zin, niet voor de zinnen die er nu staan. De
 * tests hierboven noemen elk een tekst bij naam; die blijven groen terwijl
 * iemand er een nieuwe alinea naast zet. Deze test kent geen enkele zin: hij
 * neemt elke uitleg-alinea die het blok rendert en eist dat hij ofwel in een
 * paneel zit, ofwel een WEIGERING is. Zo kan het scherm niet stukje bij beetje
 * terugkruipen naar het document dat het was.
 *
 * De weigering is met opzet aan haar EIGEN woorden herkend en niet aan een
 * klasse: `PercentielLijst` zet haar in dezelfde `.cell-sub` als de uitleg, dus
 * een klassecheck zou hier precies de val uit de opdracht doorlaten. */
const WEIGERINGEN = ["Nog geen vergelijking met je eigen maanden"];

test("elke uitleg-alinea zit in een paneel — behalve een weigering, in elke weergave", () => {
  for (const weergave of ["Categorieën", "Verdeling", "Gegroeid", "Weekdagen"]) {
    const el = mount(metKleintjes);
    tab(el, weergave);

    const alineas = [...el.querySelectorAll<HTMLElement>("p.cell-sub, p.stat-insight-basis")];
    for (const p of alineas) {
      const tekst = (p.textContent ?? "").trim();
      if (WEIGERINGEN.some((w) => tekst.startsWith(w))) {
        // De andere kant van de regel, en die is even hard: een weigering hoort
        // júist niet in een paneel. Wegstoppen laat het scherm leeg lijken
        // terwijl er iets te zeggen valt.
        expect(p.closest("details"), `${weergave}: een weigering is opgevouwen — "${tekst.slice(0, 60)}"`).toBeNull();
        continue;
      }
      expect(
        p.closest(".toonmeer-panel"),
        `${weergave}: deze alinea staat los onder de grafiek — "${tekst.slice(0, 60)}…"`,
      ).not.toBeNull();
    }

    act(() => root?.unmount());
    host?.remove();
    root = null;
    host = null;
  }
});

test("weggelatenLabelNL telt, verbuigt, en zwijgt als er niets weg is", () => {
  expect(weggelatenLabelNL({ maanden: 0, klein: 0, gecapt: 0 })).toBeNull();
  expect(weggelatenLabelNL({ maanden: 1, klein: 0, gecapt: 0 })).toBe("Wat hier niet in staat: 1 maand zonder afschrift");
  expect(weggelatenLabelNL({ maanden: 2, klein: 1, gecapt: 0 })).toBe(
    "Wat hier niet in staat: 2 maanden zonder afschrift · 1 kleinere categorie",
  );
  expect(weggelatenLabelNL({ maanden: 0, klein: 3, gecapt: 2 })).toBe(
    "Wat hier niet in staat: 3 kleinere categorieën · 2 categorieën buiten de grafiek",
  );
});

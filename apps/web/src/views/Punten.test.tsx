// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test } from "vitest";
import type { Account, RewardsBalance, Tx } from "@lavega/core";
import { makeRewardsBalance } from "@lavega/core";
import Punten, { ALL_PROGRAMS, programCategory, programFacts, programUnit, worthLine } from "./Punten";
import Rekeningen, { dayNL, groupAccountsByBank, latestTxDates, saldoAge, saldoAgeNote, saldoAgeShort } from "./Rekeningen";

/* Twee gaten die de eigenaar noemde, en de invarianten die ze dichthouden.
 *
 * A. "Bijgewerkt op" in Rekeningen. Een bankkoppeling ververst niet — er is geen
 *    refresh-route en geen interval. Een stand van het koppelmoment las daardoor
 *    als een stand van nu. (mapEbAccount neemt inmiddels wél de reference_date
 *    van Enable Banking over, en App.tsx geeft hem door — maar alleen waar de
 *    bank hem meestuurt, dus de onbekende blijft bestaan.) Wat hier
 *    vastligt: een onbekende dag leest als ONBEKEND en niet als een datum, en de
 *    melding stelt niets voor wat op die pagina niet kan.
 *
 * B. ING Punten. Het programma bestaat, de koers niet: ING beloont drempels. Wat
 *    hier vastligt: geen verzonnen koers, geen euro-waarde van een punt, wél de
 *    echte verdienregels en de geen-geldwaarde-regel met bron en datum.
 *
 * Beide staan in één bestand omdat deze lane alleen views/Punten.tsx,
 * views/Rekeningen.tsx en dit bestand bezit; rekeningen-ui.test.tsx is van een
 * andere lane en blijft ongemoeid. Hoort de A-helft later bij dat bestand, dan
 * kan ze er in één verplaatsing heen.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function mount(el: React.ReactElement): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(el));
  return container;
}

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** Typen zoals React het merkt (de waarde-setter op het prototype). */
function type(el: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const byText = (sel: string, text: string): HTMLElement =>
  [...container!.querySelectorAll<HTMLElement>(sel)].find((n) => (n.textContent ?? "").includes(text))!;

/** Elke zin met een jaartal erin. Waarvoor: bij een saldo zonder dag mág er wél
 *  een datum in de melding staan — die van de nieuwste transactie — maar dan
 *  alleen als een uitspraak over de TRANSACTIES. Zodra zo'n zin over het bedrag
 *  gaat, leest de onbekende dag alsnog als een dag, en dat is precies de fout. */
const datedSentences = (text: string): string[] =>
  text.split(/(?<=\.)\s+/).filter((sentence) => /\d{4}/.test(sentence));

/* ═══════════════════════════════════════════════════════════════════════════
 * A. Rekeningen — wanneer kwamen deze gegevens binnen?
 * ═════════════════════════════════════════════════════════════════════════ */

const acc = (p: Partial<Account> & { key: string }): Account => ({
  iban: "", name: p.key, bank: "", entity: "Prive", currency: "EUR", balance: null, ...p,
});

const tx = (id: string, accountKey: string, date: string): Tx => ({
  id, accountKey, date, amount: -12.5, currency: "EUR", counterparty: "X", description: "", category: "", manual: false,
});

/* ── de pure kant ──────────────────────────────────────────────────────── */

test("een saldo zonder balanceDate is 'datum onbekend' — en dat label bevat geen enkel cijfer", () => {
  // Precies de vorm die mapEbAccount aflevert: een bedrag, geen dag.
  const age = saldoAge(acc({ key: "NL01INGB", balance: 1200.5 }), null);
  expect(age.kind).toBe("undated");
  const short = saldoAgeShort(age);
  expect(short).toBe("datum onbekend");
  // De hele fout die dit dichtzet: iets dat als datum kan worden gelezen. Ook
  // geen jaartal, geen "vandaag", geen streepje op een datumplek.
  expect(short).not.toMatch(/\d/);
  expect(saldoAgeNote(age)).not.toMatch(/\d{4}/);
});

test("bij een onbekende dag hoort elke datum in de melding bij de transacties, niet bij het bedrag", () => {
  // De nieuwste transactie mag erbij: het is het enige harde gegeven dat we
  // hebben. Maar hij mag niet als de dag van het saldo kunnen worden gelezen —
  // bij een koppeling komen saldo en transacties uit dezelfde fetch, maar dat is
  // per rekening niet te bewijzen, dus wordt het niet geclaimd.
  const note = saldoAgeNote(saldoAge(acc({ key: "A", balance: 843.21 }), "2026-08-10"));
  const dated = datedSentences(note);
  expect(dated).toHaveLength(1);
  expect(dated[0]).toContain("De nieuwste transactie");
  expect(dated[0]).toContain("niet over dit bedrag");
});

test("de melding bij een onbekende dag noemt de oorzaak: de koppeling vernieuwt zichzelf niet", () => {
  const note = saldoAgeNote(saldoAge(acc({ key: "A", balance: 10 }), null));
  expect(note).toContain("geen dag");
  expect(note).toContain("vernieuwt zichzelf niet");
  expect(note).toContain("het moment waarop je autoriseerde");
});

test("geen enkele melding stelt een handeling voor die op deze pagina niet bestaat", () => {
  // De knop "Koppel bank (Enable Banking)" zit in het Importeren-blok in Profiel,
  // niet in Rekeningen. "Koppel opnieuw om bij te werken" zou hier dus een advies
  // zijn dat niet uit te voeren is — en er is ook geen verversroute om naar te
  // wijzen: de server heeft aspsps/auth/callback/accounts en niets anders.
  const notes = [
    saldoAgeNote(saldoAge(acc({ key: "A", balance: 10 }), null)),
    saldoAgeNote(saldoAge(acc({ key: "B", balance: 10, balanceDate: "2026-07-31" }), "2026-08-12")),
    saldoAgeNote(saldoAge(acc({ key: "C", balance: null }), null)),
  ];
  for (const note of notes) {
    expect(note).not.toMatch(/koppel (opnieuw|je bank)/i);
    expect(note).not.toMatch(/opnieuw (koppelen|autoriseren)/i);
    expect(note).not.toMatch(/ververs|vernieuw de koppeling|synchroniseer/i);
  }
});

test("een gedateerd saldo zegt van welke dag het is, en meldt latere transacties", () => {
  const age = saldoAge(acc({ key: "A", balance: 1000, balanceDate: "2026-07-31" }), "2026-08-12");
  expect(age).toEqual({ kind: "dated", date: "2026-07-31", laterTx: "2026-08-12" });
  expect(saldoAgeShort(age)).toBe("stand van 31 juli 2026");
  const note = saldoAgeNote(age);
  expect(note).toContain("stand van 31 juli 2026, niet van vandaag");
  expect(note).toContain("nieuwste is van 12 augustus 2026");
});

test("een transactie op de saldodatum zelf is geen latere transactie", () => {
  const age = saldoAge(acc({ key: "A", balance: 1000, balanceDate: "2026-08-12" }), "2026-08-12");
  expect(age).toEqual({ kind: "dated", date: "2026-08-12", laterTx: null });
  expect(saldoAgeNote(age)).not.toContain("ná die dag");
});

test("geen saldo is geen nul en ook geen datum", () => {
  const age = saldoAge(acc({ key: "A", balance: null }), "2026-08-12");
  expect(age).toEqual({ kind: "none", latestTx: "2026-08-12" });
  expect(saldoAgeShort(age)).toBe("geen saldo");
  expect(saldoAgeNote(age)).toContain("geen bedrag, en dus ook geen nul");
});

test("latestTxDates neemt per rekening de nieuwste dag, in één doorloop", () => {
  const m = latestTxDates([
    tx("1", "A", "2026-01-05"),
    tx("2", "A", "2026-08-12"),
    tx("3", "A", "2026-03-01"),
    tx("4", "B", "2026-02-02"),
  ]);
  expect(m.get("A")).toBe("2026-08-12");
  expect(m.get("B")).toBe("2026-02-02");
  expect(m.get("C")).toBeUndefined();
});

test("dayNL geeft een onleesbare waarde ongewijzigd terug in plaats van een verzonnen dag", () => {
  expect(dayNL("2026-07-31")).toBe("31 juli 2026");
  expect(dayNL("")).toBe("");
  expect(dayNL("onbekend")).toBe("onbekend");
});

/* ── op het scherm ─────────────────────────────────────────────────────── */

type RekProps = ComponentProps<typeof Rekeningen>;
const noop = () => {};

/** Twee rekeningen bij één bank: één met een gedateerd afschriftsaldo, één zoals
 *  een bankkoppeling hem oplevert (bedrag, geen dag). */
const LINKED = acc({ key: "NL02INGB", name: "Gekoppelde rekening", bank: "ING", balance: 843.21 });
const IMPORTED = acc({ key: "NL01INGB", name: "Afschrift", bank: "ING", balance: 1200.5, balanceDate: "2026-07-31" });
const REK_TXS: Tx[] = [tx("t1", "NL01INGB", "2026-08-12"), tx("t2", "NL02INGB", "2026-08-10")];

function rekProps(): RekProps {
  return {
    accounts: [IMPORTED, LINKED], txs: REK_TXS, busy: false,
    onEntityChange: noop, onAccountCommit: noop, onAccountFieldChange: noop,
    onSaldoCommit: noop, onTypeCommit: noop, onSelectAccount: noop, onDeleteAccount: noop,
    duplicateGroups: [], onMergeDuplicates: noop,
  };
}

test("het paneel van een gekoppelde rekening zegt 'datum onbekend' en vult geen dag in", () => {
  mount(<Rekeningen {...rekProps()} />);
  click(byText(".bank-group-head", "ING"));
  click(byText('[role="tab"]', "Gekoppelde rekening"));
  const panel = container!.querySelector(".bank-panel")!;
  expect(panel.textContent).toContain("datum onbekend");
  // Er staat geen dag bij het bedrag. De enige datum in het blok is die van de
  // nieuwste transactie, en die zin gaat ook over de transacties.
  const age = panel.querySelector(".bank-panel-age")!;
  expect(panel.querySelector(".bank-field .cell-sub")!.textContent).not.toMatch(/\d/);
  const dated = datedSentences(age.textContent ?? "");
  expect(dated).toHaveLength(1);
  expect(dated[0]).toContain("nieuwste transactie");
  expect(dated[0]).toContain("niet over dit bedrag");
  expect(age.textContent).toContain("vernieuwt zichzelf niet");
});

test("het advies in de melding wijst naar een veld dat op dezelfde pagina staat", () => {
  mount(<Rekeningen {...rekProps()} />);
  click(byText(".bank-group-head", "ING"));
  click(byText('[role="tab"]', "Gekoppelde rekening"));
  const panel = container!.querySelector<HTMLElement>(".bank-panel")!;
  expect(panel.querySelector(".bank-panel-age")!.textContent).toContain("in het veld hierboven");
  // En dat veld bestaat hier echt — dit is het hele punt van regel 3.
  expect(panel.querySelector('[aria-label="Saldo Gekoppelde rekening"]')).toBeTruthy();
  // Er staat geen knop op deze pagina die een koppeling verrast, dus er wordt
  // ook niet naar één verwezen.
  const buttons = [...panel.querySelectorAll("button")].map((b) => b.textContent ?? "");
  expect(buttons.some((t) => /koppel/i.test(t))).toBe(false);
});

test("een geïmporteerd saldo zegt van welke dag het is, en dat er nieuwere transacties zijn", () => {
  mount(<Rekeningen {...rekProps()} />);
  click(byText(".bank-group-head", "ING"));
  const panel = container!.querySelector(".bank-panel")!; // eerste tab = Afschrift
  expect(panel.textContent).toContain("stand van 31 juli 2026");
  expect(panel.querySelector(".bank-panel-age")!.textContent).toContain("nieuwste is van 12 augustus 2026");
});

test("de platte tabel zegt per rij hetzelfde, en vult ook daar geen dag in", () => {
  mount(<Rekeningen {...rekProps()} />);
  click(byText(".bank-modes .pill", "Alle rekeningen"));
  const cells = [...container!.querySelectorAll<HTMLElement>('td[data-label="Saldo"]')];
  const texts = cells.map((c) => c.querySelector(".cell-sub")!.textContent);
  expect(texts).toContain("stand van 31 juli 2026");
  expect(texts).toContain("datum onbekend");
});

test("de dichtgeklapte bankkop zegt 'dag onbekend' zodra een opgeteld saldo geen dag heeft", () => {
  // Dichtgeklapt is de stand waarin hij de pagina opent: daar staat een
  // euro-totaal en niets anders, en dat leest als "nu".
  mount(<Rekeningen {...rekProps()} />);
  const head = byText(".bank-group-head", "ING");
  expect(head.textContent).toContain("dag onbekend");
  // Het totaal blijft staan — het is wél de som van wat we hebben (843,21 +
  // 1.200,50), alleen niet de som van één dag.
  expect(head.textContent).toContain("2.043,71");
});

test("een bank waarvan elk saldo een dag heeft krijgt die melding niet", () => {
  mount(<Rekeningen {...rekProps()} accounts={[IMPORTED]} />);
  const head = byText(".bank-group-head", "ING");
  expect(head.textContent).not.toContain("dag onbekend");
});

test("undatedCount telt alleen de saldi die worden opgeteld", () => {
  const groups = groupAccountsByBank([
    { account: IMPORTED, txCount: 0 },
    { account: LINKED, txCount: 0 },
    // Geen saldo: telt niet mee in het totaal, dus ook niet als ongedateerd —
    // anders zou "dag onbekend" over een bedrag gaan dat er niet is.
    { account: acc({ key: "C", name: "Leeg", bank: "ING" }), txCount: 0 },
  ]);
  expect(groups[0].knownCount).toBe(2);
  expect(groups[0].undatedCount).toBe(1);
  expect(groups[0].unknownCount).toBe(1);
});

test("de melding haalt niets op: geen afbeelding, geen link, geen remote adres", () => {
  const html = renderToStaticMarkup(<Rekeningen {...rekProps()} />);
  expect(html).not.toContain("<img");
  expect(html).not.toContain("https://");
  expect(html).not.toContain("url(");
});

/* ═══════════════════════════════════════════════════════════════════════════
 * B. Punten — ING in het platform, zonder verzonnen koers
 * ═════════════════════════════════════════════════════════════════════════ */

const ING = "ING Punten";
const ASOF = "2026-08-21";

const ingBalance = (points: number, updatedAt = "2026-08-01"): RewardsBalance =>
  makeRewardsBalance({ program: ING, points, updatedAt });

function puntenProps(balances: RewardsBalance[]): ComponentProps<typeof Punten> {
  return { balances, asOf: ASOF, busy: false, onSave: noop };
}

/* ── de pure kant ──────────────────────────────────────────────────────── */

test("ING Punten staat in de keuzelijst, als bankprogramma en in punten", () => {
  expect(ALL_PROGRAMS.some((p) => p.name === ING)).toBe(true);
  expect(programCategory(ING)).toBe("Bank");
  // Nooit "eur": een euroteken bij dit programma zou de fout zijn die de bron
  // juist uitsluit.
  expect(programUnit(ING)).toBe("points");
  // De bestaande programma's blijven staan zoals ze waren.
  expect(programUnit("bunq")).toBe("eur");
  expect(programUnit("Marriott Bonvoy")).toBe("points");
});

test("de verdienregels zijn drempels, en er is nergens een koers per euro", () => {
  const facts = programFacts(ING)!;
  expect(facts.earn.map((r) => `${r.what}: ${r.reward}`)).toEqual([
    "Elke maand minimaal € 700 bijschrijven op je Betaalrekening: 250 punten per maand",
    "10 transacties met je Betaalrekening: 100 punten per maand",
    "Meer dan € 100 uitgeven met je ING Creditcard Extra of Max: 250 punten per maand",
    "Meer dan € 100 uitgeven met je ING (studenten) Creditcard More: 100 punten per maand",
    "Rond af & Spaar actief gebruiken: 100 punten per maand",
    "Een hypotheek hebben: 250 punten per maand",
    "Je eerste Betaalrekening openen: 2.500 punten, eenmalig",
    "Je eerste Oranje Spaarrekening openen: 500 punten, eenmalig",
    "Je creditcard aan je wallet toevoegen: 100 punten, eenmalig",
  ]);
  // 250 / 100 = 2,5 punt per euro is precies het getal dat NIET bestaat.
  const all = JSON.stringify(facts);
  expect(all).not.toMatch(/per euro/);
  expect(all).not.toMatch(/2,5 punt|2\.5 punt/);
  expect(facts.noRate).toContain("drempel, geen tarief");
});

test("de geldkant is een uitgesproken nul, met bron en datum — niet 'onbekend'", () => {
  const facts = programFacts(ING)!;
  expect(facts.cash.kind).toBe("stated-none");
  expect(facts.cash.quote).toContain("hebben geen geldwaarde");
  expect(facts.cash.source).toBe("Voorwaarden ING Punten");
  expect(facts.cash.validFrom).toBe("1 oktober 2025");
});

test("wat niet is vastgesteld staat er als onbekend, uitdrukkelijk niet als nul", () => {
  const facts = programFacts(ING)!;
  const winkel = facts.unknowns.find((u) => u.includes("ING Winkel"))!;
  expect(winkel).toContain("onbekend — niet nul");
  const platinum = facts.unknowns.find((u) => u.includes("Platinumcard"))!;
  expect(platinum).toContain("niet vastgesteld");
  expect(platinum).toContain("ook geen nul");
});

test("een programma dat we niet kennen krijgt geen verzonnen regels", () => {
  expect(programFacts("Spaarzegels van de bakker")).toBeNull();
  // De losse core-regel "ING" kan een cashbackactie zijn; daar de puntenregels
  // bij zetten zou een claim zijn over het verkeerde ding.
  expect(programFacts("ING")).toBeNull();
  expect(worthLine("Marriott Bonvoy", "points")).toBe(
    "Waarde: niet vast te stellen zonder te weten waarvoor je ze inwisselt.",
  );
});

test("de waarderegel van ING noemt de reden waarom er geen bedrag staat", () => {
  const line = worthLine(ING, "points");
  expect(line).toContain("In geld: niets");
  expect(line).toContain("Voorwaarden ING Punten");
  expect(line).toContain("1 oktober 2025");
  expect(line).toContain("hebben geen geldwaarde");
  expect(line).toContain("niet gepubliceerd: dat is onbekend en niet nul");
  expect(line).not.toContain("€");
});

/* ── op het scherm ─────────────────────────────────────────────────────── */

test("op de ING-kaart staat geen euro-waarde, wel de reden waarom niet", () => {
  mount(<Punten {...puntenProps([ingBalance(12_500)])} />);
  const card = container!.querySelector<HTMLElement>(".punt-card")!;
  expect(card.querySelector(".punt-value")!.textContent).toBe("12.500");
  expect(card.querySelector(".punt-unit")!.textContent).toBe("punten");

  // Alles buiten het regelblok is LaVega's eigen tekst over dit saldo. Daar mag
  // geen euroteken staan: er is geen euro-waarde van een ING-punt.
  const rules = card.querySelector<HTMLElement>(".punt-facts")!;
  const own = card.cloneNode(true) as HTMLElement;
  own.querySelector(".punt-facts")!.remove();
  expect(own.textContent).not.toContain("€");

  // En binnen het regelblok is elk euroteken een DREMPEL van ING, nooit een
  // waarde per punt.
  expect(rules.textContent).toContain("minimaal € 700 bijschrijven");
  expect(rules.textContent).toContain("Meer dan € 100 uitgeven");
  expect(rules.textContent).not.toMatch(/per punt|punt is €|waarde per punt|€ ?0,0/);

  // De reden staat er, in ING's eigen woorden, met bron en datum.
  expect(card.textContent).toContain("In geld: niets");
  expect(card.textContent).toContain("hebben geen geldwaarde");
  expect(card.textContent).toContain("Voorwaarden ING Punten, geldig vanaf 1 oktober 2025");
  expect(card.textContent).toContain("onbekend — niet nul");
});

test("de kaart toont de negen verdienregels en de pakketopslag", () => {
  mount(<Punten {...puntenProps([ingBalance(12_500)])} />);
  const items = [...container!.querySelectorAll(".punt-facts-earn li")].map((li) => li.textContent);
  expect(items).toHaveLength(9);
  expect(items[0]).toContain("250 punten per maand");
  const rules = container!.querySelector(".punt-facts")!;
  expect(rules.textContent).toContain("ING Extra: 20% meer punten");
  expect(rules.textContent).toContain("kunnen wijzigen");
  expect(rules.textContent).toContain("opgehaald op 21 augustus 2026");
});

test("het regelblok haalt niets op: geen link, geen afbeelding, geen remote adres", () => {
  const html = renderToStaticMarkup(<Punten {...puntenProps([ingBalance(1000)])} />);
  expect(html).not.toContain("<a ");
  expect(html).not.toContain("<img");
  expect(html).not.toContain("https://");
  expect(html).not.toContain("http://");
});

test("de regels staan er al vóórdat hij opslaat, zodra het formulier op ING Punten staat", () => {
  mount(<Punten {...puntenProps([])} />);
  expect(container!.querySelector(".punt-facts")).toBeNull();
  const field = container!.querySelector<HTMLInputElement>('.punt-form [aria-label="Programma"]')!;
  type(field, ING);
  const rules = container!.querySelector(".punt-facts")!;
  expect(rules.textContent).toContain("drempel, geen tarief");
  expect(container!.querySelector('[aria-label="Punten"]')).toBeTruthy(); // punten, geen euro's
});

test("wie 'ING' kiest wordt naar ING Punten gewezen — een optie die in dezelfde lijst staat", () => {
  mount(<Punten {...puntenProps([])} />);
  const field = container!.querySelector<HTMLInputElement>('.punt-form [aria-label="Programma"]')!;
  type(field, "ING");
  const note = byText(".punt-form .field-note", "Spaar je ING Punten?");
  expect(note).toBeTruthy();
  const options = [...container!.querySelectorAll("#reward-programs option")].map((o) => o.getAttribute("value"));
  expect(options).toContain(ING);
});

test("een ander programma blijft precies zoals het was", () => {
  mount(<Punten {...puntenProps([makeRewardsBalance({ program: "Marriott Bonvoy", points: 60_000, updatedAt: "2026-08-01" })])} />);
  const card = container!.querySelector<HTMLElement>(".punt-card")!;
  expect(card.querySelector(".punt-facts")).toBeNull();
  expect(card.querySelector(".punt-worth")!.textContent).toContain("niet vast te stellen");
  expect(card.textContent).not.toContain("€");
});

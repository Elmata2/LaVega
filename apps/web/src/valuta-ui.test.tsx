// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { Account, CatalogueEntryLike, LearnedFact } from "@lavega/core";
import { FX_RATE_FALLBACK, TRAVEL_AGENT, makeFact, productOf } from "@lavega/core";
import Valuta from "./views/Valuta";
import { TOONMEER_CLASS } from "./components/ToonMeer";

/* Valuta as the 20 August review asked for it.
 *
 * Two things are under test, and they are the two complaints:
 *   - ONE ROW PER BANK. "Just show one ING." The catalogue holds three ING cards;
 *     the screen shows ING once, and says which product the figure belongs to.
 *   - EVERY BANK, best first, with the difference in euros — but the amount that
 *     ARRIVES is priced on a route he can actually use. A bank he does not hold
 *     is listed and marked, never silently chosen.
 *
 * And the rule that survives from the first build: an unknown cost is not zero.
 * With no establishable figure, "wat er aankomt" stays "onbekend" and the
 * mid-market amount is labelled as market value. */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

const ACCOUNTS: Account[] = [
  {
    key: "NL01ING",
    iban: "NL01ING",
    name: "Betaalrekening",
    bank: "ING",
    entity: "Prive",
    currency: "EUR",
    balance: 5000,
  },
  {
    key: "REV1",
    iban: "",
    name: "Revolut",
    bank: "Revolut",
    entity: "Prive",
    currency: "EUR",
    balance: 1200,
  },
];

/** A covered catalogue figure: value, source, date AND conditions. */
function card(id: string, product: string, issuer: string, pct: number): CatalogueEntryLike {
  return {
    id,
    product,
    issuer,
    kind: "betaalpas",
    fields: {
      fxFeePct: {
        value: pct,
        route: "provider-pdf" as never,
        sourceUrl: `https://example.test/${id}`,
        checkedAt: "2026-06-15",
        conditions: "koersopslag bij betalen in vreemde valuta",
        conditionsKnown: true,
      },
    },
  };
}

/** Three ING cards, a Revolut card, and the cheapest thing on the market that he
 *  does not hold — the shape of the real catalogue in miniature. */
const ENTRIES: CatalogueEntryLike[] = [
  card("ing-betaalpas", "ING betaalpas", "ING Bank N.V.", 1.4),
  card("ing-creditcard", "ING creditcard", "International Card Services (ICS)", 2),
  card("ing-platinum", "ING Platinumcard", "International Card Services (ICS)", 0),
  card("revolut", "Revolut Standard betaalpas", "Revolut Bank UAB", 1),
  card("t212", "212 Card", "Paynetics; Trading 212", 0),
];

/** Card terms as the travel agent stores them, keyed on the PRODUCT. */
function terms(pct: Record<string, number>, source: "agent" | "user" = "agent"): LearnedFact[] {
  return Object.entries(pct).map(([subject, value]) =>
    makeFact({
      agent: TRAVEL_AGENT,
      subject,
      key: "fxFeePct",
      value: String(value),
      source,
      updatedAt: "2026-08-16",
    }),
  );
}

const money = (n: number, ccy: string) =>
  new Intl.NumberFormat("nl-NL", {
    style: "currency",
    currency: ccy,
    maximumFractionDigits: 2,
  }).format(n);
const usd = (n: number) => money(n, "USD");
const eur = (n: number) => money(n, "EUR");

beforeEach(() => {
  // The view fetches a live rate on mount; keep the test on the offline
  // snapshot so the arithmetic below is deterministic.
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async () => ({
    ok: false,
    status: 503,
    json: async () => null,
  })) as unknown as typeof fetch;
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function render(
  opts: { facts?: LearnedFact[]; entries?: CatalogueEntryLike[]; accounts?: Account[] } = {},
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <Valuta
        accounts={opts.accounts ?? ACCOUNTS}
        facts={opts.facts ?? []}
        entries={opts.entries ?? ENTRIES}
      />,
    );
  });
  return container;
}

function click(el: Element) {
  act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function arrives(): string {
  return (container!.querySelector('[data-testid="arrives"]') as HTMLElement).textContent ?? "";
}

/** The bank rows, in the order the screen ranks them. */
function rows(): HTMLElement[] {
  return [...container!.querySelectorAll(".travel-journeys .travel-journey")] as HTMLElement[];
}
function rowNamed(bank: string): HTMLElement {
  const hit = rows().filter((r) =>
    (r.querySelector(".travel-journey-name")?.textContent ?? "").trim().startsWith(bank),
  );
  expect(hit).toHaveLength(1); // a bank appears ONCE — that is the point
  return hit[0];
}

test("the transfer block renders both legs, an amount and two currency pills", () => {
  const c = render();
  expect(c.querySelector('[aria-label="Van rekening"]')).not.toBeNull();
  expect(c.querySelector('[aria-label="Naar rekening"]')).not.toBeNull();
  expect((c.querySelector('[aria-label="Bedrag"]') as HTMLInputElement).value).toBe("1000");
  expect(c.querySelector('[aria-label="Van valuta"]')).not.toBeNull();
  expect(c.querySelector('[aria-label="Naar valuta"]')).not.toBeNull();
  expect(c.querySelector('[aria-label="Wissel van en naar"]')).not.toBeNull();
});

test("ING appears ONCE, though the catalogue holds three ING cards", () => {
  render();
  const ing = rowNamed("ING");
  // And the row says which product the figure belongs to, because "ING 0%" is
  // only true of the Platinumcard.
  expect(ing.textContent).toContain("ING betaalpas");
  expect(ing.textContent).toContain("ING Platinumcard");
});

test("the whole market is ranked, cheapest first, and a bank he does not hold is marked", () => {
  render();
  const order = rows().map(
    (r) => (r.querySelector(".travel-journey-name")?.textContent ?? "").trim().split(" ")[0],
  );
  expect(order[0]).toBe("Trading"); // 212 Card at 0%
  expect(rowNamed("Trading 212").textContent).toContain("niet van jou");
  expect(rowNamed("ING").textContent).toContain("van jou");
  expect(rowNamed("Revolut").textContent).toContain("van jou");
});

test("the amount that arrives is priced on a route he can use AND a figure that is his", () => {
  const c = render();
  const mid = 1000 * FX_RATE_FALLBACK.rates.USD;
  // Trading 212 is cheaper at 0% but he does not hold it. Revolut is cheaper
  // than ING at 1% — except that 1% is Revolut STANDARD's, and which Revolut
  // plan he is on is not something LaVega knows. The ING betaalpas figure is
  // his own product, so 1,4% is the number that may drive the amount.
  expect(arrives()).toBe(usd(mid * (1 - 0.014)));
  expect(c.querySelector('[data-testid="uitleg"]')!.textContent).toContain("Via ING");
  expect(c.querySelector('[data-testid="gekozen-route"]')!.textContent).toContain("ING betaalpas");
  expect(rowNamed("Revolut").textContent).toContain(
    "of jouw pakket bij deze bank hetzelfde rekent, weet LaVega niet",
  );
});

test("a cheaper bank he does not hold is named with the difference in euros, and not chosen", () => {
  const c = render();
  const note = c.querySelector('[data-testid="goedkoper"]')!;
  expect(note.textContent).toContain("Trading 212");
  // 1,4% of €1.000 versus 0%: €14.
  expect(note.textContent).toContain(eur(14));
  expect(note.textContent).toContain("Die bank heb je niet");
});

test("he can overrule the default, and the arriving amount follows his choice", () => {
  const c = render();
  const mid = 1000 * FX_RATE_FALLBACK.rates.USD;
  click(rowNamed("Trading 212"));
  expect(arrives()).toBe(usd(mid));
  expect(c.querySelector('[data-testid="uitleg"]')!.textContent).toContain("Via Trading 212");
  expect(c.querySelector('[data-testid="gekozen-route"]')!.textContent).toContain(
    "deze bank heb je nog niet",
  );
  // The alternatives are now priced against Trading 212: ING costs €14 more.
  expect(rowNamed("ING").textContent).toContain(`${eur(14)} meer`);
});

test("what he entered himself beats the catalogue for his own card", () => {
  const c = render({ facts: terms({ [productOf(ACCOUNTS[0])]: 0.4 }, "user") });
  const mid = 1000 * FX_RATE_FALLBACK.rates.USD;
  expect(arrives()).toBe(usd(mid * (1 - 0.004)));
  expect(c.querySelector('[data-testid="uitleg"]')!.textContent).toContain("Via ING");
});

test("with no establishable figure for his own banks, what arrives is 'onbekend' — and it says why", () => {
  const c = render({ entries: [] });
  const mid = 1000 * FX_RATE_FALLBACK.rates.USD;

  expect(arrives()).toBe("onbekend");
  expect(c.textContent).toContain("Wat er aankomt is onbekend");
  // The real cause, named: his banks are known, their tariffs are not.
  expect(c.textContent).toContain("kent LaVega de koersopslag niet");
  expect(c.textContent).toContain("een onbekend tarief is geen 0%");
  // The market value is still shown, but only as market value.
  expect(c.textContent).toContain(usd(mid));
  expect(arrives()).not.toContain(usd(mid));
});

test("an account without a bank cannot be looked up, and the screen says that instead", () => {
  const c = render({
    accounts: [
      {
        key: "A 286",
        iban: "",
        name: "A 286-41213",
        bank: "",
        entity: "Prive",
        currency: "EUR",
        balance: 900,
      },
    ],
    entries: [],
  });
  expect(arrives()).toBe("onbekend");
  expect(c.textContent).toContain("vul de bank in bij Rekeningen");
});

test("a bank he holds is never dropped and never shown as 0%", () => {
  const c = render({
    accounts: [
      ...ACCOUNTS,
      {
        key: "AMEX1",
        iban: "",
        name: "Amex",
        bank: "American Express",
        type: "Creditcard",
        entity: "Prive",
        currency: "EUR",
        balance: -200,
      } as Account,
    ],
  });
  const amex = rowNamed("American Express");
  // The price cell says the cost is missing. It never prints a percentage there,
  // because a bank with no figure is not a cheap bank.
  expect(amex.querySelector(".travel-journey-cost")!.textContent).toBe("kosten onbekend");
  // Unknown sorts last, never above a bank whose figure we have.
  expect(rows().indexOf(amex)).toBe(rows().length - 1);
  expect(c.textContent).toContain("Voorwaarden van deze bank nog onbekend");
});

test("a cheapest row that is not a bank account says what it is", () => {
  const c = render({
    entries: [
      {
        ...card("cdc", "Crypto.com Prepaid Card — Private (Obsidian)", "Crypto.com", 0),
        kind: "prepaid",
      },
      card("ing-betaalpas", "ING betaalpas", "ING Bank N.V.", 1.4),
    ],
  });
  const first = rows()[0];
  expect(first.textContent).toContain("Crypto.com");
  // Ranked on the same evidence as the rest, and labelled — a 0% prepaid card is
  // not a bank account, and the ranking may not imply that it is.
  expect(first.textContent).toContain("prepaidkaart");
  expect(c.querySelector('[data-testid="goedkoper"]')!.textContent).toContain("Crypto.com");
});

/* ════════════════ DE INDELING VAN 21 AUGUSTUS ════════════════
 *
 * Zijn woorden: rekenmachine links, bol rechts, de informatie die rechts stond
 * naar onder de rekenmachine achter "toon meer". Wat hieronder vastligt is de
 * PLAATS van die dingen; de betekenis ervan wordt bewaakt door de tests erboven
 * en eronder, en die zijn niet aangeraakt.
 *
 * Waarom er op `open` getest wordt en niet op afwezige tekst: bij <details>
 * blijven de kinderen in de DOM als hij dicht is (zie ToonMeer.tsx). Een
 * `not.toContain("…")` zou hier falen terwijl het scherm precies goed staat. */

/** De <details> van een van de twee uitklappers. De klasse is er als
 *  aanknopingspunt: het opschrift van de bankenlijst bevat het aantal banken en
 *  is dus geen stabiele sleutel. */
function toonmeer(klasse: string): HTMLDetailsElement {
  const el = container!.querySelector<HTMLDetailsElement>(
    `details.${TOONMEER_CLASS.root}.${klasse}`,
  );
  if (!el) throw new Error(`geen toon meer met klasse ${klasse}`);
  return el;
}
const opschrift = (d: HTMLDetailsElement) =>
  d.querySelector(`.${TOONMEER_CLASS.label}`)?.textContent ?? "";
const paneel = (d: HTMLDetailsElement) =>
  d.querySelector(`.${TOONMEER_CLASS.panel}`)?.textContent ?? "";

test("twee kolommen: de rekenmachine links, de bol rechts", () => {
  const c = render();
  const modules = [...c.querySelectorAll<HTMLElement>(".module-grid > .module")];
  expect(modules.map((m) => m.getAttribute("aria-label"))).toEqual(["Overzetten", "Bestemming"]);
  // Allebei één kolom breed in een raster van twee: de bol stond over de volle
  // breedte onder de kolommen (span 2) en is nu zelf de rechterkolom.
  expect(modules.every((m) => m.classList.contains("module-span-1"))).toBe(true);
  expect(c.querySelector(".module-grid")!.className).toContain("grid-2");
  expect(modules[1].querySelector(".lv-globe")).not.toBeNull();
  // En de bol staat in geen enkel opzicht in de linkerkolom.
  expect(modules[0].querySelector(".lv-globe")).toBeNull();
});

test("de bankenlijst staat onder de rekenmachine, achter een dichte 'toon meer'", () => {
  const c = render();
  const calc = c.querySelector<HTMLElement>('.module[aria-label="Overzetten"]')!;
  const banken = toonmeer("valuta-banken");

  // In de módule van de rekenmachine, niet in een eigen module ernaast.
  expect(calc.contains(banken)).toBe(true);
  expect(banken.open).toBe(false);
  // Dicht is niet weg: de rijen staan er, ze zijn alleen niet in beeld.
  expect(banken.querySelectorAll(".travel-journeys .travel-journey").length).toBe(rows().length);
  // Het opschrift is een belofte mét het aantal, zodat je weet of openklikken
  // de moeite is. "Toon meer" alleen is geen belofte.
  expect(opschrift(banken)).toBe(`Alle ${rows().length} banken, goedkoopste eerst`);

  // En hij gaat open op een klik op de samenvattingsregel.
  click(banken.querySelector(`.${TOONMEER_CLASS.summary}`)!);
  expect(banken.open).toBe(true);
});

test("wat er vóór de plooi blijft staan is het antwoord, niet de onderbouwing", () => {
  const c = render();
  const banken = toonmeer("valuta-banken");
  const bronnen = toonmeer("valuta-bronnen");
  // Het bedrag dat aankomt, de gekozen route en de aanbeveling staan buiten de
  // uitklappers: dat is waarvoor je op dit scherm komt.
  for (const id of ["arrives", "uitleg", "gekozen-route", "goedkoper"]) {
    const el = c.querySelector(`[data-testid="${id}"]`)!;
    expect(el).not.toBeNull();
    expect(banken.contains(el)).toBe(false);
    expect(bronnen.contains(el)).toBe(false);
  }
});

test("de uitleg bij de rangschikking zit achter dezelfde 'toon meer' als de lijst", () => {
  const c = render();
  const tekst = paneel(toonmeer("valuta-banken"));
  expect(tekst).toContain("alle banken die LaVega kan onderbouwen");
  expect(tekst).toContain("Eén regel per bank");
  expect(tekst).toContain('"ING 0%" geldt alleen voor de Platinumcard');
  expect(tekst).toContain("Elke bank die minder rekent");
  // Waartegen het verschil per rij gemeten is stond in de voettekst van de module
  // die hier stond. Die module is weg; de zin niet.
  expect(tekst).toContain("gerekend tegen ING");
  // Het losse ⓘ-knopje en zijn paneel bestaan niet meer — één manier om iets uit
  // te klappen op dit scherm, niet twee.
  expect(c.querySelector(".module-info")).toBeNull();
  expect(c.querySelector(".info-panel")).toBeNull();
});

test("met niets bekend weigert die uitleg te zeggen of overstappen loont", () => {
  render({ entries: [] });
  const tekst = paneel(toonmeer("valuta-banken"));
  expect(tekst).toContain("Een onbekend tarief is geen 0%");
  expect(tekst).not.toContain("Elke bank die minder rekent");
});

test("zonder ook maar één bank belooft het opschrift geen lijst", () => {
  render({ accounts: [], entries: [] });
  const banken = toonmeer("valuta-banken");
  expect(opschrift(banken)).toBe("Waarom er nog geen bank te rangschikken is");
  expect(paneel(banken)).toContain("Nog geen bank om te rangschikken");
});

test("de bronregel staat achter 'toon meer' en is compleet gebleven", () => {
  render();
  const bronnen = toonmeer("valuta-bronnen");
  expect(bronnen.open).toBe(false);
  expect(opschrift(bronnen)).toBe("Waar de koers en de tarieven vandaan komen");
  const tekst = paneel(bronnen);
  expect(tekst).toContain("middenkoers");
  expect(tekst).toContain("tarievenoverzicht");
  expect(tekst).toContain("Er wordt niets over je rekeningen verstuurd");
});

/* De koersaanroep mislukt in deze hele test (zie beforeEach), dus alles hieronder
 * gaat over de stand waarin de tab met de MEEGEBUNDELDE koers rekent. Dat is de
 * stand waarin de twee zinnen over de koers het makkelijkst gaan liegen. */

test("zonder live koers zegt de bronregel wat het dan wél is, zonder een oorzaak te verzinnen", () => {
  render();
  const tekst = paneel(toonmeer("valuta-bronnen"));
  // Waarvan het een momentopname is stond er niet in: "offline momentopname van
  // 2026-08-04" laat de lezer raden of dat een ECB-koers is of iets van de bank.
  expect(tekst).toContain("meegebundelde ECB-middenkoers");
  expect(tekst).toContain(FX_RATE_FALLBACK.date);
  // En er wordt GEEN oorzaak genoemd. Deze stand is ook de stand vlak na het
  // openen, terwijl de aanroep nog loopt; "was niet op te halen" zou dan een
  // bewering zijn die de toestand niet kan dragen.
  expect(tekst).not.toContain("niet op te halen");
  expect(tekst).not.toContain("mislukt");
  // Het woord "live" mag hier alleen staan als de koers het ook is.
  expect(tekst).not.toContain("live ECB-middenkoers");
});

test("de kop belooft geen live koers als die er niet is", () => {
  const c = render();
  const eyebrow = c.querySelector(".view-head .eyebrow")!.textContent ?? "";
  expect(eyebrow).toContain(`ECB-middenkoers van ${FX_RATE_FALLBACK.date} uit de app`);
  expect(eyebrow).not.toContain("live");
  // De rest van de regel blijft staan: waar de koersopslag vandaan komt verandert
  // niet met het al dan niet ophalen van de koers.
  expect(eyebrow).toContain("koersopslag per bank uit de catalogus");
});

test("er staat geen voettekst onder de bol die een richting aanwijst", () => {
  /* De voetregel is er op zijn verzoek helemaal uit (22 augustus). Deze test blijft
   * staan met de eis die hem hoe dan ook moest binden: als er ooit weer iets onder
   * de bol komt, mag daar geen "hierboven" of "hiernaast" in staan. De bol staat op
   * een breed scherm naast de rekenmachine en op een smal scherm eronder, dus elke
   * richtingsaanwijzing is de helft van de tijd onwaar. */
  const c = render();
  const bol = [...c.querySelectorAll<HTMLElement>(".module")].find(
    (m) => m.getAttribute("aria-label") === "Bestemming",
  )!;
  const foot = bol.querySelector(".module-foot")?.textContent ?? "";
  expect(foot).not.toContain("hierboven");
  expect(foot).not.toContain("hiernaast");
});

/* ════════════════ DE HORIZONREGEL OP HET SCHERM (21 augustus) ════════════════
 *
 * Valuta was de vierde plek met een aanbeveling en de laatste die de kosten van de
 * rekening negeerde. Zijn zin: een bank die drie euro goedkoper is maar vijf euro
 * per maand kost, is voor één conversie duurder.
 *
 * De drie gevallen hieronder zijn de drie toestanden uit het type, en ze worden
 * met dezelfde woorden verteld als op Overzicht — de component `Kaartkosten` komt
 * daar letterlijk vandaan. Twee schermen die hetzelfde zeggen in andere woorden is
 * een fout op zichzelf. */

/** Dezelfde kaart, plus de maand- of jaarprijs die zijn eigen document noemt. */
function pricedCard(
  id: string,
  product: string,
  issuer: string,
  pct: number,
  fee: { value: number; period: "maand" | "jaar" },
): CatalogueEntryLike {
  const base = card(id, product, issuer, pct);
  return {
    ...base,
    fields: {
      ...base.fields,
      // `period` hoort bij een bedrag en niet bij een percentage, dus het staat
      // niet in het gedeelde veldtype; accountCosts.ts leest het los uit de JSON.
      accountFee: {
        value: fee.value,
        period: fee.period,
        route: "provider-pdf",
        sourceUrl: `https://example.test/${id}-tarieven`,
        checkedAt: "2026-08-01",
        conditions: "vaste bijdrage per periode",
        conditionsKnown: true,
      } as never,
    },
  };
}

/** Zijn eigen ING-pas op 1,4%, en de goedkoopste kaart van de markt: N26 Metal met
 *  0% opslag en € 16,90 per maand. Op € 1.000 scheelt de opslag € 14 en kost de
 *  kaart € 16,90 — dus overstappen is € 2,90 achteruit. */
const PRICED: CatalogueEntryLike[] = [
  card("ing-betaalpas", "ING betaalpas", "ING Bank N.V.", 1.4),
  pricedCard("n26-metal", "N26 Metal betaalpas", "N26 Bank AG", 0, {
    value: 16.9,
    period: "maand",
  }),
];
const ONLY_ING: Account[] = [ACCOUNTS[0]];

/** Het bedrag in het invoerveld wijzigen zoals hij dat doet. Via de native setter,
 *  anders ziet React de wijziging van een gecontroleerd veld niet. */
function typeAmount(value: string) {
  const input = container!.querySelector('[aria-label="Bedrag"]') as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function text(testId: string): string {
  return (
    (container!.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null)?.textContent ?? ""
  );
}

test("een goedkopere bank die door zijn maandprijs duurder wordt, staat niet bovenaan", () => {
  const c = render({ accounts: ONLY_ING, entries: PRICED });

  // 0% opslag, en tóch tweede: € 16,90 per maand is meer dan de € 14 die de
  // lagere opslag oplevert. Op het percentage alleen stond deze kaart bovenaan.
  const order = rows().map(
    (r) => (r.querySelector(".travel-journey-name")?.textContent ?? "").trim().split(" ")[0],
  );
  expect(order).toEqual(["ING", "N26"]);
  // En de rij zegt zelf waarom ze daar staat, in plaats van de lezer te laten
  // raden waarom 0% onder 1,4% hangt.
  expect(rowNamed("N26").textContent).toContain(`Kaartkosten: ${eur(16.9)} per maand`);
  expect(rowNamed("N26").textContent).toContain(`${eur(2.9)} meer in totaal`);

  // De aanbeveling: bruto blijft bruto, en netto is hier geen aanbeveling. De KOP
  // zegt dat ook — "Goedkoper kan" boven een regel die op achteruitgang eindigt is
  // een kop die zijn eigen alinea tegenspreekt.
  expect(text("goedkoper")).toContain("Lagere opslag, maar niet goedkoper");
  expect(text("goedkoper")).not.toContain("Goedkoper kan");
  expect(text("goedkoper")).toContain(`${eur(14)} minder aan koersopslag`);
  const kosten = text("valuta-goedkoper-kosten") + text("valuta-goedkoper-kosten-geen");
  expect(kosten).toContain("Geen aanbeveling");
  expect(kosten).toContain(`je gaat er ${eur(2.9)} op achteruit`);
  // DE PERIODE STAAT OP HET SCHERM, met de reden dat er een hele maand gerekend
  // wordt: zonder die twee is het bedrag niet na te rekenen.
  expect(kosten).toContain("gerekend over 1 maand");
  expect(kosten).toContain("Minder dan één maand kun je niet afnemen");
  // Er wordt geen netto beloofd waar er geen is.
  expect(c.querySelector('[data-testid="valuta-goedkoper-kosten-netto"]')).toBeNull();
});

test("op een groter bedrag verdient diezelfde maandprijs zich terug, en dan pas heet het netto", () => {
  render({ accounts: ONLY_ING, entries: PRICED });
  // € 5.000 tegen 1,4% is € 70 opslag; daar gaat € 16,90 vanaf en blijft € 53,10.
  typeAmount("5000");

  const order = rows().map(
    (r) => (r.querySelector(".travel-journey-name")?.textContent ?? "").trim().split(" ")[0],
  );
  expect(order).toEqual(["N26", "ING"]);
  expect(text("goedkoper")).toContain("Goedkoper kan");
  expect(text("valuta-goedkoper-kosten-netto")).toContain(eur(53.1));
  expect(text("valuta-goedkoper-kosten-netto")).toContain(
    `${eur(70)} voordeel min ${eur(16.9)} kaartkosten`,
  );
  expect(container!.querySelector('[data-testid="valuta-goedkoper-kosten-geen"]')).toBeNull();
});

test("een bank die hij al heeft kost hem niets extra, en daar staat geen prijs bij", () => {
  const withN26: Account[] = [
    ...ONLY_ING,
    {
      key: "N26A",
      iban: "",
      name: "N26",
      bank: "N26",
      entity: "Prive",
      currency: "EUR",
      balance: 300,
    },
  ];
  render({ accounts: withN26, entries: PRICED });

  const n26 = rowNamed("N26");
  expect(n26.textContent).toContain("van jou");
  // Die € 16,90 loopt toch al door, of hij er nu doorheen wisselt of niet. Er
  // staat dus niets over — en zeker geen "kaartkosten € 0,00", want dat zou
  // suggereren dat de kaart gratis is in plaats van al betaald.
  expect(n26.textContent).not.toContain("Kaartkosten");
  // En nu wint hij wél: geen opslag, geen extra kosten.
  expect(rows().indexOf(n26)).toBe(0);

  // Ter contrast: exact dezelfde kaart die hij NIET heeft draagt de prijs wel.
  act(() => root!.unmount());
  container!.remove();
  render({ accounts: ONLY_ING, entries: PRICED });
  expect(rowNamed("N26").textContent).toContain(`Kaartkosten: ${eur(16.9)} per maand`);
});

test("een bank met onbekende kosten blijft bruto, met de reden, en zonder het woord netto", () => {
  const c = render();
  const t212 = rowNamed("Trading 212");
  expect(t212.textContent).toContain("Kaartkosten: onbekend");
  expect(t212.textContent).toContain("Dat is geen nul");

  // De aanbeveling noemt het voordeel, en belooft niet dat het goedkoper is: de
  // andere helft van de rekening ontbreekt, en dat staat in de kop én eronder.
  expect(text("goedkoper")).toContain("of dat goedkoper uitpakt, weet LaVega niet");
  expect(text("goedkoper")).toContain(`${eur(14)} minder aan koersopslag`);
  const kosten = text("valuta-goedkoper-kosten");
  expect(kosten).toContain("staat niet in onze bronnen");
  expect(kosten).toContain("Dat is geen nul");
  expect(kosten).toContain("Het bedrag hierboven is dus bruto");
  // Het woord "netto" valt hier NOOIT: er is geen netto zolang de ene helft
  // ontbreekt, en een brutobedrag dat netto heet is de fout die dit moest wegnemen.
  expect(kosten.toLowerCase()).not.toContain("netto");
  expect(c.querySelector('[data-testid="valuta-goedkoper-kosten-netto"]')).toBeNull();
  expect(c.querySelector('[data-testid="valuta-goedkoper-kosten-geen"]')).toBeNull();
});

/* ════════════════ DE TWEEDE KOERSLAAG (22 augustus) ════════════════
 *
 * De koerslijst komt niet meer uit één bron. De ECB levert 29 referentiekoersen;
 * een aggregator vult aan tot 166. Wat hieronder bewaakt wordt is niet dat het
 * er meer zijn — dat is een getal en dat verandert vanzelf — maar de VIER dingen
 * die het verschil tussen die twee lagen moeten dragen:
 *
 *   1. de ECB wint waar allebei een koers hebben, en dat is op het scherm te zien
 *   2. een koers uit de tweede laag zegt dat hij uit de tweede laag komt
 *   3. valt die laag weg, dan is het weer "geen koers" — geen oude waarde
 *   4. de verplichte bronvermelding staat er, vóór de plooi
 *
 * Alle tests hierboven draaien met een MISLUKTE koersaanroep (zie beforeEach) en
 * dus zonder herkomst. Die stand blijft precies zoals hij was: zonder herkomst
 * beweert het scherm er niets over. */

/** Een serverantwoord met twee lagen. USD en GBP van de ECB, MAD van de
 *  aggregator — genoeg om alle vier de vragen op te stellen. */
function layered(over: Record<string, unknown> = {}) {
  return {
    base: "EUR",
    date: "2026-08-21",
    rates: { USD: 1.1699, GBP: 0.85, MAD: 10.789411 },
    origins: { USD: "ecb", GBP: "ecb", MAD: "aggregator" },
    layers: {
      ecb: { status: "live", date: "2026-08-21", count: 2 },
      aggregator: {
        status: "live",
        date: "2026-08-22",
        count: 1,
        provider: "erapi",
        nextUpdate: "2026-08-23",
      },
    },
    ...over,
  };
}

/** Renderen MET een geslaagde koersaanroep. De aanroep zit in een useEffect en
 *  lost op in een microtask, dus dit moet `await act` zijn — anders meet je het
 *  scherm zoals het er een tel eerder uitzag, met de meegebundelde koers. */
async function renderLive(payload: unknown, opts: { entries?: CatalogueEntryLike[] } = {}) {
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async () => ({
    ok: true,
    status: 200,
    json: async () => payload,
  })) as unknown as typeof fetch;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<Valuta accounts={ACCOUNTS} facts={[]} entries={opts.entries ?? ENTRIES} />);
  });
  return container;
}

/** De opties van een van de twee valutakiezers, per groep. `null` is de groep
 *  zonder kop: dat zijn de opties die los boven de <optgroup>'s staan. */
function ccyGroepen(c: HTMLElement, label: string): Map<string | null, string[]> {
  const sel = c.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  const out = new Map<string | null, string[]>();
  for (const opt of sel.querySelectorAll("option")) {
    const groep = opt.parentElement instanceof HTMLOptGroupElement ? opt.parentElement.label : null;
    out.set(groep, [...(out.get(groep) ?? []), opt.value]);
  }
  return out;
}

function kiesValuta(c: HTMLElement, label: string, waarde: string) {
  const sel = c.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  act(() => {
    sel.value = waarde;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

test("de twee lagen staan als aparte groepen in de valutakiezer, met de ECB bovenaan", async () => {
  const c = await renderLive(layered());
  const groepen = ccyGroepen(c, "Naar valuta");
  const koppen = [...groepen.keys()].filter((k): k is string => k !== null);

  // De volgorde is de rangorde: eerst wat een centrale bank publiceert.
  expect(koppen).toEqual(["ECB-referentiekoers (2)", "Dagkoers via ExchangeRate-API (1)"]);
  expect(groepen.get("ECB-referentiekoers (2)")).toEqual(["GBP", "USD"]);
  expect(groepen.get("Dagkoers via ExchangeRate-API (1)")).toEqual(["MAD"]);
  // De euro hoort bij geen van beide lagen: hij is de eenheid, geen koers.
  expect(groepen.get(null)).toEqual(["EUR"]);
});

test("een koers uit de tweede laag zegt dat hij dat is, met zijn eigen datum", async () => {
  const c = await renderLive(layered());
  kiesValuta(c, "Naar valuta", "MAD");
  const herkomst = c.querySelector('[data-testid="koers-herkomst"]')!.textContent ?? "";
  expect(herkomst).toContain("ExchangeRate-API");
  expect(herkomst).toContain("2026-08-22");
  // En het woord dat het onderscheid draagt: dit is geen referentiekoers.
  expect(herkomst).toContain("geen referentiekoers van een centrale bank");
});

test("een ECB-koers noemt de ECB en zijn eigen, andere peildatum", async () => {
  const c = await renderLive(layered());
  const herkomst = c.querySelector('[data-testid="koers-herkomst"]')!.textContent ?? "";
  expect(herkomst).toContain("ECB-referentiekoers van 2026-08-21");
  expect(herkomst).not.toContain("ExchangeRate-API");
});

test("een kruising tussen de twee lagen noemt allebei de benen", async () => {
  const c = await renderLive(layered());
  kiesValuta(c, "Van valuta", "USD");
  kiesValuta(c, "Naar valuta", "MAD");
  const herkomst = c.querySelector('[data-testid="koers-herkomst"]')!.textContent ?? "";
  // USD → MAD loopt via de euro en raakt dus BEIDE lagen. Eén ervan verzwijgen
  // zou de uitkomst harder of zachter laten lijken dan hij is.
  expect(herkomst).toContain("Gekruist via de euro");
  expect(herkomst).toContain("USD");
  expect(herkomst).toContain("MAD");
  expect(herkomst).toContain("ECB-referentiekoers van 2026-08-21");
  expect(herkomst).toContain("ExchangeRate-API");
  expect(herkomst).toContain("zo hard als dat tweede been");
});

test("de verplichte bronvermelding staat vóór de plooi, niet in een uitklapper", async () => {
  const c = await renderLive(layered());
  const vermelding = c.querySelector('[data-testid="fx-bronvermelding"]')!;
  const link = vermelding.querySelector("a")!;
  // De voorwaarden schrijven deze linktekst voor (exchangerate-api.com/docs/free,
  // nagekeken 22 augustus 2026). Hij staat er letterlijk.
  expect(link.textContent).toBe("Rates By Exchange Rate API");
  expect(link.getAttribute("href")).toBe("https://www.exchangerate-api.com");
  // Een vermelding achter een dichte <details> is een vermelding die je niet ziet.
  expect(vermelding.closest("details")).toBeNull();
});

test("zonder tweede laag verdwijnen die valuta uit de lijst — geen oude waarde, geen vermelding", async () => {
  const c = await renderLive(
    layered({
      rates: { USD: 1.1699, GBP: 0.85 },
      origins: { USD: "ecb", GBP: "ecb" },
      layers: { ecb: { status: "live", date: "2026-08-21", count: 2 }, aggregator: null },
    }),
  );
  const groepen = ccyGroepen(c, "Naar valuta");
  expect([...groepen.values()].flat()).not.toContain("MAD");
  expect([...groepen.keys()]).not.toContain("Dagkoers via ExchangeRate-API (1)");
  // Geen bron, geen vermelding — en geen lege alinea waar hij stond.
  expect(c.querySelector('[data-testid="fx-bronvermelding"]')).toBeNull();
  // De bronregel zegt het ook, in plaats van de laag stilzwijgend weg te laten.
  const tekst = paneel(toonmeer("valuta-bronnen"));
  expect(tekst).toContain("er staat geen tweede laag in dit scherm");
  expect(tekst).toContain("dat is iets anders dan een koers van nul");
});

test("een aanbieder die dit scherm niet kent levert geen koersen, want de vermelding kan niet", async () => {
  const c = await renderLive(
    layered({
      layers: {
        ecb: { status: "live", date: "2026-08-21", count: 2 },
        aggregator: {
          status: "live",
          date: "2026-08-22",
          count: 1,
          provider: "nooitvanGehoord",
          nextUpdate: null,
        },
      },
    }),
  );
  // Geen vermelding mogelijk, dus de koersen gaan eruit. Streng, en met opzet:
  // de andere uitkomst is een scherm dat koersen toont die het niet mag tonen.
  expect([...ccyGroepen(c, "Naar valuta").values()].flat()).not.toContain("MAD");
  expect(c.querySelector('[data-testid="fx-bronvermelding"]')).toBeNull();
});

test("de kop noemt beide lagen met hun aantallen, en zegt niet meer 'ECB-middenkoers'", async () => {
  const c = await renderLive(layered());
  const eyebrow = c.querySelector(".view-head .eyebrow")!.textContent ?? "";
  expect(eyebrow).toContain("2 ECB-referentiekoersen van 2026-08-21");
  expect(eyebrow).toContain("1 dagkoersen via ExchangeRate-API van 2026-08-22");
  // De oude vaste tekst zou nu voor het grootste deel van de lijst onwaar zijn.
  expect(eyebrow).not.toContain("live ECB-middenkoers");
  expect(eyebrow).toContain("koersopslag per bank uit de catalogus");
});

test("een antwoord waarin één koers geen herkomst heeft, wordt in zijn geheel niet gelabeld", async () => {
  const c = await renderLive(layered({ origins: { USD: "ecb", GBP: "ecb" } }));
  // MAD staat in `rates` maar niet in `origins`. Half labelen is de ergste
  // uitkomst: dan lijkt de rest zonder kop óók ECB. Dus: geen groepen, geen
  // herkomstregel, geen vermelding — en de koersen blijven gewoon werken.
  expect([...ccyGroepen(c, "Naar valuta").keys()]).toEqual([null]);
  expect(c.querySelector('[data-testid="koers-herkomst"]')).toBeNull();
  expect(c.querySelector('[data-testid="fx-bronvermelding"]')).toBeNull();
  expect([...ccyGroepen(c, "Naar valuta").values()].flat()).toContain("MAD");
});

test("de bronregel noemt beide lagen apart, elk met zijn eigen datum en aanbieder", async () => {
  await renderLive(layered());
  const tekst = paneel(toonmeer("valuta-bronnen"));
  expect(tekst).toContain("2 ECB-referentiekoersen van 2026-08-21 via Frankfurter");
  expect(tekst).toContain("1 koersen van ExchangeRate-API, peildatum 2026-08-22");
  expect(tekst).toContain("volgende ronde 2026-08-23");
  // De regel die het hele ontwerp draagt, in woorden op het scherm.
  expect(tekst).toContain("een ECB-koers wordt er nooit door overschreven");
  expect(tekst).toContain("er blijft geen oude waarde staan");
});

test("een onbekende aanbieder levert een melding met de ECHTE oorzaak, niet 'bron weggevallen'", async () => {
  await renderLive(
    layered({
      layers: {
        ecb: { status: "live", date: "2026-08-21", count: 2 },
        aggregator: {
          status: "live",
          date: "2026-08-22",
          count: 1,
          provider: "nooitvanGehoord",
          nextUpdate: null,
        },
      },
    }),
  );
  const tekst = paneel(toonmeer("valuta-bronnen"));
  // De laag IS er; hij wordt geweigerd. Die twee door elkaar halen stuurt de
  // lezer naar de bron kijken terwijl het probleem in deze app zit.
  expect(tekst).toContain("nooitvanGehoord");
  expect(tekst).toContain("die dit scherm niet kent");
  expect(tekst).not.toContain("er staat geen tweede laag in dit scherm");
});

import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Account, Invoice, Tx, VatSettings } from "@lavega/core";
import { formatEuro } from "../../format.js";
import { BtwBlock, btwRows } from "./BtwWidget";

/* De btw-kaart op het overzicht, in de volgorde van eerlijkheid die hij zelf
 * gaf: eerst het geval waarin er GEEN bedrag is omdat het stelsel niet gekozen
 * is, dan het geval waarin de dekking onvolledig is, dan de gewone positie.
 *
 * Op 16 augustus 2026 is het lopende NL-kwartaal Q3 (1 jul t/m 30 sep), met
 * 31 oktober als uiterste datum: Q2 sloot al op 31 juli. Elke factuur hieronder
 * heeft daarom een factuurdatum in juli. */

const ASOF = "2026-08-16";

const accounts: Account[] = [
  {
    key: "A1",
    iban: "NL01INGB0001",
    name: "Zakelijk",
    bank: "ING",
    entity: "Holding BV",
    currency: "EUR",
    balance: 10_000,
  },
  {
    key: "A2",
    iban: "NL02RABO0001",
    name: "Zakelijk",
    bank: "Rabobank",
    entity: "Café BV",
    currency: "EUR",
    balance: 4_000,
  },
];

/** Eén omzettransactie per onderneming, zodat de marge-benadering ALTIJD een
 *  getal zou kunnen opleveren. Dat is precies wat de eerste test moet kunnen
 *  bewijzen: het getal bestaat, en de kaart toont het toch niet. */
const txs: Tx[] = [
  {
    id: "t1",
    accountKey: "A1",
    date: "2026-07-05",
    amount: 12_100,
    currency: "EUR",
    counterparty: "Klant BV",
    description: "Omzet",
    category: "",
    manual: false,
  },
  {
    id: "t2",
    accountKey: "A2",
    date: "2026-07-06",
    amount: 6_050,
    currency: "EUR",
    counterparty: "Gast",
    description: "Omzet",
    category: "",
    manual: false,
  },
];

/** Wat de marge-benadering van Holding BV zou opleveren: 12.100 × 21 / 121. */
const PROXY_HOLDING = 2_100;

function settings(entity: string, extra: Partial<VatSettings> = {}): VatSettings {
  return {
    entity,
    frequency: "quarterly",
    defaultRatePct: 21,
    mixedRates: false,
    country: "NL",
    ...extra,
  };
}

function invoice(i: Partial<Invoice> & { id: string }): Invoice {
  return {
    entity: "Holding BV",
    direction: "in",
    counterparty: "Klant BV",
    issueDate: "2026-07-10",
    dueDate: "2026-08-10",
    amount: 12_100,
    currency: "EUR",
    status: "expected",
    sourceType: "manual",
    ...i,
  };
}

function render(opts: { entities: string[]; vatSettings: VatSettings[]; invoices?: Invoice[] }) {
  return renderToStaticMarkup(
    <BtwBlock
      entities={opts.entities}
      txs={txs}
      accounts={accounts}
      asOf={ASOF}
      vatSettings={opts.vatSettings}
      invoices={opts.invoices ?? []}
      country="NL"
      onNavigate={() => {}}
    />,
  );
}

test("zonder onderneming in beeld staat de kaart er niet", () => {
  expect(render({ entities: [], vatSettings: [] })).toBe("");
});

test("een onbekend stelsel levert GEEN bedrag op, wel de oorzaak en waar hij kiest", () => {
  /* Het stelsel is een feit dat alleen hij kan leveren, en het verplaatst de
   * btw naar een andere periode. `vatPosition` valt intern terug op de
   * marge-benadering en heeft dus wél een getal; deze kaart mag dat getal niet
   * als antwoord neerzetten, want dan zou een aanname het bedrag bepalen. */
  const html = render({
    entities: ["Holding BV"],
    vatSettings: [settings("Holding BV")], // geen vatBasis
    invoices: [invoice({ id: "i1", vatAmount: 2_100 })],
  });

  expect(html).toContain("geen bedrag");
  expect(html).not.toContain(formatEuro(PROXY_HOLDING));
  expect(html).toContain("factuurstelsel");
  expect(html).toContain("kasstelsel");
  expect(html).toContain("periode van de factuur");
  expect(html).toContain("bij het kasstelsel in die van de betaling");
  // Het advies moet kunnen werken in de toestand waarin het staat: bij
  // Belasting staat per onderneming een keuzelijst "Stelsel".
  expect(html).toContain("Het stelsel kies je bij Belasting");
  expect(html).toContain("Belasting →");
  // Geen bron-regel: er is geen bedrag om een bron bij te noemen.
  expect(html).not.toContain("Bron:");
});

test("onvolledige dekking zegt hoeveel facturen geen btw-bedrag noemen", () => {
  const html = render({
    entities: ["Holding BV"],
    vatSettings: [settings("Holding BV", { vatBasis: "factuurstelsel" })],
    invoices: [
      invoice({ id: "i1", vatAmount: 2_100 }),
      invoice({ id: "i2" }),
      invoice({ id: "i3", direction: "out" }),
    ],
  });

  expect(html).toContain("Van 2 van de 3 facturen in deze periode is het btw-bedrag onbekend");
  // De facturen zijn dan niet de basis; wat er staat is de marge-benadering, en
  // de kaart noemt die bron in plaats van hem te verzwijgen.
  expect(html).toContain("een marge-benadering uit je banktransacties");
  expect(html).toContain(formatEuro(PROXY_HOLDING));
});

test("een gewone positie: bedrag, periode, richting en de eerstvolgende deadline", () => {
  const html = render({
    entities: ["Holding BV"],
    vatSettings: [settings("Holding BV", { vatBasis: "factuurstelsel" })],
    invoices: [
      invoice({ id: "i1", direction: "in", vatAmount: 2_100 }),
      invoice({ id: "i2", direction: "out", amount: 2_420, vatAmount: 420 }),
    ],
  });

  expect(html).toContain(formatEuro(1_680)); // 2.100 af te dragen − 420 voorbelasting
  expect(html).toContain("te betalen");
  expect(html).toContain("Q3 2026");
  expect(html).toContain("uiterlijk 2026-10-31");
  expect(html).toContain("loopt nog t/m 2026-09-30");
  expect(html).toContain("Bron: je facturen");
  expect(html).not.toContain("geen bedrag");
});

test("meer voorbelasting dan afdracht is terug te vragen, niet een absentie", () => {
  const html = render({
    entities: ["Holding BV"],
    vatSettings: [settings("Holding BV", { vatBasis: "factuurstelsel" })],
    invoices: [
      invoice({ id: "i1", direction: "in", vatAmount: 200 }),
      invoice({ id: "i2", direction: "out", amount: 5_000, vatAmount: 900 }),
    ],
  });
  expect(html).toContain(formatEuro(700));
  expect(html).toContain("terug te vragen");
});

test("bij meerdere ondernemingen toont de kaart er één en telt hij ze niet op", () => {
  /* Holding BV wacht op een stelsel, Café BV heeft een gewone positie. De kaart
   * toont de onderneming waar iets speelt, noemt het aantal andere, en schrijft
   * op waarom er geen som staat: verschillende stelsels en aangifteperiodes
   * maken van een totaal een bedrag zonder periode, en een onderneming zonder
   * bedrag zou er stilzwijgend als nul in meegaan. */
  const html = render({
    entities: ["Holding BV", "Café BV"],
    vatSettings: [settings("Holding BV"), settings("Café BV", { vatBasis: "factuurstelsel" })],
    invoices: [
      invoice({ id: "i1", entity: "Holding BV", vatAmount: 2_100 }),
      invoice({ id: "i2", entity: "Café BV", direction: "in", amount: 6_050, vatAmount: 1_050 }),
      invoice({ id: "i3", entity: "Café BV", direction: "out", amount: 1_210, vatAmount: 210 }),
    ],
  });

  expect(html).toContain("Holding BV");
  expect(html).toContain("geen bedrag");
  expect(html).toContain("Nog 1 andere onderneming");
  expect(html).toContain("Belasting toont ze apart");
  // Geen enkel opgeteld bedrag: niet de som met de benadering erbij, en ook
  // niet het bedrag van de onderneming die hier niet getoond wordt.
  expect(html).not.toContain(formatEuro(840));
  expect(html).not.toContain(formatEuro(PROXY_HOLDING + 840));

  // En de rangschikking is de volgorde van eerlijkheid: wat LaVega niet kan
  // beantwoorden staat vóór wat het wel kan.
  const rows = btwRows({
    entities: ["Café BV", "Holding BV"],
    txs,
    accounts,
    asOf: ASOF,
    vatSettings: [settings("Holding BV"), settings("Café BV", { vatBasis: "factuurstelsel" })],
    invoices: [
      invoice({ id: "i1", entity: "Holding BV", vatAmount: 2_100 }),
      invoice({ id: "i2", entity: "Café BV", direction: "in", amount: 6_050, vatAmount: 1_050 }),
      invoice({ id: "i3", entity: "Café BV", direction: "out", amount: 1_210, vatAmount: 210 }),
    ],
  });
  expect(rows.map((r) => r.entity)).toEqual(["Holding BV", "Café BV"]);
  expect(rows[0].amountShown).toBe(false);
  expect(rows[1].amountShown).toBe(true);
});

test("zonder transacties in de periode is er geen bedrag, en dat is geen nul", () => {
  const html = renderToStaticMarkup(
    <BtwBlock
      entities={["Holding BV"]}
      txs={[]}
      accounts={accounts}
      asOf={ASOF}
      vatSettings={[settings("Holding BV", { vatBasis: "factuurstelsel" })]}
      invoices={[]}
      country="NL"
      onNavigate={() => {}}
    />,
  );
  expect(html).toContain("geen bedrag");
  expect(html).toContain("Dat is geen nul");
  expect(html).not.toContain(formatEuro(0));
});

test("de kaart rekent met dezelfde periode en instellingen als Belasting", () => {
  /* Niet cosmetisch: `resolveVatSettings` en `txsForEntity` staan in core en
   * worden door allebei de schermen aangeroepen. Deze test pint vast wat die
   * gedeelde regel oplevert — een frequentie die het land niet kent wordt
   * vervangen, en het land komt uit het profiel en niet uit de bewaarde
   * instelling. */
  const rows = btwRows({
    entities: ["Holding BV"],
    txs,
    accounts,
    asOf: ASOF,
    vatSettings: [settings("Holding BV", { vatBasis: "factuurstelsel", frequency: "monthly" })],
    invoices: [],
    country: "NL",
  });
  expect(rows[0].position.period.periodLabel).toBe("jul 2026");
  expect(rows[0].position.period.deadline).toBe("2026-08-31");
  expect(rows[0].position.vatLabel).toBe("BTW");
});

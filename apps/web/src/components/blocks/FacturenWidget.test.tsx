import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Invoice } from "@lavega/core";
import { formatEuro } from "../../format.js";
import { FacturenBlock, openInvoiceSummary } from "./FacturenWidget";

/* De facturenkaart op het overzicht. Drie toestanden die hij noemde — niets
 * openstaand, iets openstaand, iets over de vervaldatum — plus de twee die
 * daaronder liggen: geen enkele factuur (dan staat de kaart er niet) en een
 * bedrag dat niet in euro's bekend is (dan telt het niet mee). */

const ASOF = "2026-08-16";

function invoice(i: Partial<Invoice> & { id: string }): Invoice {
  return {
    entity: "Holding BV",
    direction: "in",
    counterparty: "Klant BV",
    issueDate: "2026-07-10",
    dueDate: "2026-09-10",
    amount: 1_000,
    currency: "EUR",
    status: "expected",
    sourceType: "manual",
    ...i,
  };
}

function render(invoices: Invoice[], entities: string[] = ["Holding BV"]) {
  return renderToStaticMarkup(
    <FacturenBlock invoices={invoices} entities={entities} asOf={ASOF} onNavigate={() => {}} />,
  );
}

test("zonder enige factuur staat de kaart er niet — geen leeg blok", () => {
  expect(render([])).toBe("");
});

test("staat er niets meer open, dan zegt de kaart dat, en noemt geen bedrag", () => {
  /* De keerzijde van de regel: dit is een UITGESPROKEN nul. Er zijn facturen en
   * geen ervan staat open, dus "niets staat open" is een antwoord en geen
   * afwezigheid. Een bedrag hoort er niet bij — er is niets om een bedrag over
   * te noemen. */
  const html = render([
    invoice({ id: "a", status: "paid", amount: 1_200 }),
    invoice({ id: "b", status: "cancelled", amount: 800 }),
  ]);
  expect(html).toContain("Niets staat open");
  expect(html).toContain("2 facturen die LaVega kent");
  expect(html).not.toContain("Te ontvangen");
  expect(html).not.toContain(formatEuro(1_200));
  expect(html).not.toContain(formatEuro(0));
});

test("staat er wel iets open, dan zijn het het aantal en de twee kanten apart", () => {
  const html = render([
    invoice({ id: "a", direction: "in", amount: 1_200 }),
    invoice({ id: "b", direction: "in", amount: 3_050 }),
    invoice({ id: "c", direction: "out", amount: 800 }),
    invoice({ id: "d", direction: "in", amount: 9_999, status: "paid" }),
  ]);
  expect(html).toContain(">3<"); // drie openstaand; de betaalde telt niet mee
  expect(html).toContain("openstaand");
  expect(html).toContain("Te ontvangen · 2 facturen");
  expect(html).toContain(formatEuro(4_250));
  expect(html).toContain("Te betalen · 1 factuur");
  expect(html).toContain(formatEuro(800));
  // AR en AP worden NIET bij elkaar opgeteld: dat getal beantwoordt geen van
  // beide vragen.
  expect(html).not.toContain(formatEuro(5_050));
  expect(html).not.toContain(formatEuro(3_450));
  expect(html).toContain("Geen enkele openstaande factuur is over zijn vervaldatum");
});

test("wat over de vervaldatum heen is, staat er met aantal én bedrag per kant", () => {
  const html = render([
    invoice({ id: "a", direction: "in", amount: 1_200, dueDate: "2026-07-31" }),
    invoice({ id: "b", direction: "out", amount: 400, dueDate: "2026-08-01" }),
    invoice({ id: "c", direction: "in", amount: 3_050, dueDate: "2026-09-10" }),
  ]);
  expect(html).toContain("2 facturen zijn over de vervaldatum");
  expect(html).toContain(`${formatEuro(1_200)} te ontvangen`);
  expect(html).toContain(`${formatEuro(400)} te betalen`);
  // Ook hier geen optelsom over de twee kanten heen.
  expect(html).not.toContain(formatEuro(1_600));
});

test("een factuur zonder euro-bedrag zit niet in het bedrag, en de kaart zegt dat", () => {
  const html = render([
    invoice({ id: "a", amount: 1_200 }),
    invoice({ id: "b", amount: 5_000, currency: "USD" }),
    invoice({ id: "c", amount: 900, currency: "" }),
  ]);
  expect(html).toContain(formatEuro(1_200));
  expect(html).not.toContain(formatEuro(7_100));
  expect(html).not.toContain(formatEuro(5_000));
  // Drie staan er open, ook al draagt er maar één een euro-bedrag.
  expect(html).toContain("Te ontvangen · 3 facturen");
  expect(html).toContain("Van 2 facturen is het bedrag niet in euro");
});

test("de kaart telt alleen de ondernemingen die dit scherm toont", () => {
  const invoices = [
    invoice({ id: "a", entity: "Holding BV", amount: 1_200 }),
    invoice({ id: "b", entity: "Café BV", amount: 4_000 }),
  ];
  const html = render(invoices, ["Holding BV"]);
  expect(html).toContain(formatEuro(1_200));
  expect(html).not.toContain(formatEuro(4_000));
  expect(html).not.toContain(formatEuro(5_200));

  /* Een LEGE lijst is geen lege scope maar het ontbreken van de dimensie: geen
   * enkele rekening in beeld draagt een onderneming (de zelfstandige zonder
   * entiteiten). Alles wegfilteren zou "niets staat open" opleveren, en dat is
   * een conclusie die het ontbreken van entiteiten niet kan dragen. */
  const zonder = openInvoiceSummary(invoices, [], ASOF);
  expect(zonder.open).toBe(2);
  expect(zonder.ontvangen.eurTotal).toBe(5_200);
});

test("openInvoiceSummary telt de kanten los en houdt te-laat per kant bij", () => {
  const s = openInvoiceSummary(
    [
      invoice({ id: "a", direction: "in", amount: 1_200, dueDate: "2026-08-01" }),
      invoice({ id: "b", direction: "out", amount: 400, dueDate: "2026-09-01" }),
      invoice({ id: "c", direction: "out", amount: 250, dueDate: "2026-08-15", currency: "GBP" }),
    ],
    ["Holding BV"],
    ASOF,
  );
  expect(s.inScope).toBe(3);
  expect(s.open).toBe(3);
  expect(s.ontvangen).toMatchObject({ count: 1, eurCount: 1, eurTotal: 1_200, lateCount: 1, lateEurTotal: 1_200 });
  // De late GBP-factuur telt wel als te laat, maar niet in een euro-bedrag.
  expect(s.betalen).toMatchObject({ count: 2, eurCount: 1, eurTotal: 400, lateCount: 1, lateEurCount: 0, lateEurTotal: 0 });
  expect(s.zonderEuroBedrag).toBe(1);
});

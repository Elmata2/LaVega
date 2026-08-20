// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test } from "vitest";
import type { Account, Invoice, Tx, VatSettings } from "@lavega/core";
import { makeInvoice, sumTaxFigures, vatPosition } from "@lavega/core";
import Belasting, { readBookkeepingSheet } from "./views/Belasting";
import { setHomeCountry } from "./settings";

/* Belasting after the UI review: no grey instruction paragraph, and one module
 * per tax that the profile's country actually has rules for. The modules are
 * driven by packages/core/src/taxpacks — NL has VAT only (its voorlopige
 * aanslag is set by the Belastingdienst, so LaVega does not model it), DE also
 * prepays profit tax. Nothing may appear that the engine cannot compute. */

const ACCOUNTS: Account[] = [
  { key: "A1", iban: "NL01", name: "Zakelijk", bank: "ING", entity: "BV1", currency: "EUR", balance: 10_000 },
];

function tx(id: string, date: string, amount: number): Tx {
  return { id, accountKey: "A1", date, amount, currency: "EUR", counterparty: "Klant", description: "", category: "", manual: false };
}

type RenderOpts = { invoices?: Invoice[]; vatSettings?: VatSettings[]; asOf?: string };

function render(txs: Tx[], entities = ["BV1"], opts: RenderOpts = {}) {
  return renderToStaticMarkup(
    <Belasting
      entities={entities}
      txs={txs}
      accounts={ACCOUNTS}
      asOf={opts.asOf ?? "2026-08-16"}
      vatSettings={opts.vatSettings ?? []}
      invoices={opts.invoices ?? []}
      scheduledFlows={[]}
      busy={false}
      onSaveVatSettings={() => {}}
      onSaveScheduledFlows={() => {}}
    />,
  );
}

beforeEach(() => {
  localStorage.clear();
});

test("the grey instruction sentence under the title is gone", () => {
  const html = render([]);
  expect(html).not.toContain("LaVega schat per BV het BTW-bedrag dat je opzij moet zetten");
  expect(html).not.toContain("indicatieve schatting</span>");
});

test("NL gets exactly one tax module — its VAT — because that is all LaVega can compute there", () => {
  const html = render([tx("t1", "2026-08-01", 12_100)]);
  const titles = [...html.matchAll(/class="module-title">([^<]*)</g)].map((m) => m[1]);
  expect(titles).toEqual(["BTW", "Wat LaVega hier niet berekent"]);

  expect(html).toContain("Belasting · Nederland");
  expect(html).toContain("1 belasting");
  expect(html).toContain("Tarieven in Nederland: 21% / 9% / 0%");
  // And it says out loud which Dutch tax it deliberately does NOT model.
  expect(html).toContain("voorlopige aanslag vennootschapsbelasting");
  expect(html).not.toContain("Vorauszahlung");
});

test("switching the profile to DE adds the prepayment module, with its dated instalments", () => {
  setHomeCountry("DE");
  // € 100.000 profit realised this year.
  const html = render([tx("t1", "2026-02-01", 100_000)]);

  const titles = [...html.matchAll(/class="module-title">([^<]*)</g)].map((m) => m[1]);
  expect(titles).toEqual(["USt", "Vorauszahlung", "Wat LaVega hier niet berekent"]);
  expect(html).toContain("Belasting · Duitsland");
  expect(html).toContain("2 belastingen");
  expect(html).toContain("Tarieven in Duitsland: 19% / 7% / 0%");

  // 30% of € 100.000 = € 30.000, cut into the four statutory dates. The two
  // that already passed roll into the Nachzahlung of the following year.
  expect(html).toContain("2026-09-10");
  expect(html).toContain("2026-12-10");
  expect(html).toContain("Nachzahlung 2026");
  expect(html).toContain("2027-03-10");
  // It is an estimate until the Finanzamt assesses it, and says so.
  expect(html).toContain("schatting");
});

test("a quarter with only costs is money BACK, not a dash and never € 0,00", () => {
  // This test used to assert a dash. A quarter whose movements are net negative
  // is the proxy saying "terug te vragen", and rendering that as an absence is
  // defect (c)'s cousin: a refund shown as nothing (design 2026-08-20).
  const html = render([tx("t1", "2026-08-01", -5_000)]);
  expect(html).toContain("BTW");
  expect(html).not.toContain("€&nbsp;0,00");
  expect(html).toContain("terug te vragen");
  // and LaVega does not invent the date the Belastingdienst pays
  expect(html).toContain("wanneer de Belastingdienst uitbetaalt");
});

test("an entity with no movements at all in the period says so — it does not say zero", () => {
  const html = render([tx("t1", "2026-01-05", 12_100)]); // Q1, and we stand in Q3
  expect(html).toContain("geen transacties");
  expect(html).not.toContain("€&nbsp;0,00");
});

/* ── Richting A on screen (design 2026-08-20) ─────────────────────────────── */

test("mid-period the figure says it is the stand tot vandaag, not the aangifte", () => {
  // 16 Aug 2026 sits inside Q3 (1 Jul - 30 Sep), due 31 Oct.
  const html = render([tx("t1", "2026-07-10", 12_100)]);
  expect(html).toContain("Q3 2026");
  expect(html).toContain("uiterlijk 2026-10-31");
  expect(html).toContain("loopt nog");
  expect(html).toContain("stand tot 2026-08-16");
  expect(html).toContain("niet de aangifte");
});

test("a closed period says it is closed instead", () => {
  // 20 July: Q2 is over, its deadline (31 July) is not.
  const html = render([tx("t1", "2026-05-10", 12_100)], ["BV1"], { asOf: "2026-07-20" });
  expect(html).toContain("Q2 2026");
  expect(html).toContain("afgesloten");
  expect(html).not.toContain("loopt nog");
});

const invoice = (o: Partial<Invoice> = {}): Invoice => makeInvoice({
  entity: "BV1", direction: "in", counterparty: "Klant", issueDate: "2026-07-10",
  dueDate: "2026-08-10", amount: 1210, vatAmount: 210, currency: "EUR",
  status: "expected", sourceType: "csv", ...o,
});

test("(b) vatAmount reaches the screen: the invoice basis, with its coverage", () => {
  const invoices = [
    invoice(),
    invoice({ direction: "out", counterparty: "Leverancier", amount: 484, vatAmount: 84 }),
  ];
  const vatSettings: VatSettings[] = [
    { entity: "BV1", frequency: "quarterly", defaultRatePct: 21, mixedRates: false, vatBasis: "factuurstelsel" },
  ];
  // No bank movement at all in Q3: the proxy would know nothing, the invoices do.
  const html = render([], ["BV1"], { invoices, vatSettings });
  expect(html).toContain("je facturen");
  expect(html).toContain("2 van de 2 facturen");
  expect(html).toContain("126,00"); // 210 - 84 = € 126 te betalen
  expect(html).toContain("te betalen");
});

test("without a stelsel the invoices are counted but not used, and it asks which one", () => {
  const invoices = [invoice(), invoice({ direction: "out", amount: 484, vatAmount: 84 })];
  const html = render([tx("t1", "2026-07-10", 12_100)], ["BV1"], { invoices });
  expect(html).toContain("Factuurstelsel of kasstelsel?");
  expect(html).not.toContain("je facturen (factuurstelsel)");
  expect(html).toContain("marge-benadering");
});

test("(a) the bookkeeping sheet reaches the BTW figure through the view's own reader", () => {
  // The seam the view uses on a CSV he picks: text -> rows -> figures -> basis.
  const csv = [
    "Periode;Omzet;Kosten;Btw over omzet;Voorbelasting",
    "Q3 2026;100000;20000;21000;4200",
    "Q2 2026;50000;10000;10500;2100",
  ].join("\n");
  const sheet = readBookkeepingSheet(csv);
  expect(sheet.rows).toHaveLength(2);
  const figures = sumTaxFigures(sheet.rows, "2026-07-01", "2026-09-30");
  expect(figures.vatChargedCents).toBe(2_100_000);
  const p = vatPosition({
    txs: [], asOf: "2026-08-16",
    settings: { entity: "BV1", frequency: "quarterly", defaultRatePct: 21, mixedRates: false },
    figures,
  });
  expect(p.basis).toBe("sheet");
  expect(p.netCents).toBe(1_680_000); // 21000 - 4200, his own numbers
});

test("the copy stays on the measuring side of the line", () => {
  // Section 7 of the design: LaVega may say what happened, when the next date is
  // and what a published rule says — not what he should do about it. A red test
  // is what keeps that true six months from now.
  const forbidden = ["advies", "adviseer", "wij raden aan", "we raden aan", "je moet", "u moet", "optimaal", "bespaar", "besparing", "fiscaal voordeel"];
  const invoices = [invoice(), invoice({ direction: "out", amount: 484, vatAmount: 84 })];
  const screens = [
    render([tx("t1", "2026-07-10", 12_100)], ["BV1"], { invoices }),
    render([tx("t1", "2026-08-01", -5_000)]),
    render([]),
  ];
  setHomeCountry("DE");
  screens.push(render([tx("t1", "2026-02-01", 100_000)]));
  for (const html of screens) {
    for (const word of forbidden) expect(html.toLowerCase()).not.toContain(word);
  }
});

test("with no entities it asks for accounts instead of inventing one", () => {
  const html = render([], []);
  expect(html).toContain("Nog geen entiteiten");
  expect(html).not.toContain("module-title");
});

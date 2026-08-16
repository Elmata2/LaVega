// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test } from "vitest";
import type { Account, Tx } from "@lavega/core";
import Belasting from "./views/Belasting";
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

function render(txs: Tx[], entities = ["BV1"]) {
  return renderToStaticMarkup(
    <Belasting
      entities={entities}
      txs={txs}
      accounts={ACCOUNTS}
      asOf="2026-08-16"
      vatSettings={[]}
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

test("nothing to reserve shows a dash, never € 0,00", () => {
  // Only outflows: no margin, so no VAT set-aside exists.
  const html = render([tx("t1", "2026-08-01", -5_000)]);
  expect(html).toContain("BTW");
  expect(html).not.toContain("€&nbsp;0,00");
  expect(html).toContain("—");
});

test("with no entities it asks for accounts instead of inventing one", () => {
  const html = render([], []);
  expect(html).toContain("Nog geen entiteiten");
  expect(html).not.toContain("module-title");
});

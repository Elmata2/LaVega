// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, test } from "vitest";
import type { Account } from "@lavega/core";
import { DE_TAX_PACK, NL_TAX_PACK } from "@lavega/core";
import Belasting from "./views/Belasting";
import { setHomeCountry, setTaxCountryOverride } from "./settings";
import { adminCopy } from "./copy/admin.js";
import { countryNameIn } from "./countries.js";

/* WHOSE TAX LAW IS THIS SCREEN SHOWING.
 *
 * It used to answer that silently. The profile's country was narrowed to a
 * country with a rule pack, and anything else fell through to the Dutch rules
 * with nothing on screen to say so — a Belgian owner read Dutch tax rules that
 * looked authoritative. This file pins the three answers apart: the system in
 * force is chosen here, the profile still drives it when it can, and a country
 * LaVega has no rules for is named rather than swallowed. */

const ACCOUNTS: Account[] = [
  { key: "A1", iban: "NL01", name: "Zakelijk", bank: "ING", balance: 1000, entity: "BV1" },
] as unknown as Account[];

function render() {
  return renderToStaticMarkup(
    <Belasting
      entities={["BV1"]}
      txs={[]}
      accounts={ACCOUNTS}
      asOf="2026-08-16"
      vatSettings={[]}
      invoices={[]}
      scheduledFlows={[]}
      allAccounts={ACCOUNTS}
      allTxs={[]}
      entityProfiles={[]}
      busy={false}
      onSaveVatSettings={() => {}}
      onSaveScheduledFlows={() => {}}
    />,
  );
}

beforeEach(() => {
  localStorage.clear();
  document.cookie = "lavega_locale=nl; Path=/";
});

test("a Dutch profile gets the Dutch rules, and is not warned about anything", () => {
  setHomeCountry("NL");
  const html = render();
  expect(html).toContain(NL_TAX_PACK.vat.label);
  expect(html).not.toContain(DE_TAX_PACK.profitTax.label);
  expect(html).not.toContain("heeft nog geen belastingregels");
});

test("a German profile gets the German rules, including the prepayment", () => {
  setHomeCountry("DE");
  const html = render();
  expect(html).toContain(DE_TAX_PACK.vat.label);
  expect(html).toContain(DE_TAX_PACK.profitTax.label);
  expect(html).not.toContain("heeft nog geen belastingregels");
});

/* THE ONE THAT USED TO BE SILENT. Belgium has no pack. The screen still renders
 * the Dutch rules, because a blank tax screen helps nobody, but it has to say
 * whose rules those are and that they are not Belgium's. */
test("a country LaVega has no rules for is named, not swallowed", () => {
  setHomeCountry("BE");
  const html = render();
  const expected = adminCopy.nl.belasting.header.unsupportedCountry(countryNameIn("nl", "BE"));
  expect(html).toContain(expected);
  expect(expected).toContain("België");
});

test("the warning is in the reader's language", () => {
  setHomeCountry("BE");
  document.cookie = "lavega_locale=en; Path=/";
  const html = render();
  /* Compared on the leading clause rather than the whole sentence: the tail
   * contains an apostrophe, which renderToStaticMarkup escapes to &#x27;. */
  expect(html).toContain("LaVega has no tax rules for Belgium yet.");
  expect(html).not.toContain("heeft nog geen belastingregels");
});

/* The choice on this screen beats the profile, and does NOT write the profile:
 * the home country also decides the travel agent's market and the border
 * module's regions, so reading German tax must not move a Dutch owner abroad. */
test("an explicit choice here overrides the profile without changing it", () => {
  setHomeCountry("NL");
  setTaxCountryOverride("DE");
  const html = render();
  expect(html).toContain(DE_TAX_PACK.profitTax.label);
  expect(localStorage.getItem("lavega.homeCountry")).toBe("NL");
});

test("clearing the choice falls back to the profile again", () => {
  setHomeCountry("NL");
  setTaxCountryOverride("DE");
  setTaxCountryOverride(null);
  const html = render();
  expect(html).not.toContain(DE_TAX_PACK.profitTax.label);
  expect(html).toContain(NL_TAX_PACK.vat.label);
});

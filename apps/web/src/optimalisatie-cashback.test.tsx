// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Account, Tx } from "@lavega/core";
import { makeFact, ownAccounts, TRAVEL_AGENT } from "@lavega/core";
import Optimalisatie from "./views/Optimalisatie";

/* The Cashback module — the third one, after Abonnementen and Rente.
 *
 * Two things it has to get right, and both are asserted on the cashback copy
 * itself rather than on a bare substring: the Rente module prints its own
 * percentages and its own euros per year, so a loose assertion would pass or
 * fail for reasons that have nothing to do with cashback. */

const acc = (over: Partial<Account>): Account =>
  ({ key: "k", iban: "", name: "Rekening", bank: "ING", entity: "BV1",
     currency: "EUR", balance: 1000, ...over });

const spend = (key: string, month: number): Tx =>
  ({ id: key + month, accountKey: key, date: `2025-${String(month).padStart(2, "0")}-15`,
     amount: -2500, currency: "EUR", counterparty: "Albert Heijn", description: "",
     category: "", manual: false });

const ACCOUNTS = [
  acc({ key: "ing", bank: "ING", balance: 20_000, interestRate: 1.5 }),
  acc({ key: "t212", bank: "Trading 212", balance: 0, interestRate: 3.5 }),
];

const render = (props: Partial<Parameters<typeof Optimalisatie>[0]> = {}) =>
  renderToStaticMarkup(
    <Optimalisatie
      txs={Array.from({ length: 12 }, (_, i) => spend("ing", i + 1))}
      accounts={ACCOUNTS}
      rules={[]}
      own={ownAccounts(ACCOUNTS)}
      asOf="2026-01-15"
      busy={false}
      facts={[
        makeFact({ agent: TRAVEL_AGENT, subject: "Trading 212 betaalpas", key: "cashbackPct",
                   value: "1.5", source: "agent", updatedAt: "2026-08-18" }),
        makeFact({ agent: TRAVEL_AGENT, subject: "ING betaalpas", key: "cashbackPct",
                   value: "0", source: "agent", updatedAt: "2026-08-18" }),
      ]}
      onRateCommit={() => {}}
      {...props}
    />,
  );

test("the cashback module names both cards, both rates and the euro figure", () => {
  const html = render();
  expect(html).toContain(">Cashback<");
  // The whole sentence, so it cannot pass because the Rente module happens to
  // print "Trading 212" or "1,5%" somewhere else on the screen.
  expect(html).toContain("Betaal met <strong>Trading 212</strong> in plaats van ING");
  expect(html).toContain("1,5% tegen 0%");
});

test("a payment account's figure says 'tot', because it is an upper bound", () => {
  // The bank export cannot tell a card payment from a direct debit, so the
  // number is the most it could be — and printing it bare would be a claim we
  // cannot support. €30.000 over 334 observed days annualises to €32.784,43;
  // 1,5% of that is €491,77, and it is at most that.
  expect(render()).toMatch(/<span class="text-pos">tot [^<]*491,77 per jaar<\/span>/);
});

test("a card with no cashback figure is a question, not a zero", () => {
  const html = render({ facts: [] });
  expect(html).toContain("Cashback onbekend voor");
  expect(html).toContain("ING betaalpas, Trading 212 betaalpas");
  // No rate, so no euro claim and no advice at all.
  expect(html).not.toContain("Betaal met");
  expect(html).not.toContain("per jaar</span>");
});

test("with no card in the vault it says there is nothing to compare, not that you already pay with the best one", () => {
  // "Je betaalt al met de kaart die het meeste teruggeeft" is advice that
  // cannot be true in a vault holding one savings account and no card.
  const html = render({
    accounts: [acc({ key: "abn", bank: "ABN AMRO", name: "Spaarrekening", balance: 50_000 })],
    txs: [],
    facts: [],
  });
  expect(html).toContain("Nog geen betaalrekening of creditcard");
  expect(html).not.toContain("Je betaalt al met de kaart");
});

test("knowing both cashback rates but not what he spends says exactly that", () => {
  // Two rates, no afschrift: there is no base to multiply, so there is no
  // euro figure — and the reason is the missing history, not a tie.
  const html = render({ txs: [] });
  expect(html).toContain("te weinig afschrift");
  expect(html).not.toContain("Je betaalt al met de kaart");
  expect(html).not.toContain("per jaar</span>");
});

test("the gap names a way to close it that actually exists", () => {
  // The reisblok has an "aanpassen" field for wisselkosten and omwisselkosten
  // and for NOTHING else — there is no cashback input anywhere in the app, and
  // even those two only appear once a bestemming has been chosen. Telling him
  // to "vul het zelf in bij het reisblok" is advice that cannot be followed in
  // the state it is printed in, and this is the module's DEFAULT state: a fresh
  // vault has no cashbackPct fact until the reisagent looks one up.
  const html = render({ facts: [] });
  expect(html).toContain("Cashback onbekend voor");
  expect(html).not.toContain("Vul het zelf in");
  // The path that does work: the travel agent writes cashbackPct, and it needs
  // a destination before it will run.
  expect(html).toContain("reisblok op Overzicht");
  expect(html).toContain("bestemming");
  expect(html).toContain("Zoek voorwaarden");
});

// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Account, CatalogueEntryLike, CatalogValue, Tx } from "@lavega/core";
import { makeFact, ownAccounts, TRAVEL_AGENT } from "@lavega/core";
import Optimalisatie from "./views/Optimalisatie";

/* The Cashback module, reshaped like the Rente one (app review 2, item 9).
 *
 * His words: "make it a little nicer, in the same way as we have the rent —
 * this could be cashback that you do not have, and then use average expenditure
 * per month ... and then what you would basically get back if you had used that
 * card. Give the user a bit more fuel."
 *
 * So the module now has the interest module's three beats: what you get now,
 * what the best card we can prove gives, and the difference in euros on a base
 * he recognises. THE BASE IS THE MONTHLY AVERAGE over the measured window, not
 * last month — see the comment on `monthlyBaseCents` in the view for why, and
 * the "vorige maand" line for the concrete number he asked about.
 *
 * Assertions are on the cashback copy itself rather than on bare substrings: the
 * Rente module prints its own percentages and its own euros per year, so a loose
 * assertion would pass or fail for reasons that have nothing to do with cashback.
 */

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

/** A stated market, so the euro figures below are arithmetic on numbers this
 *  file can show rather than on whatever the catalogue happened to hold today.
 *  The real catalogue is still the default, and one test below renders against
 *  it deliberately. */
const offer = (over: Partial<CatalogueEntryLike> & { pct: number; kind?: string; conditions?: string }): CatalogueEntryLike => ({
  id: over.id ?? "test-card",
  product: over.product ?? "Testkaart",
  issuer: over.issuer ?? "Testbank N.V.",
  kind: over.kind,
  fields: {
    cashbackPct: {
      value: over.pct,
      route: "provider-page",
      sourceUrl: "https://example.test/tarieven",
      checkedAt: "2026-08-01",
      conditions: over.conditions ?? null,
      conditionsKnown: true,
    },
  },
});

const MARKET: CatalogueEntryLike[] = [offer({ pct: 2, kind: "creditcard" })];

const render = (props: Partial<Parameters<typeof Optimalisatie>[0]> = {}) =>
  renderToStaticMarkup(
    <Optimalisatie
      txs={Array.from({ length: 12 }, (_, i) => spend("ing", i + 1))}
      accounts={ACCOUNTS}
      rules={[]}
      own={ownAccounts(ACCOUNTS)}
      asOf="2026-01-15"
      busy={false}
      entries={MARKET}
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

/* --- What was already right, and stays --------------------------------- */

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

test("the gap names a way to close it that actually exists", () => {
  // The reisblok has an "aanpassen" field for wisselkosten and omwisselkosten
  // and for NOTHING else — there is no cashback input anywhere in the app, and
  // even those two only appear once a bestemming has been chosen.
  const html = render({ facts: [] });
  expect(html).toContain("Cashback onbekend voor");
  expect(html).toContain("ING betaalpas, Trading 212 betaalpas");
  expect(html).not.toContain("Vul het zelf in");
  expect(html).toContain("reisblok op Overzicht");
  expect(html).toContain("bestemming");
  expect(html).toContain("Zoek voorwaarden");
});

/* --- The reshape: what you get now, what the best card gives, the difference */

test("the module shows what you get now, what the best card gives and the difference per month", () => {
  const html = render();
  // Beat 1: what his best own card WOULD return on this base. His best proven
  // rate is Trading 212 at 1,5% — and note the label is not "wat je nu
  // terugkrijgt", because his spending sits on the 0% pas: this is a comparison
  // of rates on one base, not a claim about money he already receives.
  expect(html).toContain("Op je beste eigen kaart");
  // Beat 2: the best card the catalogue can prove, at 2%.
  expect(html).toContain("Testbank");
  expect(html).toContain("Testkaart");
  // Beat 3: the difference, on a monthly base.
  //   €30.000 over 334 days annualises to €32.784,43 → €2.732,04 per month.
  //   (2 − 1,5)% of the year is €163,92 → €13,66 per month.
  expect(html).toContain("2.732,04");
  expect(html).toContain("13,66");
  expect(html).toContain("163,92");
  expect(html).toContain("per maand");
});

test("the base is the monthly average, and the screen says over how much afschrift it was measured", () => {
  const html = render();
  expect(html).toContain("gemiddeld per maand");
  expect(html).toContain("334 dagen afschrift");
});

test("last month is shown as a check on the average, never as the base for the claim", () => {
  // The concrete number he floated, as a reality check next to the average and
  // labelled with the month it belongs to, so a quiet month cannot be mistaken
  // for the norm. It is the last month the import COVERS IN FULL: these
  // statements stop on 15 December, so December is half a month and November is
  // the last honest one. Printing a half month as "last month" would understate
  // what he spends and look precise doing it.
  const html = render();
  expect(html).toContain("Vorige volle maand");
  expect(html).toContain("nov 2025");
  expect(html).not.toContain("dec 2025");
  expect(html).toContain("2.500,00");
});

/* --- Never a euro figure when either half is unknown -------------------- */

test("no euro figure when his own cashback is unknown, and it says which half is missing", () => {
  const html = render({ facts: [] });
  expect(html).toContain("de cashback van je eigen kaarten is onbekend");
  expect(html).not.toContain("Op je beste eigen kaart");
  // The euro row by its own testid, because the Rente module prints euros per
  // month too — a bare "per maand" would pass or fail for the wrong reason.
  expect(html).not.toContain('data-testid="cashback-verschil"');
});

test("no euro figure when the spend base cannot be measured, and it says which half is missing", () => {
  // Two rates, no afschrift: there is no base to multiply, so there is no euro
  // figure — and the reason is the missing history, not a tie.
  const html = render({ txs: [] });
  expect(html).toContain("te weinig afschrift");
  expect(html).toContain("60 dagen");
  expect(html).not.toContain("Je betaalt al met de kaart");
  expect(html).not.toContain('data-testid="cashback-verschil"');
});

test("a card that does not beat his own is said plainly, with no euro figure", () => {
  const html = render({ entries: [offer({ pct: 1, kind: "creditcard" })] });
  expect(html).toContain("even goed of beter");
  expect(html).not.toContain('data-testid="cashback-verschil"');
});

test("no proven cashback anywhere in the market is a stated absence, not an empty block", () => {
  const html = render({ entries: [] });
  expect(html).toContain("Geen enkele kaart in de catalogus");
  expect(html).not.toContain('data-testid="cashback-verschil"');
});

/* --- What the card IS, not only what it pays ----------------------------- */

test("a prepaid or crypto card is labelled as one, and its condition is printed", () => {
  const html = render({
    entries: [offer({ id: "cc", product: "Obsidian", issuer: "Crypto.com", kind: "prepaid", pct: 5,
                      conditions: "TIER GATE: staking van CRO vereist." })],
  });
  expect(html).toContain("prepaidkaart");
  // The conditions are printed IN FULL behind a disclosure: truncating them cut
  // off the tier gate, which is the only part that decides whether the euro
  // figure above is reachable at all.
  expect(html).toContain("TIER GATE");
  expect(html).toContain("lees ze voordat je hierop rekent");
  // And it says that this is the whole of what the catalogue can prove — every
  // covered cashback figure today belongs to a prepaid or crypto card.
  expect(html).toContain("Geen gewone bankkaart");
});

test("an ordinary bank card in the market does NOT trigger the prepaid caveat", () => {
  expect(render()).not.toContain("Geen gewone bankkaart");
});

test("the 212 Card is absent from the cashback ranking — proven 0% FX, no proven cashback", () => {
  // Item 8, and it comes back every review: he says 3,5%, which is the SAVINGS
  // rate of Trading 212's cash, not a cashback figure. The catalogue holds a
  // covered fxFeePct of 0% for the 212 Card and no cashbackPct field at all, so
  // it cannot be ranked here however often it is asked for. The honest fix is
  // data, not code — and this test fails the day someone invents the figure.
  const html = render({ entries: undefined }); // the real catalogue
  expect(html).not.toContain("212 Card");
});

/* ══════════════════ wat de kaart zelf kost, ook hier ════════════════════════
 *
 * De module rekende alleen aan de OPBRENGST: 2% tegen 1,5% op wat hij uitgeeft,
 * en dan een bedrag per jaar. Een kaart die € 5 per maand kost en € 3 oplevert is
 * achteruit, en dat stond er niet — de helft die je niet ziet is degene die je
 * pakt.
 *
 * Cashback is TERUGKEREND en een kaartprijs ook, dus hier is geen horizon nodig:
 * opbrengst en kosten staan al in dezelfde eenheid en gaan schoon van elkaar af.
 * Dat is het verschil met het reisblok, waar een eenmalige winst tegen een
 * doorlopende prijs staat en de periode er dus bij moet.
 *
 * De basis van alle bedragen hieronder: € 32.784,43 aan uitgaven per jaar, 2%
 * tegen 1,5% = € 163,92 bruto per jaar.
 */

/** Hetzelfde aanbod, nu met een PRIJS op de kaart. De periode staat er expliciet
 *  in; een bedrag zonder eenheid stilzwijgend maandelijks noemen scheelt een
 *  factor twaalf. `CatalogValue` kent die periode niet — de kostenlane leest het
 *  veld als `unknown` en valideert de eenheid zelf (`readPeriod`), en het echte
 *  artefact draagt hem er net zo in. Vandaar de cast en niet een opgerekt type. */
const withFee = (entry: CatalogueEntryLike, value: number, period: "maand" | "jaar"): CatalogueEntryLike => ({
  ...entry,
  fields: {
    ...entry.fields,
    accountFee: {
      value, period, route: "provider-pdf", sourceUrl: "https://example.test/kosten",
      checkedAt: "2026-08-01", conditions: null, conditionsKnown: true,
    } as unknown as CatalogValue,
  },
});

/** Eén regel uit de gerenderde HTML, op zijn testid. Faalt hard als de regel er
 *  niet is, zodat een verdwenen regel de test breekt in plaats van een assertie
 *  stil te laten slagen op tekst die elders op het scherm staat. */
const row = (html: string, testid: string): string => {
  const m = html.match(new RegExp(`data-testid="${testid}"[\\s\\S]*?</(?:div|p)>`));
  if (!m) throw new Error(`geen regel met data-testid="${testid}"`);
  return m[0];
};

const CARD = offer({ pct: 2, kind: "creditcard" });

test("het brutoverschil heet bruto, zodra er kaartkosten naast kunnen staan", () => {
  expect(render()).toContain("vóór kaartkosten");
});

test("een bekende maandprijs wordt verrekend, met de jaarprijs erbij en het nettobedrag eronder", () => {
  const html = render({ entries: [withFee(CARD, 5, "maand")] });
  // De prijs in de eenheid van de bron, en het jaarbedrag als ONZE rekensom
  // gemarkeerd — zoals de kostentabel van deze view het ook doet.
  expect(row(html, "cashback-kosten")).toContain("5,00 per maand");
  expect(row(html, "cashback-kosten")).toContain("12 × ");
  expect(row(html, "cashback-kosten")).toContain("60,00 per jaar");
  // € 163,92 bruto min € 60,00 = € 103,92 per jaar, € 8,66 per maand.
  const netto = row(html, "cashback-netto");
  expect(netto).toContain("103,92");
  expect(netto).toContain("8,66");
  // En het brutobedrag blijft staan, zodat de aftrek te volgen is.
  expect(html).toContain("163,92");
});

test("een jaarprijs blijft een jaarprijs — er wordt niet met twaalf vermenigvuldigd", () => {
  const html = render({ entries: [withFee(CARD, 120, "jaar")] });
  const kosten = row(html, "cashback-kosten");
  expect(kosten).toContain("120,00 per jaar");
  // Geen "12 ×": dit bedrag staat zo in het document.
  expect(kosten).not.toContain("12 × ");
  // 12 × € 120,00 = € 1.440,00 — het bedrag dat eruit komt als de eenheid wordt
  // genegeerd, en dat hier nergens mag staan.
  expect(html).not.toContain("1.440,00");
  expect(row(html, "cashback-netto")).toContain("43,92");
});

test("een kaart die meer kost dan hij oplevert is GEEN aanbeveling, en het scherm zegt met hoeveel", () => {
  const html = render({ entries: [withFee(CARD, 16.9, "maand")] });
  const geen = row(html, "cashback-geen");
  expect(geen).toContain("Geen aanbeveling");
  expect(geen).toContain("163,92"); // bruto
  expect(geen).toContain("202,80"); // 12 × € 16,90 kaartkosten
  expect(geen).toContain("38,88"); // wat je erop achteruit gaat
  expect(geen).toContain("achteruit");
  // Er is geen netto om te tonen, dus er staat ook geen nettoregel.
  expect(html).not.toContain('data-testid="cashback-netto"');
});

test("een onbekende kaartprijs is geen nul, en het woord netto valt daar niet", () => {
  // De echte catalogus is dit geval: van geen enkele kaart met een aantoonbare
  // cashback noemt een bron een maand- of jaarprijs (augustus 2026).
  const html = render();
  const kosten = row(html, "cashback-kosten");
  expect(kosten).toContain("Wat deze kaart zelf kost, weten we niet");
  expect(kosten).toContain("geen nul");
  expect(html).not.toContain('data-testid="cashback-netto"');
  // Het brutobedrag blijft wel staan: de kaart wordt niet verzwegen.
  expect(html).toContain("163,92");
});

test("een uitgesproken nul is een BEKENDE nul, en dan is bruto ook netto", () => {
  // De keerzijde van "onbekend is geen nul": zegt de bron letterlijk € 0,00, dan
  // is dat een gemeten feit en scheelt het hem de vraag of we het niet weten.
  const html = render({ entries: [withFee(CARD, 0, "maand")] });
  expect(row(html, "cashback-kosten")).toContain("0,00 per maand");
  expect(row(html, "cashback-netto")).toContain("163,92");
  expect(html).not.toContain("weten we niet");
});

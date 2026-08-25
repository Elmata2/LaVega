// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Account, CatalogueEntryLike, CatalogValue, RateBenchmark, Rule, Tx } from "@lavega/core";
import { ownAccounts } from "@lavega/core";
import Optimalisatie from "./views/Optimalisatie";

/* Optimalisatie after the rebalance (UI review, 2026-08-16):
 *   - the interest reasoning is spelled out and ends in a number;
 *   - the two halves are one grid of equal columns, subscriptions first;
 *   - a thin subscriptions half explains what LaVega measured instead of
 *     seeding invented rows.
 */

const ACCOUNTS: Account[] = [
  { key: "ABN1", iban: "NL01ABNA", name: "Spaarrekening", bank: "ABN AMRO", entity: "Prive", currency: "EUR", balance: 50_000 },
];

function tx(id: string, date: string, amount: number, counterparty: string): Tx {
  return { id, accountKey: "ABN1", date, amount, currency: "EUR", counterparty, description: "", category: "", manual: false };
}

const RULES: Rule[] = [];

function render(
  txs: Tx[],
  accounts: Account[] = ACCOUNTS,
  extra: Partial<Parameters<typeof Optimalisatie>[0]> = {},
) {
  return renderToStaticMarkup(
    <Optimalisatie
      txs={txs}
      accounts={accounts}
      rules={RULES}
      own={ownAccounts(accounts)}
      asOf="2026-08-16"
      busy={false}
      facts={[]}
      onRateCommit={() => {}}
      {...extra}
    />,
  );
}

test("the two halves sit in one grid of equal columns, subscriptions first", () => {
  const html = render([]);
  expect(html).toContain("module-grid grid-2");
  expect(html.indexOf("Abonnementen")).toBeLessThan(html.indexOf(">Rente<"));
});

test("the interest advice is spelled out and ends in a euro figure per year", () => {
  const html = render([]);
  // ABN AMRO's own standard rate is 1,25%. The comparison is now against what the
  // winning account KEEPS rather than its headline: Bigbank's 3,1% is a six-month
  // actierente that drops to 2,1%, so the best kept rate is Scalable Capital at
  // 2,5%. € 50.000 × 1,25% = € 625 per year — less flattering than the € 925 this
  // test used to assert, and the figure the saver will actually see in month seven.
  expect(html).toContain("Je houdt");
  expect(html).toContain("ABN AMRO");
  expect(html).toContain("1,25%");
  expect(html).toContain("Scalable Capital");
  expect(html).toContain("2,5%");
  expect(html).toContain("625,00");
  expect(html).toContain("per jaar");
});

test("an account with no saldo yields no figure at all — not a zero", () => {
  const html = render([], [{ ...ACCOUNTS[0], balance: null }]);
  expect(html).toContain("Nog geen rentewinst berekend");
  expect(html).toContain("1 rekening zonder saldo");
  expect(html).toContain("onbekend"); // the saldo cell, not "€ 0,00"
  expect(html).not.toContain("Je houdt");
});

test("the thin subscriptions half reports what was actually measured, and seeds nothing", () => {
  // Two outflows to the same shop, but no cadence — so no subscription.
  const html = render([
    tx("a", "2026-07-02", -12.5, "Albert Heijn"),
    tx("b", "2026-07-19", -31.4, "Albert Heijn"),
    tx("c", "2026-08-04", -9.99, "Kiosk"),
  ]);

  expect(html).toContain("Nog geen abonnement herkend");
  expect(html).toContain("Dat is een meting, geen leeg scherm");
  expect(html).toContain("<strong>3</strong> uitgaande transacties");
  expect(html).toContain("2026-07-02 en 2026-08-04");
  expect(html).toContain("<strong>2</strong> ontvangers");
  expect(html).toContain("<strong>1</strong> minstens twee keer");
  // The pattern it looks for is stated, so the empty result is judgeable.
  expect(html).toContain("een vast ritme");

  // The worked example is behind a disclosure and labelled as an example.
  expect(html).toContain("Voorbeeld — niet jouw data, en nergens opgeslagen");
  expect(html).toContain("<details");
});

/* HIER STONDEN DE KOLOMMEN "Per maand" EN "Per jaar" NAAST ELKAAR, en de tweede
 * was de eerste × 12. Voor dít abonnement klopte dat — Netflix wordt maandelijks
 * afgeschreven — maar voor een jaarabonnement niet, want dan is "per maand" zelf
 * al een deling. Sinds de periodeschakelaar toont de tabel één eenheid, de eenheid
 * die hij kiest, en ernaast wat er werkelijk is afgeschreven. Het omschakelen zelf
 * heeft een echte DOM nodig en staat in optimalisatie-periode.test.tsx. */
test("a detected subscription is priced in the chosen unit, next to what was actually charged", () => {
  const html = render([
    tx("n1", "2026-05-08", -15.99, "Netflix"),
    tx("n2", "2026-06-08", -15.99, "Netflix"),
    tx("n3", "2026-07-08", -17.99, "Netflix"),
    tx("n4", "2026-08-08", -17.99, "Netflix"),
  ]);
  expect(html).toContain("Netflix");
  expect(html).not.toContain("Nog geen abonnement herkend");
  // De schakelaar opent op "Per maand" — de stand waarin dit scherm altijd stond.
  expect(html).toContain('aria-label="Eenheid van de abonnementsbedragen"');
  expect(html).toContain('<option value="maand" selected="">Per maand</option>');
  expect(html).toContain("17,99");
  // En de eenheid van de AFSCHRIJVING staat er in elke stand naast, met het ritme
  // erbij: die mag niet achter de schakelaar verdwijnen.
  expect(html).toContain("Op je afschrift");
  expect(html).toContain("maandelijks");
  // Een maandbedrag is niet omgerekend, dus er staat geen rekensom onder en geen
  // regel die er een belooft.
  expect(html).not.toContain("omgerekend uit een ander ritme");
  // De prijsstijging in dezelfde eenheid: € 2,00 per maand, niet × 12.
  expect(html).toContain("per maand extra");
  expect(html).toContain("2,00");
  // No example rows leak into a filled block.
  expect(html).not.toContain("Voorbeeld — niet jouw data");
});

/* --- What the core lane exposes, consumed here (never re-derived) --------- */

test("a short import says WHICH rhythms it cannot yet see — the answer to the missing Simeo", () => {
  // Two months of statements. A quarterly charge needs one full gap before
  // there is anything to recognise, so it cannot appear — and the screen has to
  // say that rather than let an empty list read as "you have none".
  const html = render([
    tx("a1", "2026-06-14", -12.5, "Albert Heijn"),
    tx("a2", "2026-07-14", -12.5, "Albert Heijn"),
  ]);
  expect(html).toContain("per kwartaal");
  expect(html).toContain("jaarlijks");
  expect(html).toContain("niet omdat het er niet is");
});

test("a year of history moves the quarterly window from 'cannot see' to 'can see'", () => {
  const txs: Tx[] = [];
  for (let m = 0; m < 12; m++) {
    const month = String(m + 1).padStart(2, "0");
    txs.push(tx(`q${m}`, `2026-${month}-06`, -9.99, "Spotify"));
  }
  const html = render(txs);
  expect(html).toContain("335</strong> dagen afschrift");
  // Quarterly is now within reach; only the yearly rhythm still needs more.
  expect(html).toContain("per kwartaal, halfjaarlijks</strong> herkenbaar");
  expect(html).toContain("Nog niet: jaarlijks (vanaf 365 dagen)");
});

/* --- App review 2, 20 Aug: remove what earns nothing --------------------- *
 *
 * Three removals, all his call and all "this earns nothing here" rather than
 * "this is wrong". The housing figure was READ from the transactions and was
 * correct; it just does not belong on the screen about subscriptions and
 * interest. The tests that pinned it are gone with it — see the report.
 */

test("woonlasten is gone from Optimalisatie, detected or not", () => {
  const withRent: Tx[] = [];
  for (let m = 1; m <= 6; m++) {
    withRent.push(tx(`h${m}`, `2026-${String(m).padStart(2, "0")}-01`, -1450, "Woningstichting Rochdale"));
  }
  for (const html of [render(withRent), render([tx("x1", "2026-08-01", -12.5, "Albert Heijn")])]) {
    expect(html).not.toContain("Woonlasten");
    expect(html).not.toContain("Woningstichting Rochdale");
    expect(html).not.toContain("niet in de data gezien");
    expect(html).not.toContain("Zelf invullen");
  }
});

test("the prijsstijging and dubbele-functie tiles are absent when there is nothing to report", () => {
  // "Don't render an empty one." A tile reading 0 is a module telling you it has
  // nothing to say, and it costs a row of the screen to say it.
  const html = render([
    tx("n1", "2026-05-08", -15.99, "Netflix"),
    tx("n2", "2026-06-08", -15.99, "Netflix"),
    tx("n3", "2026-07-08", -15.99, "Netflix"),
  ]);
  expect(html).toContain("Netflix"); // there IS a subscription, so we looked
  expect(html).not.toContain("Prijsstijgingen");
  expect(html).not.toContain("Dubbele functies");
  // The check still ran, and one clause says so — an absent tile must not read
  // as an absent check.
  expect(html).toContain("Geen prijsstijging en geen dubbele dienst gezien");
});

test("the prijsstijging tile comes back the moment there is a rise to report", () => {
  const html = render([
    tx("n1", "2026-05-08", -15.99, "Netflix"),
    tx("n2", "2026-06-08", -15.99, "Netflix"),
    tx("n3", "2026-07-08", -17.99, "Netflix"),
    tx("n4", "2026-08-08", -17.99, "Netflix"),
  ]);
  expect(html).toContain("Prijsstijgingen");
  expect(html).not.toContain("Dubbele functies");
  expect(html).not.toContain("Geen prijsstijging en geen dubbele dienst gezien");
});

/* --- App review, 20 Aug: items 1 and 9 on screen ------------------------- *
 *
 * These render against the BUNDLED table (the catalogue merge arrives in an
 * effect, which static rendering does not run), so the numbers below are that
 * table's: best kept rate Scalable Capital 2,50%, best headline today Bigbank
 * 3,10% falling to 2,10%, and ING's Oranje Spaarrekening at 1,25%.
 */

test("the promo is shown next to what you keep, priced per month, never added to the year", () => {
  // His objection to yesterday's change: "for a user who doesn't have bunq, if
  // they can use the promo for a month it's still a month of 3,01% over the 2,5%
  // of Scalable Capital." So both numbers appear, each labelled with its period.
  const html = render([]);
  // Ranked on what he keeps — unchanged.
  expect(html).toContain("Scalable Capital");
  expect(html).toContain("625,00"); // € 50.000 × (2,50 − 1,25)% per jaar
  // And what he could get today, with what it turns into afterwards.
  expect(html).toContain("Bigbank");
  expect(html).toContain("3,1%");
  expect(html).toContain("Actierente 6 mnd, daarna 2,10%");
  // € 50.000 × (3,10 − 2,50)% ÷ 12 = € 25,00 for each month the action runs.
  expect(html).toContain("25,00");
  expect(html).toContain("per maand extra");
});

test("an ING account is never left at a bare 'aangenomen 0%' — the row says what ING pays", () => {
  // Item 1, his words: "That ING is 0% that's bullshit, we need to have those."
  // The account arrives from the CSV with its IBAN as the name, so nothing in it
  // says "savings" and the type heuristic reads it as a payment account. 0% may
  // be right for one of his two ING accounts, but the screen has to name the rate
  // ING does pay and ask which account this is instead of asserting a
  // measurement it never made.
  const html = render([], [
    { key: "ING1", iban: "NL88INGB0793113504", name: "NL88INGB0793113504", bank: "ING", entity: "Prive", currency: "EUR", balance: 20_000 },
  ]);
  expect(html).toContain("aangenomen 0%");
  expect(html).toContain("Oranje Spaarrekening");
  expect(html).toContain("1,25%");
  expect(html).toContain("Is dit die rekening?");
});

test("a savings account at ING is estimated from ING's own tariff, and the row names it", () => {
  const html = render([], [
    { key: "ING2", iban: "NL95INGB0674843703", name: "NL95INGB0674843703", bank: "ING", entity: "Prive", currency: "EUR", balance: 20_000, type: "Spaarrekening" },
  ]);
  expect(html).toContain("geschat via banktarief");
  expect(html).toContain("ING Oranje Spaarrekening");
  expect(html).toContain("1,25%");
  // The gain is measured against what he KEEPS at the winner (2,50%), not the
  // 3,10% headline: € 20.000 × 1,25% = € 250,00.
  expect(html).toContain("250,00");
  expect(html).not.toContain("370,00"); // what the 3,10% teaser would have promised
});

test("the comparison table separates what you get now from what you keep", () => {
  const html = render([]);
  expect(html).toContain("Wat je houdt");
  expect(html).toContain("Rente nu");
});


/* ══════ WAT DE REKENING WAAR HET ADVIES HEEN WIJST ZELF KOST ════════════════
 *
 * Zijn zin, 21 augustus: "als een kaart 5 euro per maand kost en ons 3 oplevert
 * gaan we er op achteruit." Dat geldt net zo hard voor een spaarrekening. De
 * rentemodule rekende alleen aan de OPBRENGST — een hoger percentage, dus zoveel
 * euro per jaar — en zei nergens wat die nieuwe rekening kost.
 *
 * DE RENTES WORDEN HIER GESTELD, en dat moet ook: alleen catalogusrentes dragen
 * een `productId` en kunnen dus aan een prijs gekoppeld worden, en die komen in
 * de app pas binnen via een effect dat een statische render niet draait. Zonder
 * `initialRates` zou dit blok testen tegen de ingebakken tabel, waar geen enkele
 * rij een prijs heeft.
 *
 * VANDAAG IS DAT OOK DE LIVE-TOESTAND, en dat hoort in het rapport: van de 32
 * spaarrijen in docs/catalog/catalog.json prijst er geen enkele zichzelf, dus op
 * het echte scherm staat "kosten onbekend". Dat is de eerlijke uitkomst en geen
 * bug — de machinerie licht op zodra de catalogus een spaarproduct prijst.
 */

/** Eén regel uit de gerenderde HTML, op zijn testid. Faalt hard als de regel er
 *  niet is, zodat een verdwenen regel de test breekt in plaats van een assertie
 *  stil te laten slagen op tekst die elders op het scherm staat. */
const row = (html: string, testid: string): string => {
  const m = html.match(new RegExp(`data-testid="${testid}"[\\s\\S]*?</(?:div|p)>`));
  if (!m) throw new Error(`geen regel met data-testid="${testid}"`);
  return m[0];
};

/** € 1.000 op een betaalrekening van 0%. Klein met opzet: tegen 2,5% is dat
 *  € 25,00 per jaar, en dan eet een pakket van € 4,50 per maand (€ 54,00 per
 *  jaar) de winst op. Zo hangt de uitkomst aan de KOSTEN en niet aan het saldo. */
const IDLE: Account[] = [
  { key: "B1", iban: "NL01INGB", name: "Betaalrekening", bank: "ING", entity: "Prive", currency: "EUR", balance: 1000, type: "Betaalrekening" },
];

const TESTBANK: RateBenchmark = {
  bank: "Testbank", product: "Spaarrekening", ratePct: 2.5, freeWithdrawal: true, productId: "test-spaar",
};

/** De catalogusrij achter die rente, met of zonder prijs. De periode staat er
 *  expliciet in: een bedrag zonder eenheid stilzwijgend maandelijks noemen scheelt
 *  een factor twaalf, en dat is precies wat hieronder getoetst wordt. */
const spaar = (fee?: { value: number; period: "maand" | "jaar" }): CatalogueEntryLike[] => [
  {
    id: "test-spaar", product: "Testbank Spaarrekening", issuer: "Testbank N.V.", kind: "betaalrekening",
    fields: fee
      ? {
          accountFee: {
            value: fee.value, period: fee.period, route: "provider-pdf",
            sourceUrl: "https://example.test/kosten", checkedAt: "2026-08-01",
            conditions: null, conditionsKnown: true,
          } as unknown as CatalogValue,
        }
      : {},
  },
];

test("een renteadvies dat door de rekeningkosten netto negatief wordt is GEEN aanbeveling", () => {
  const html = render([], IDLE, { initialRates: [TESTBANK], entries: spaar({ value: 4.5, period: "maand" }) });
  // Het brutobedrag blijft staan — de kaart wordt niet verzwegen — maar het heet
  // nu ook bruto.
  expect(html).toContain("<strong>€\u00a025,00</strong> per jaar op, vóór wat die rekening zelf kost");
  // 12 × € 4,50 = € 54,00 per jaar, dus € 29,00 achteruit. Hij moet dat kunnen
  // ZIEN staan in plaats van het zelf uit te rekenen.
  expect(row(html, "rente-kosten")).toContain("4,50 per maand");
  expect(row(html, "rente-kosten")).toContain("54,00 per jaar");
  const geen = row(html, "rente-geen");
  expect(geen).toContain("Geen aanbeveling");
  expect(geen).toContain("29,00");
  expect(geen).toContain("achteruit");
  // Er is geen netto om te tonen, dus er staat ook geen nettoregel.
  expect(html).not.toContain('data-testid="rente-netto"');
});

test("jaar tegen maand: hetzelfde getal, een ander advies", () => {
  // € 4,50 per maand eet € 25 rente op; € 4,50 per jaar laat € 20,50 staan. Geven
  // deze twee ooit hetzelfde antwoord, dan wordt er ergens een eenheid genegeerd.
  const perJaar = render([], IDLE, { initialRates: [TESTBANK], entries: spaar({ value: 4.5, period: "jaar" }) });
  expect(row(perJaar, "rente-kosten")).toContain("4,50 per jaar");
  // Geen "12 ×": dit bedrag staat zo in het document.
  expect(row(perJaar, "rente-kosten")).not.toContain("12 × ");
  expect(row(perJaar, "rente-netto")).toContain("20,50");
  expect(perJaar).not.toContain("54,00");
  expect(perJaar).not.toContain('data-testid="rente-geen"');
});

test("onbekende rekeningkosten zijn geen nul, en het woord netto valt daar niet", () => {
  const html = render([], IDLE, { initialRates: [TESTBANK], entries: spaar() });
  const kosten = row(html, "rente-kosten");
  expect(kosten).toContain("Wat deze rekening zelf kost, weten we niet");
  expect(kosten).toContain("geen nul");
  // Het woord "netto" komt in deze tak NIET voor: er ís geen netto zolang de ene
  // helft ontbreekt. Op de regel zelf getoetst, want de Cashback-module verderop
  // op dit scherm mag het woord wél gebruiken.
  expect(kosten.toLowerCase()).not.toContain("netto");
  expect(html).not.toContain('data-testid="rente-netto"');
  // ...en het brutobedrag blijft staan, dus de aanbeveling verdwijnt niet.
  expect(html).toContain("<strong>€\u00a025,00</strong> per jaar op");
});

test("een uitgesproken nul is een BEKENDE nul, en dan is bruto ook netto", () => {
  // De keerzijde van "onbekend is geen nul". Openbank zegt letterlijk dat openen,
  // aanhouden en opzeggen gratis is; dat is een gemeten feit.
  const html = render([], IDLE, { initialRates: [TESTBANK], entries: spaar({ value: 0, period: "maand" }) });
  expect(row(html, "rente-kosten")).toContain("0,00 per maand");
  expect(row(html, "rente-netto")).toContain("25,00");
  expect(html).not.toContain("weten we niet");
});

test("zonder rentewinst komt er geen leeg kostenblok", () => {
  // "Render geen leeg blok." Is er niets te verplaatsen, dan is er ook niets te
  // verrekenen — en dan hoort er geen zin over rekeningkosten te staan.
  const html = render([], [{ ...IDLE[0], balance: 0 }], { initialRates: [TESTBANK], entries: spaar({ value: 4.5, period: "maand" }) });
  expect(html).toContain("Nog geen rentewinst berekend");
  expect(html).not.toContain('data-testid="rente-kosten"');
  expect(html).not.toContain("vóór rekeningkosten");
});

/* ══════ DE GRATIS REKENING, MET DE EIS ERBIJ ════════════════════════════════
 *
 * App review 4, punt 24: "ING is bij hem een studentenrekening — hij betaalt
 * niets. Dat moet vindbaar zijn."
 *
 * Vindbaar betekent niet "staat in de lijst van twaalf ING-tarieven achter een
 * dichtgeklapt driehoekje". Het betekent dat je het ziet zonder te zoeken. En
 * nooit zonder de eis: elke studentenrekening in dit land staat op € 0,00 in het
 * wettelijk verplichte kostendocument, mét een leeftijds- of studievoorwaarde.
 * Een gratis-melding zonder die zin klopt over twee jaar niet meer en heeft hem
 * dat nooit verteld.
 *
 * Deze twee tests draaien op de ECHTE catalogus (de standaardwaarde van
 * `entries`), want de vraag is niet of de component een lijst kan renderen maar
 * of ING Student er met zijn voorwaarde in staat.
 */

/** Zijn eigen geval: een ING-betaalrekening waarvan de naam niet zegt wélk
 *  pakket het is. Dan zijn de kosten onbekend — en juist dán moet de gratis
 *  optie in beeld komen. */
const ING_NAAMLOOS: Account[] = [
  { key: "B1", iban: "NL01INGB", name: "Betaalrekening", bank: "ING", entity: "Prive", currency: "EUR", balance: 1000, type: "Betaalrekening" },
];

test("een onherkende ING-rekening ziet de gratis pakketten staan, elk met zijn eis", () => {
  const html = render([], ING_NAAMLOOS);
  const gratis = row(html, "gratis-bij-B1");
  expect(gratis).toContain("Gratis bij ING");
  expect(gratis).toContain("ING Student");
  expect(gratis).toContain("€ 0,00 per maand");
  // De eis staat op dezelfde regel als de nul. Dit is de assertie die de hele
  // punt 24 draagt: zonder haar is dit een gratis-melding die over twee jaar
  // niet meer klopt.
  expect(gratis).toContain("18 tot 30 jaar");
  /* DE BRON MOET ER ZIJN, MAAR ACHTER DE PLOOI — zijn keuze van 22 augustus, en
   * het paar is precies dit: de EIS staat vooraan (hierboven getoetst) en de
   * HERKOMST een klik verderop. Een nul zonder herkomst blijft de valse nul waar
   * dit project al een keer op struikelde, dus hij moet vindbaar blijven; een
   * gratis-melding zonder de leeftijdseis is advies dat niet hoeft te werken,
   * dus die mag niet opvouwen.
   *
   * Niet getoetst via row(): die helper snijdt op de eerste </div> en mijn
   * uitklap zit een niveau dieper. Zoeken in de <details>-blokken zelf zegt bovendien
   * meer — het bewijst dat de bron OPGEVOUWEN is en niet alleen dat hij bestaat. */
  const panelen = [...html.matchAll(/<details[^>]*>([\s\S]*?)<\/details>/g)].map((m) => m[1]);
  expect(panelen.some((d) => d.includes("assets.ing.com"))).toBe(true);
  expect(panelen.some((d) => d.includes("18 tot 30 jaar"))).toBe(false);
  // De peildatum reist mee met de bron, dus ook die zit nu in het paneel.
  expect(panelen.some((d) => d.includes("peildatum"))).toBe(true);
  // De weg naar het juiste bedrag staat erbij, en het is een weg die bestaat:
  // Rekeningen heeft dat naamveld.
  expect(gratis).toContain("Rekeningen");
});

test("heet de rekening ING Student, dan staat de eis náást de nul en niet erachter", () => {
  // Nu is het bedrag wél gematcht: € 0,00 per maand. De voorwaarde zat toen in
  // een dichtgeklapte <details>, en dat is bij een NUL misleidend — bij een
  // bedrag dat geld kost is de prijs het nieuws en mag de voorwaarde opgevouwen
  // blijven.
  const html = render([], [{ ...ING_NAAMLOOS[0], name: "ING Student" }]);
  const eis = row(html, "kosten-gratis-B1");
  expect(eis).toContain("Gratis, mits");
  expect(eis).toContain("18 tot 30 jaar");
  // Geen tweede lijst met gratis pakketten: de kosten zijn bekend, dus er valt
  // niets meer te kiezen.
  expect(html).not.toContain('data-testid="gratis-bij-B1"');
});

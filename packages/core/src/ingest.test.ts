import { expect, test } from "vitest";
import { ingest, consolidate } from "./ingest.js";
import { assignTxIds } from "./hash.js";
import { detectSubscriptions } from "./subscriptions.js";

const mk = (o: Partial<any>) => ({
  accountKey: "A",
  date: "2026-01-02",
  amount: -10,
  currency: "EUR",
  counterparty: "S",
  description: "d",
  category: "",
  manual: false,
  ...o,
});

test("ingest dedupes overlapping imports by id", () => {
  const first = assignTxIds([mk({}), mk({ amount: -20 })]);
  const merged = ingest(first, [mk({}), mk({ amount: -30 })]);
  expect(merged).toHaveLength(3);
});

test("consolidate sums in/out per entity", () => {
  const txs = assignTxIds([mk({ amount: -10 }), mk({ amount: 40 })]);
  const accounts = [
    {
      key: "A",
      iban: "A",
      name: "",
      bank: "",
      entity: "BV1",
      currency: "EUR",
      balance: 100,
    },
  ];
  const c = consolidate(accounts, txs);
  expect(c.byEntity["BV1"]).toMatchObject({ in: 40, out: -10, balance: 100 });
});

test("consolidate: account with null balance makes entity balance null (unknown), and totalBalance null", () => {
  const txs = assignTxIds([mk({ amount: -10 }), mk({ amount: 40 })]);
  const accounts = [
    {
      key: "A",
      iban: "A",
      name: "",
      bank: "",
      entity: "BV1",
      currency: "EUR",
      balance: null,
    },
  ];
  const c = consolidate(accounts, txs);
  expect(c.byEntity["BV1"].balance).toBeNull();
  expect(c.totalBalance).toBeNull();
});

test("consolidate: one known + one null balance in same entity means unknown wins", () => {
  const accounts = [
    {
      key: "A",
      iban: "A",
      name: "",
      bank: "",
      entity: "BV1",
      currency: "EUR",
      balance: 50,
    },
    {
      key: "B",
      iban: "B",
      name: "",
      bank: "",
      entity: "BV1",
      currency: "EUR",
      balance: null,
    },
  ];
  const c = consolidate(accounts, []);
  expect(c.byEntity["BV1"].balance).toBeNull();
});

test("consolidate: no entities/balances (pristine app, no accounts) -> totalBalance is null, not 0", () => {
  const c = consolidate([], []);
  expect(c.totalBalance).toBeNull();
});

/* ── Eén betaling, twee bronnen (review 4, antwoord op vraag 1) ─────────────
 *
 * De CSV-import en de Enable Banking-koppeling van dezelfde ING-rekening
 * leveren dezelfde incasso allebei aan, met een andere schrijfwijze van de
 * tegenpartij. De transactie-id is een hash die de schrijfwijze meerekent, dus
 * de rij landde twee keer. Gemeten op vier maandincasso's van € 11,89: 8 rijen
 * in plaats van 4, € 95,12 uitgaven in plaats van € 47,56, en gaten van
 * [0, 29, 0, 30, 0, 32, 0] waardoor Optimalisatie zijn Simyo niet meer zag.
 *
 * De gevaarlijke kant staat in de tests eronder: twee ECHTE betalingen van
 * hetzelfde bedrag, op dezelfde dag, aan dezelfde partij moeten allebei blijven
 * staan. Dat is de reden dat er alleen ontdubbeld wordt tegen wat er AL LAG, en
 * nooit binnen één zending. */

const bron = (cp: string, date: string, amount: number, description: string, accountKey = "ING") =>
  ({ accountKey, date, amount, currency: "EUR", counterparty: cp, description, category: "", manual: false });

const DATA = ["2026-05-04", "2026-06-02", "2026-07-02", "2026-08-03"];
const uitCsv = DATA.map((d) => bron("SIMYO", d, -11.89, `Incasso ${d}`));
const uitBank = DATA.map((d) => bron("Simyo B.V.", d, -11.89, "SEPA Incasso algemeen doorlopend"));

test("dezelfde incasso uit CSV en bankkoppeling wordt één rij — en Simyo komt terug", () => {
  const naCsv = ingest([], uitCsv);
  const naBank = ingest(naCsv, uitBank);
  expect(naCsv).toHaveLength(4);
  expect(naBank).toHaveLength(4); // was 8

  // De uitgaven waren dubbel; dat is de bredere schade, niet alleen het gemiste abonnement.
  const rekening = { key: "ING", iban: "NL17INGB0539576085", name: "", bank: "ING", entity: "Prive", currency: "EUR", balance: 0 };
  expect(consolidate([rekening], naCsv).byEntity["Prive"].out).toBeCloseTo(-47.56, 2);
  expect(consolidate([rekening], naBank).byEntity["Prive"].out).toBeCloseTo(-47.56, 2); // was -95,12

  // En het abonnement, dat op de gaten [0, 29, 0, 30, 0, 32, 0] stukliep.
  const [sub] = detectSubscriptions(naBank, { asOf: "2026-08-16" });
  expect(sub).toMatchObject({ cadenceDays: 30, monthlyCents: 1189, occurrences: 4 });
});

test("de volgorde maakt niet uit: eerst koppelen, dan importeren geeft hetzelfde", () => {
  expect(ingest(ingest([], uitBank), uitCsv)).toHaveLength(4);
});

test("twee ECHTE betalingen op dezelfde dag aan dezelfde partij blijven twee rijen", () => {
  // Twee keer tanken, zelfde pomp, zelfde bedrag, zelfde dag. Ze komen samen in
  // één import binnen, en binnen één zending wordt nooit ontdubbeld.
  const tanken = [
    bron("Shell Nederland", "2026-06-10", -70, "Tankstation A4"),
    bron("Shell Nederland", "2026-06-10", -70, "Tankstation A4"),
  ];
  const opgeslagen = ingest([], tanken);
  expect(opgeslagen).toHaveLength(2);

  // Her-import van hetzelfde afschrift verandert daar niets aan (id's matchen).
  expect(ingest(opgeslagen, tanken)).toHaveLength(2);

  // En als de bankkoppeling diezelfde twee later nóg eens levert, anders
  // gespeld, blijven het er twee — niet vier, en ook niet één.
  const viaBank = tanken.map((t) => ({ ...t, counterparty: "SHELL NEDERLAND VERKOOP", description: "Betaalautomaat" }));
  expect(ingest(opgeslagen, viaBank)).toHaveLength(2);
});

test("één opgeslagen rij slokt precies één rij op: de derde tankbeurt komt er gewoon bij", () => {
  const opgeslagen = ingest([], [
    bron("Shell Nederland", "2026-06-10", -70, "Tankstation A4"),
    bron("Shell Nederland", "2026-06-10", -70, "Tankstation A4"),
  ]);
  // De bank levert de dag opnieuw, nu met een derde tankbeurt erbij, allemaal
  // anders gespeld. Twee worden opgeslokt, de derde is nieuw en blijft.
  const drie = ["a", "b", "c"].map(() => bron("SHELL NEDERLAND VERKOOP", "2026-06-10", -70, "Betaalautomaat"));
  expect(ingest(opgeslagen, drie)).toHaveLength(3);
});

test("een andere winkel met hetzelfde bedrag op dezelfde dag wordt niet opgeslokt", () => {
  // Zonder de tegenpartij-controle zou (rekening, datum, bedrag) hier een echte
  // betaling wissen: het toeval van € 11,89 op dezelfde dag is genoeg.
  const opgeslagen = ingest([], [bron("SIMYO", "2026-08-03", -11.89, "Incasso")]);
  expect(ingest(opgeslagen, [bron("Albert Heijn 1234", "2026-08-03", -11.89, "Betaalautomaat")])).toHaveLength(2);
  // Dezelfde winkel, maar een ander bedrag, een andere dag of een andere
  // rekening is ook een andere betaling.
  expect(ingest(opgeslagen, [bron("Simyo B.V.", "2026-08-03", -10, "SEPA Incasso")])).toHaveLength(2);
  expect(ingest(opgeslagen, [bron("Simyo B.V.", "2026-08-04", -11.89, "SEPA Incasso")])).toHaveLength(2);
  expect(ingest(opgeslagen, [bron("Simyo B.V.", "2026-08-03", -11.89, "SEPA Incasso", "ASN")])).toHaveLength(2);
  // Wél opgeslokt: dezelfde winkel, dezelfde dag, hetzelfde bedrag.
  expect(ingest(opgeslagen, [bron("Simyo B.V.", "2026-08-03", -11.89, "SEPA Incasso")])).toHaveLength(1);
});

test("een rij zonder naam ontdubbelt nooit — geen naam is geen bewijs", () => {
  // MT940-rijen en ABN-fallbacks laten de tegenpartij leeg. Twee lege rijen op
  // dezelfde dag voor hetzelfde bedrag kunnen dezelfde betaling zijn, maar niets
  // in de rij zegt dat. Dan blijven ze allebei staan: dubbel tellen is te
  // herstellen, een gewiste betaling niet.
  const naamloos = ingest([], [bron("", "2026-08-03", -25, "MT940 rij")]);
  expect(ingest(naamloos, [bron("", "2026-08-03", -25, "andere tekst")])).toHaveLength(2);
  expect(ingest(naamloos, [bron("Simyo B.V.", "2026-08-03", -25, "SEPA Incasso")])).toHaveLength(2);
});

/* TWEE REKENINGEN — het geval dat hij nu gaat testen.
 *
 * Het ontdubbelen kijkt naar (rekening, datum, bedrag) en is bedoeld om dezelfde
 * betaling uit twee BRONNEN samen te voegen. Met één rekening geïmporteerd kon
 * dat nooit fout gaan; met twee wel, want dan bestaan er echt twee verschillende
 * betalingen van hetzelfde bedrag op dezelfde dag. De sleutel dekt dat af doordat
 * accountKey erin zit — maar dat stond nergens vastgelegd, en een eigenschap die
 * alleen per ongeluk klopt, klopt tot iemand de sleutel aanpast. */
test("dezelfde dag, hetzelfde bedrag, dezelfde winkel — maar twee rekeningen: allebei blijven", () => {
  const opgeslagen = assignTxIds([mk({ accountKey: "A", counterparty: "Albert Heijn" })]);
  const nieuw = ingest(opgeslagen, [mk({ accountKey: "B", counterparty: "Albert Heijn 1234" })]);
  expect(nieuw).toHaveLength(2);
  expect(new Set(nieuw.map((t) => t.accountKey))).toEqual(new Set(["A", "B"]));
});

test("en op DEZELFDE rekening voegt hij de twee schrijfwijzen wel samen", () => {
  // De tegenproef: zonder deze blijft de test hierboven ook groen als het
  // ontdubbelen helemaal stuk is.
  const opgeslagen = assignTxIds([mk({ accountKey: "A", counterparty: "Albert Heijn" })]);
  const nieuw = ingest(opgeslagen, [mk({ accountKey: "A", counterparty: "Albert Heijn 1234" })]);
  expect(nieuw).toHaveLength(1);
});

test("een overboeking tussen zijn eigen twee rekeningen blijft twee rijen", () => {
  /* Eén overboeking is aan de ene kant een afschrijving en aan de andere een
   * bijschrijving. Zelfde dag, zelfde bedrag in absolute zin, en straks ook
   * dezelfde tegenpartij (zijn eigen naam) — maar het zijn twee kanten van
   * hetzelfde en allebei horen ze in de kluis, anders klopt geen enkel saldo. */
  const opgeslagen = assignTxIds([mk({ accountKey: "A", amount: -250, counterparty: "A Steunenberg" })]);
  const nieuw = ingest(opgeslagen, [mk({ accountKey: "B", amount: 250, counterparty: "A Steunenberg" })]);
  expect(nieuw).toHaveLength(2);
  expect(nieuw.map((t) => t.amount).sort((a, b) => a - b)).toEqual([-250, 250]);
});

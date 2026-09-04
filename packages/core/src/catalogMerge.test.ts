import { expect, test } from "vitest";
import { mergeCatalogEntries, type MergeEntry } from "./catalogMerge.js";
import type { CatalogValue } from "./catalog.js";

const covered = (value: number): CatalogValue => ({
  value,
  route: "provider-pdf",
  sourceUrl: "https://example.test/tarieven.pdf",
  checkedAt: "2026-01-01",
  conditions: "bij betalen in vreemde valuta",
  conditionsKnown: true,
});

const refused = (value: number): CatalogValue => ({
  value,
  route: "agent",
  sourceUrl: "https://example.test/pagina",
  checkedAt: "2026-08-21",
  conditions: null,
  conditionsKnown: false,
});

const entry = (id: string, fields: MergeEntry["fields"]): MergeEntry => ({
  id,
  product: id,
  fields,
});

test("een veld dat deze run niet mat blijft staan", () => {
  /* De echte zaak: een volledige sweep vraagt alleen fxFeePct en interestPct,
   * terwijl dezelfde producten ook punten, cashback en rekeningkosten dragen.
   * Het oude pad schreef de entries integraal weg en wiste er 68. */
  const prev = [
    entry("ing-betaalpas", {
      fxFeePct: covered(1.4),
      pointsPerEuro: covered(0.5),
      accountFee: covered(4.85),
    }),
  ];
  const rows = [entry("ing-betaalpas", { fxFeePct: covered(1.5) })];
  const { entries } = mergeCatalogEntries(prev, rows, ["ing-betaalpas"]);
  expect(entries[0].fields.fxFeePct?.value).toBe(1.5);
  expect(entries[0].fields.pointsPerEuro?.value).toBe(0.5);
  expect(entries[0].fields.accountFee?.value).toBe(4.85);
});

test("een run die niets vond wist niets", () => {
  const prev = [entry("abn-betaalpas", { fxFeePct: covered(1.2), cashbackPct: covered(1) })];
  const rows = [entry("abn-betaalpas", {})];
  const { entries } = mergeCatalogEntries(prev, rows, ["abn-betaalpas"]);
  expect(entries[0].fields.fxFeePct?.value).toBe(1.2);
  expect(entries[0].fields.cashbackPct?.value).toBe(1);
});

test("een geweigerd cijfer verdringt een gedekt cijfer niet, en dat wordt gemeld", () => {
  // Gemeten geval: een run zonder sleutel verving 1,2% (gedekt, uit het
  // informatiedocument) door de 2% van de creditcardrij, geweigerd.
  const prev = [entry("abn-betaalpas", { fxFeePct: covered(1.2) })];
  const rows = [entry("abn-betaalpas", { fxFeePct: refused(2) })];
  const { entries, kept } = mergeCatalogEntries(prev, rows, ["abn-betaalpas"]);
  expect(entries[0].fields.fxFeePct?.value).toBe(1.2);
  expect(kept).toEqual(["abn-betaalpas.fxFeePct"]);
});

test("de weigering geldt per VELD, niet per product", () => {
  /* Hier zat de fout: de regel stond op entry-niveau, dus één zwak veld hield
   * het hele product tegen — inclusief een goed cijfer ernaast. */
  const prev = [entry("bunq-easy", { fxFeePct: covered(1.2), interestPct: refused(0) })];
  const rows = [entry("bunq-easy", { fxFeePct: refused(3), interestPct: covered(2.01) })];
  const { entries, kept } = mergeCatalogEntries(prev, rows, ["bunq-easy"]);
  expect(entries[0].fields.fxFeePct?.value).toBe(1.2); // gehouden
  expect(entries[0].fields.interestPct?.value).toBe(2.01); // vervangen
  expect(kept).toEqual(["bunq-easy.fxFeePct"]);
});

test("producten die deze run niet zag blijven bestaan", () => {
  // De --only-val: een subset wegschrijven verwijderde alles wat niet gekeken is.
  const prev = [entry("a", { fxFeePct: covered(1) }), entry("b", { fxFeePct: covered(2) })];
  const rows = [entry("a", { fxFeePct: covered(1.1) })];
  const { entries } = mergeCatalogEntries(prev, rows, ["a", "b"]);
  expect(entries.map((e) => e.id)).toEqual(["a", "b"]);
  expect(entries[1].fields.fxFeePct?.value).toBe(2);
});

test("een nieuw product komt erbij, in de volgorde van state.json", () => {
  const prev = [entry("b", { fxFeePct: covered(2) })];
  const rows = [entry("a", { fxFeePct: covered(1) })];
  const { entries } = mergeCatalogEntries(prev, rows, ["a", "b"]);
  expect(entries.map((e) => e.id)).toEqual(["a", "b"]);
});

test("een id dat state.json niet kent gaat achteraan in plaats van vooraan", () => {
  // indexOf geeft -1, en -1 sorteert vóór alles. Dat zette een onbekend product
  // bovenaan de diff alsof het het belangrijkste was.
  const prev = [entry("a", { fxFeePct: covered(1) }), entry("zwerver", { fxFeePct: covered(9) })];
  const { entries } = mergeCatalogEntries(prev, [], ["a"]);
  expect(entries.map((e) => e.id)).toEqual(["a", "zwerver"]);
});

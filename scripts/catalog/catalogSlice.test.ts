import { describe, expect, test } from "vitest";
import { sliceForExtraction } from "./catalogSlice.js";

/** A sheet shaped like ING's: a debit row with no qualifier, a creditcard row
 *  that IS capped, a disqualifying footnote, and a lot of unrelated tariff. */
function ingShapedSheet(): string {
  // Deliberately free of cap vocabulary: an earlier version of this filler said
  // "per maand", which is cap language, so every block matched and the slicer
  // correctly declined to slice at all. The fixture, not the slicer, was wrong.
  const filler = (label: string) =>
    `${label} algemene bepalingen en overige informatie zonder bedragen `.repeat(60);
  return [
    "KOSTENOVERZICHT BETAALPRODUCTEN",
    "Deze brochure is geldig vanaf 15 juni 2026.",
    filler("Pakketten"),
    "• Betalen in vreemde valuta met een Betaalpas 1,40% koersopslag",
    filler("Overboekingen"),
    filler("Rood staan"),
    "• In vreemde valuta tot € 500 per creditcardperiode 0,00%",
    "• boven € 500 2,00% koersopslag",
    filler("Verzekeringen"),
    "* Let op: voor een aantal producten gelden afwijkende kosten bij een Basispakket.",
    filler("Overig"),
  ].join("\n");
}

describe("sliceForExtraction", () => {
  test("keeps the row being asked about", () => {
    const r = sliceForExtraction(ingShapedSheet());
    expect(r.whole).toBe(false);
    expect(r.text).toContain("Betaalpas 1,40% koersopslag");
  });

  test("KEEPS the capped row elsewhere — the evidence the exhaustive rule runs on", () => {
    // This is the test that stops a cost saving from becoming a silent quality
    // collapse: without this row, capsExpressedElsewhere goes false and every
    // figure reverts to refused with no error anywhere.
    const r = sliceForExtraction(ingShapedSheet());
    expect(r.text).toContain("tot € 500 per creditcardperiode 0,00%");
    expect(r.text).toContain("boven € 500 2,00%");
  });

  test("keeps the footnote that can disqualify a row", () => {
    expect(sliceForExtraction(ingShapedSheet()).text).toContain(
      "afwijkende kosten bij een Basispakket",
    );
  });

  test("keeps the document's own validity date", () => {
    expect(sliceForExtraction(ingShapedSheet()).text).toContain("geldig vanaf 15 juni 2026");
  });

  test("actually saves something on a document padded with irrelevance", () => {
    const r = sliceForExtraction(ingShapedSheet());
    expect(r.kept).toBeLessThan(0.8);
    expect(r.regions).toBeGreaterThan(0);
  });

  test("sends a SHORT document whole — the risk outweighs a fraction of a cent", () => {
    const r = sliceForExtraction("Betalen in vreemde valuta: 1,4% koersopslag.");
    expect(r.whole).toBe(true);
    expect(r.text).toContain("1,4%");
  });

  test("sends the document whole when NOTHING matches, rather than returning nothing", () => {
    // "we did not look properly" must never be turned into "the document says
    // nothing" — an empty slice would read as a clean negative.
    const r = sliceForExtraction("x".repeat(9000));
    expect(r.whole).toBe(true);
    expect(r.text.length).toBe(9000);
  });

  test("sends the document whole when slicing barely helps", () => {
    // A dense tariff sheet is legitimately all relevant; the joins would only
    // split table rows from their headers.
    const dense = "In vreemde valuta 1,4% koersopslag tot € 500 per maand. ".repeat(200);
    expect(sliceForExtraction(dense).whole).toBe(true);
  });

  test("regions read in document order and do not duplicate a passage", () => {
    const r = sliceForExtraction(ingShapedSheet());
    const first = r.text.indexOf("Betaalpas 1,40%");
    const later = r.text.indexOf("boven € 500");
    expect(first).toBeGreaterThan(-1);
    expect(later).toBeGreaterThan(first);
    expect(r.text.split("Betaalpas 1,40% koersopslag").length - 1).toBe(1);
  });

  test("keeps a de Volksbank row, which never says 'koersopslag' at all", () => {
    const doc = [
      "TARIEVENWIJZER",
      "filler ".repeat(900),
      "• Betalen met een betaalpas in vreemde valuta 1,4% van het betaalde bedrag",
      "filler ".repeat(900),
      "• Opname in vreemde valuta 2% valutawisselkosten",
      "filler ".repeat(900),
    ].join("\n");
    const r = sliceForExtraction(doc);
    expect(r.text).toContain("1,4% van het betaalde bedrag");
    expect(r.text).toContain("2% valutawisselkosten");
  });
});

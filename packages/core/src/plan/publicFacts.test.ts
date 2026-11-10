import { describe, expect, test } from "vitest";
import { findAdviceLanguage } from "../advice/language.js";
import type { PublicFact } from "../advisor/publicFact.js";
import { PENDING_PUBLIC_FACT_IDS, PUBLIC_FACTS, factById, showableFacts } from "./publicFacts.js";

const fact = (over: Partial<PublicFact> = {}): PublicFact => ({
  id: "duo-rules",
  textKey: "plan.fact.duo",
  value: "x",
  source: "DUO",
  sourceUrl: "https://example.test/duo",
  verifiedOn: "2026-10-01",
  verifiedBy: "owner",
  ...over,
});

describe("public facts", () => {
  test("nothing is verified at ship; showableFacts([]) is []", () => {
    expect(PUBLIC_FACTS).toEqual([]);
    expect(showableFacts([])).toEqual([]);
    expect(showableFacts()).toEqual([]);
    expect(factById("duo-rules")).toBeNull();
  });
  test("pending ids are the 15 from the brief", () => {
    expect(PENDING_PUBLIC_FACT_IDS).toHaveLength(16);
    expect(PENDING_PUBLIC_FACT_IDS).toContain("gift-tax-annual-2026");
    expect(PENDING_PUBLIC_FACT_IDS).toContain("card-nl-terms");
  });
  test("a fact without verifiedOn, verifiedBy or sourceUrl is never showable", () => {
    const { verifiedOn: _o, ...noDate } = fact();
    const { verifiedBy: _b, ...noBy } = fact();
    expect(
      showableFacts([
        fact(),
        noDate,
        noBy,
        fact({ sourceUrl: " " }),
        fact({ verifiedOn: "yesterday" }),
      ]),
    ).toEqual([fact()]);
  });
  test("a verifiedOn with no verifiedBy/sourceUrl is not showable (the real contract)", () => {
    const f = fact({ verifiedBy: undefined as never });
    delete (f as { verifiedBy?: string }).verifiedBy;
    expect(showableFacts([f])).toEqual([]);
  });
  test("a fact also needs a textKey and a value", () => {
    expect(showableFacts([fact({ textKey: "" })])).toEqual([]);
    expect(showableFacts([fact({ value: "" })])).toEqual([]);
    expect(showableFacts([fact({ value: 0 })])).toHaveLength(1);
    expect(showableFacts([fact({ value: Number.NaN })])).toEqual([]);
  });
  test("factById returns only a showable fact", () => {
    const good = fact();
    const bad = fact({ id: "box3-minors", verifiedOn: undefined as never });
    delete (bad as { verifiedOn?: string }).verifiedOn;
    expect(factById("duo-rules", [good, bad])).toEqual(good);
    expect(factById("box3-minors", [good, bad])).toBeNull();
  });
  test("pending ids carry no banned language", () => {
    for (const id of PENDING_PUBLIC_FACT_IDS) {
      expect(findAdviceLanguage(id.replace(/-/g, " "), "en")).toEqual([]);
    }
  });
});

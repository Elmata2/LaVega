import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUSINESS_SAVINGS_OFFERS } from "@lavega/core";
import {
  compareOffer,
  decideIssueAction,
  fetchSanityProblem,
  parseNumber,
  parsePages,
  renderIssueBody,
  type FoundFigures,
} from "./businessSavingsWatch.js";

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const SAVINGS = fixture("revolut-business-savings.txt");
const SHEET = fixture("revolut-business-deposit-sheet.txt");

const offer = BUSINESS_SAVINGS_OFFERS.find((o) => o.id === "revolut-business-savings")!;
const matching = (): FoundFigures => parsePages([SAVINGS, SHEET]);
const FAR = "2026-10-16";

describe("parseNumber", () => {
  it("reads comma and dot decimals and thousands groups", () => {
    expect(parseNumber("1,25")).toBe(1.25);
    expect(parseNumber("5.25")).toBe(5.25);
    expect(parseNumber("100,000")).toBe(100_000);
    expect(parseNumber("100.000")).toBe(100_000);
    expect(parseNumber("10,000,000")).toBe(10_000_000);
    expect(parseNumber("2,00")).toBe(2);
    expect(parseNumber("abc")).toBeNull();
  });
});

describe("parsePages on the saved fixtures", () => {
  it("yields today's promo and plan figures", () => {
    expect(matching()).toEqual({
      promoRatePct: 5.25,
      signupFrom: "2026-09-15",
      signupUntil: "2026-11-15",
      durationMonths: 3,
      capAmount: 100_000,
      planRates: { Basic: 1.25, Grow: 1.55, Scale: 2, Enterprise: 2.5 },
    });
  });

  it("reports nothing for a page without the figures", () => {
    const f = parsePages(["Just a quick security check"]);
    expect(f.promoRatePct).toBeNull();
    expect(f.signupUntil).toBeNull();
    expect(f.planRates).toEqual({});
  });
});

describe("compareOffer", () => {
  it("has no findings when values match and the promo is far off", () => {
    expect(compareOffer(offer, matching(), [], FAR)).toEqual([]);
  });

  it("flags a changed plan rate", () => {
    const found = { ...matching(), planRates: { ...matching().planRates, Grow: 1.45 } };
    expect(compareOffer(offer, found, [], FAR)).toEqual([
      { kind: "changed", field: "Plan Grow (% p.a.)", stored: "1.55", found: "1.45" },
    ]);
  });

  it("flags a changed promo rate", () => {
    const found = { ...matching(), promoRatePct: 4.5 };
    expect(compareOffer(offer, found, [], FAR)).toEqual([
      { kind: "changed", field: "Promo rate (% p.a.)", stored: "5.25", found: "4.5" },
    ]);
  });

  it("flags a missing figure", () => {
    const found = { ...matching(), capAmount: null };
    expect(compareOffer(offer, found, [], FAR)).toEqual([
      { kind: "missing", field: "Promo cap (EUR)", stored: "100000" },
    ]);
  });

  it("reports a failed fetch without also listing every figure as missing", () => {
    const empty = parsePages([]);
    const failures = [{ url: offer.sourceUrls[0], error: "HTTP 403" }];
    expect(compareOffer(offer, empty, failures, FAR)).toEqual([
      { kind: "fetch-failed", url: offer.sourceUrls[0], error: "HTTP 403" },
    ]);
  });

  it("flags a promo ending within 14 days", () => {
    expect(compareOffer(offer, matching(), [], "2026-11-02")).toEqual([
      { kind: "promo-ending-soon", signupUntil: "2026-11-15", daysLeft: 13 },
    ]);
    expect(compareOffer(offer, matching(), [], "2026-11-01")).toEqual([
      { kind: "promo-ending-soon", signupUntil: "2026-11-15", daysLeft: 14 },
    ]);
    expect(compareOffer(offer, matching(), [], "2026-10-31")).toEqual([]);
  });

  it("flags an ended promo, but not on the last sign-up day", () => {
    expect(compareOffer(offer, matching(), [], "2026-11-16")).toEqual([
      { kind: "promo-ended", signupUntil: "2026-11-15" },
    ]);
    expect(compareOffer(offer, matching(), [], "2026-11-15")).toEqual([
      { kind: "promo-ending-soon", signupUntil: "2026-11-15", daysLeft: 0 },
    ]);
  });
});

describe("renderIssueBody", () => {
  it("lists a field | stored | found table, sources and the date", () => {
    const findings = compareOffer(offer, { ...matching(), promoRatePct: 4.5 }, [], FAR);
    const body = renderIssueBody([{ offer, findings }], FAR);
    expect(body).toContain("| Promo rate (% p.a.) | 5.25 | 4.5 |");
    expect(body).toContain(offer.sourceUrls[1]);
    expect(body).toContain(`Datum controle: ${FAR}`);
  });
});

describe("two-way detection", () => {
  it("flags a plan on the page that the offer does not have", () => {
    const found = { ...matching(), planRates: { ...matching().planRates, Ultra: 3 } };
    expect(compareOffer(offer, found, [], FAR)).toEqual([
      { kind: "changed", field: "Plan Ultra (% p.a.)", stored: "niet opgeslagen", found: "3" },
    ]);
  });

  it("flags a promo on the page when the offer stores none", () => {
    const { promo: _promo, ...bare } = offer;
    const findings = compareOffer(bare, matching(), [], FAR);
    expect(findings).toEqual([
      {
        kind: "changed",
        field: "Nieuwe actie op de pagina",
        stored: "geen actie",
        found: "5.25% p.a., inschrijven 2026-09-15..2026-11-15",
      },
    ]);
  });

  it("flags a different promo end date", () => {
    const found = { ...matching(), signupUntil: "2026-12-15" };
    expect(compareOffer(offer, found, [], FAR)).toEqual([
      {
        kind: "changed",
        field: "Promo sign-up until",
        stored: "2026-11-15",
        found: "2026-12-15",
      },
    ]);
  });
});

describe("fetchSanityProblem", () => {
  it("accepts the real fixtures", () => {
    expect(fetchSanityProblem(SAVINGS)).toBeNull();
    expect(fetchSanityProblem(SHEET)).toBeNull();
  });
  it("rejects challenge, jina failure, short and figure-less bodies", () => {
    expect(fetchSanityProblem("Just a quick security check")).toMatch(/challenge/);
    expect(
      fetchSanityProblem(`Warning: Target URL returned error 403\n${"x".repeat(600)}`),
    ).toMatch(/failure header/);
    expect(fetchSanityProblem("Error: boom")).toMatch(/failure header/);
    expect(fetchSanityProblem("x% ")).toMatch(/too short/);
    expect(fetchSanityProblem("lorem ".repeat(200))).toMatch(/neither/);
  });
});

describe("decideIssueAction", () => {
  it("upserts on findings, closes a stale open issue, else does nothing", () => {
    expect(decideIssueAction(true, 7)).toEqual({ action: "upsert" });
    expect(decideIssueAction(true, null)).toEqual({ action: "upsert" });
    expect(decideIssueAction(false, 7)).toEqual({ action: "close", number: 7 });
    expect(decideIssueAction(false, null)).toEqual({ action: "none" });
  });
});

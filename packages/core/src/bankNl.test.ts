import { expect, test, describe } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  parseBankNlPage,
  comparisonTermsFor,
  splitProductName,
  bankNameMatches,
  type BankNlRow,
} from "./bankNl.js";

/* The fixture is the REAL page, saved verbatim on 2026-08-16 (HTTP 200, 96 kB,
 * with a browser User-Agent). The tests never touch the network — a parser that
 * only passes against the live site is a parser nobody can run. */
const FIXTURE = readFileSync(
  fileURLToPath(
    new URL("./__fixtures__/bank-nl-betalen-in-buitenland-2026-08-16.html", import.meta.url),
  ),
  "utf8",
);

const parsed = parseBankNlPage(FIXTURE);
const row = (bank: string, card: string) =>
  parsed.rows.find((r) => r.bank === bank && r.card === card);

describe("parsing the real page", () => {
  test("every bank that has a tariff table is found, and only those", () => {
    expect([...new Set(parsed.rows.map((r) => r.bank))]).toEqual([
      "ABN AMRO",
      "ING",
      "Rabobank",
      "ASN Bank",
      "Triodos Bank",
      "Knab",
      "Bunq",
    ]);
  });

  test("the koersopslag is read per bank AND per card kind", () => {
    expect(parsed.rows.map((r) => [r.bank, r.card, r.fxFeePct])).toEqual([
      ["ABN AMRO", "betaalpas", 1.2],
      ["ABN AMRO", "creditcard", 2],
      ["ING", "betaalpas", 1.4],
      ["ING", "creditcard", 2],
      ["Rabobank", "betaalpas", 1.4],
      ["Rabobank", "creditcard", 2],
      ["ASN Bank", "betaalpas", 1.4],
      ["ASN Bank", "creditcard", 2],
      ["Triodos Bank", "betaalpas", 1],
      ["Knab", "betaalpas", 1.4],
      ["Knab", "creditcard", 2],
      ["Bunq", "betaalpas", 2],
    ]);
  });

  test("debit and credit are kept apart — they are different tariffs", () => {
    // The whole reason productOf splits them: at ABN AMRO the gap is 0,8pp.
    expect(row("ABN AMRO", "betaalpas")!.fxFeePct).toBe(1.2);
    expect(row("ABN AMRO", "creditcard")!.fxFeePct).toBe(2);
  });

  test("a bank the page names for only ONE card gets only that card", () => {
    // Triodos' table has a "Met betaalpas" column and nothing else. Inventing a
    // creditcard row at the same rate would be a figure the page never stated.
    expect(parsed.rows.filter((r) => r.bank === "Triodos Bank")).toHaveLength(1);
    expect(row("Triodos Bank", "creditcard")).toBeUndefined();
  });

  test("banks that appear only in the site navigation never become rows", () => {
    // "American Express" and "SNS Bank" are menu links on this page with no
    // tariff attached; attributing a figure to them would be an invention.
    expect(FIXTURE).toContain("American Express");
    expect(FIXTURE).toContain("SNS Bank");
    expect(parsed.rows.some((r) => /express|sns|ics/i.test(r.bank))).toBe(false);
  });

  test("the page's own check date is kept, per table and overall", () => {
    expect(parsed.checkedAt).toBe("2026-01-15");
    expect(parsed.rows.every((r) => r.checkedAt === "2026-01-15")).toBe(true);
  });

  test("a fixed fee that is not a percentage survives in the note, never in the figure", () => {
    const abn = row("ABN AMRO", "betaalpas")!;
    expect(abn.fxFeePct).toBe(1.2); // NOT 1.2 + something for the €0,15
    expect(abn.note).toContain("€0,15");
  });

  test("an asterisked cell carries its footnote into the note", () => {
    expect(row("Triodos Bank", "betaalpas")!.note).toContain(
      "De buitenlandse bank kan bijkomende kosten rekenen",
    );
  });

  test("every note says where the figure came from and when it was checked", () => {
    expect(
      parsed.rows.every((r) =>
        r.note.includes("Bron: bank.nl-vergelijking, laatst gecontroleerd 2026-01-15."),
      ),
    ).toBe(true);
  });

  test("bunq's per-plan table collapses to ONE row at the dearest plan", () => {
    // The page lists Core (1,5% + 0,5%), Pro (0,5%) and Elite (0,5%) — plans,
    // not products, and it never says which one you are on. Erring cheap would
    // crown the wrong card; erring dear only loses a comparison he can correct.
    const bunq = row("Bunq", "betaalpas")!;
    expect(bunq.fxFeePct).toBe(2);
    expect(bunq.note).toContain("Bunq Core");
    expect(bunq.note).toContain("Bunq Pro");
    expect(bunq.note).toContain("Bunq Elite");
    expect(bunq.note).toContain("duurste");
  });

  test("HTML entities and nested markup are decoded, not left in the text", () => {
    expect(parsed.rows.some((r) => r.note.includes("&#") || r.note.includes("<"))).toBe(false);
  });
});

describe("parsing rules on synthetic tables", () => {
  const page = (heading: string, table: string, caption = "Laatst gecontroleerd op 1-2-2026") =>
    `<h2>${heading}</h2><figure class="wp-block-table"><table>${table}</table>` +
    `<figcaption><span>${caption}</span></figcaption></figure>`;

  const twoColumn = (fx: string) =>
    "<thead><tr><th></th><th>Met betaalpas</th></tr></thead>" +
    `<tbody><tr><td>Betalen in euro&#8217;s</td><td>Gratis</td></tr><tr><td>Betalen in vreemde valuta</td><td>${fx}</td></tr></tbody>`;

  test("several surcharge components in one cell are summed", () => {
    const out = parseBankNlPage(
      page("Testbank", twoColumn("1,5% van het bedrag + 0,5% netwerkkosten")),
    );
    expect(out.rows[0].fxFeePct).toBe(2);
  });

  test("a cell with no percentage leaves the tariff UNKNOWN, never free", () => {
    // "Unknown is never silently treated as zero or free" — this is the rule the
    // whole travel ranking rests on.
    expect(parseBankNlPage(page("Testbank", twoColumn("Gratis"))).rows).toEqual([]);
    expect(parseBankNlPage(page("Testbank", twoColumn("Zie voorwaarden"))).rows).toEqual([]);
  });

  test("a table with no foreign-currency row yields nothing", () => {
    const table =
      "<thead><tr><th></th><th>Met betaalpas</th></tr></thead><tbody><tr><td>Betalen in euro&#8217;s</td><td>Gratis</td></tr></tbody>";
    expect(parseBankNlPage(page("Testbank", table)).rows).toEqual([]);
  });

  test("a column we cannot attribute to a card kind is dropped, not guessed", () => {
    const table =
      "<thead><tr><th></th><th>Met betaalpas</th><th>Met een tegoedbon</th></tr></thead>" +
      "<tbody><tr><td>Betalen in vreemde valuta</td><td>1,4% koersopslag</td><td>9,9%</td></tr></tbody>";
    const out = parseBankNlPage(page("Testbank", table));
    expect(out.rows.map((r) => [r.card, r.fxFeePct])).toEqual([["betaalpas", 1.4]]);
  });

  test('"Met creditcard of platinumcard" is a credit card, not a debit card', () => {
    const table =
      "<thead><tr><th></th><th>Met creditcard of platinumcard</th></tr></thead>" +
      "<tbody><tr><td>Betalen in vreemde valuta</td><td>2,0% koersopslag</td></tr></tbody>";
    expect(parseBankNlPage(page("Testbank", table)).rows[0].card).toBe("creditcard");
  });

  test("a table with no heading above it is skipped rather than attributed to nobody", () => {
    const orphan =
      '<figure class="wp-block-table"><table>' +
      twoColumn("1,4% koersopslag") +
      "</table></figure>";
    expect(parseBankNlPage(orphan).rows).toEqual([]);
  });

  test("a missing check date is null, not today", () => {
    const out = parseBankNlPage(page("Testbank", twoColumn("1,4% koersopslag"), "Geen datum"));
    expect(out.checkedAt).toBeNull();
    expect(out.rows[0].checkedAt).toBeNull();
    expect(out.rows[0].note).toBe("1,4% koersopslag Bron: bank.nl-vergelijking.");
  });

  test("a single-digit day and month become a real ISO date", () => {
    const out = parseBankNlPage(
      page("Testbank", twoColumn("1,4% koersopslag"), "Laatst gecontroleerd op 5-3-2026"),
    );
    expect(out.checkedAt).toBe("2026-03-05");
  });

  test("junk HTML yields no rows instead of throwing", () => {
    expect(parseBankNlPage("").rows).toEqual([]);
    expect(parseBankNlPage("<html><body><p>niets</p></body></html>").rows).toEqual([]);
  });
});

describe("mapping a table row onto a LaVega product", () => {
  const rows: BankNlRow[] = parsed.rows;

  test("a product name splits into bank and card kind", () => {
    expect(splitProductName("ING betaalpas")).toEqual({ bank: "ING", card: "betaalpas" });
    expect(splitProductName("ABN AMRO creditcard")).toEqual({
      bank: "ABN AMRO",
      card: "creditcard",
    });
    // Not a product name productOf could ever have built.
    expect(splitProductName("ING")).toBeNull();
    expect(splitProductName("betaalpas")).toBeNull();
    expect(splitProductName("")).toBeNull();
  });

  test("the figure lands on the right product, debit and credit apart", () => {
    expect(comparisonTermsFor(rows, "ING betaalpas")).toMatchObject({
      provider: "ING betaalpas",
      fxFeePct: 1.4,
    });
    expect(comparisonTermsFor(rows, "ING creditcard")).toMatchObject({
      provider: "ING creditcard",
      fxFeePct: 2,
    });
    expect(comparisonTermsFor(rows, "ABN AMRO betaalpas")).toMatchObject({ fxFeePct: 1.2 });
  });

  test("the owner's own spelling of a bank still matches", () => {
    // `account.bank` is free text he can edit in Rekeningen, so "ASN" and "ASN
    // Bank" are the same bank and must not be two different unknowns.
    expect(comparisonTermsFor(rows, "ASN betaalpas")).toMatchObject({
      provider: "ASN betaalpas",
      fxFeePct: 1.4,
    });
    expect(comparisonTermsFor(rows, "Triodos betaalpas")).toMatchObject({ fxFeePct: 1 });
    expect(comparisonTermsFor(rows, "bunq betaalpas")).toMatchObject({ fxFeePct: 2 });
    expect(comparisonTermsFor(rows, "abn amro creditcard")).toMatchObject({ fxFeePct: 2 });
  });

  test("a bank this page says nothing about stays unknown", () => {
    expect(comparisonTermsFor(rows, "Revolut betaalpas")).toBeNull();
    expect(comparisonTermsFor(rows, "American Express creditcard")).toBeNull();
    expect(comparisonTermsFor(rows, "Trading 212 betaalpas")).toBeNull();
  });

  test("a card kind the page never priced stays unknown", () => {
    // Triodos: betaalpas only. Reusing its debit figure for a credit card would
    // be a number nobody published.
    expect(comparisonTermsFor(rows, "Triodos Bank creditcard")).toBeNull();
  });

  test("bank matching never crosses two different banks", () => {
    expect(bankNameMatches("ASN Bank", "SNS")).toBe(false);
    expect(bankNameMatches("ING", "Knab")).toBe(false);
    expect(bankNameMatches("Rabobank", "ABN AMRO")).toBe(false);
    // Too short to mean anything on its own.
    expect(bankNameMatches("ING", "IN")).toBe(false);
    expect(bankNameMatches("ING", "")).toBe(false);
  });

  test("the note travels with the figure, so the owner can judge it", () => {
    const t = comparisonTermsFor(rows, "ABN AMRO betaalpas")!;
    expect(t.note).toContain("€0,15");
    expect(t.note).toContain("laatst gecontroleerd 2026-01-15");
  });
});

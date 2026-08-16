import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { formatEuro } from "../../format.js";
import RecenteTransactiesBlock, { matchesSearch, monogram, tileColor } from "./RecenteTransactiesBlock";
import { accounts, own, rules, txs } from "./fixtures";

const render = (list = txs) =>
  renderToStaticMarkup(
    <RecenteTransactiesBlock
      txs={list}
      accounts={accounts}
      rules={rules}
      own={own}
      onNavigate={() => {}}
      onSelectCategory={() => {}}
    />,
  );

test("RecenteTransactiesBlock renders the reference's row: tile, date, chip, amount", () => {
  const html = render();
  expect(html).toContain("Recente transacties");
  // Newest first.
  expect(html.indexOf("Brouwerij")).toBeLessThan(html.indexOf("Vattenfall"));
  // A monogram tile stands in for the merchant logo — no remote image is
  // requested anywhere in the markup.
  expect(html).toContain("tx-tile");
  expect(html).toContain(">BR<"); // Brouwerij
  expect(html).toContain(">AH<"); // Albert Heijn
  expect(html).not.toContain("<img");
  expect(html).not.toContain("http");
  // Date, entity and bank; a manual label, a user rule and a Dutch default each
  // become a chip.
  expect(html).toContain("11 aug");
  expect(html).toContain(" · Holding BV · ING");
  expect(html).toContain(formatEuro(-1_100));
  expect(html).toContain(">Inkoop<");
  expect(html).toContain(">Energie<");
  expect(html).toContain("tx-chip");
  // Search and the jump into Transacties.
  expect(html).toContain("tx-search");
  expect(html).toContain("Bekijk alles");
});

test("RecenteTransactiesBlock states that a booking time is not something it has", () => {
  const html = render();
  expect(html).toContain("geen tijdstip");
  // And it never prints one.
  expect(html).not.toMatch(/\d{2}:\d{2}/);
});

test("RecenteTransactiesBlock renders an empty state with no transactions", () => {
  const html = render([]);
  expect(html).toContain("Nog geen transacties.");
  expect(html).not.toContain("tx-chip");
});

test("monogram takes initials from the counterparty and never invents them", () => {
  expect(monogram("Albert Heijn")).toBe("AH");
  expect(monogram("Vattenfall")).toBe("VA");
  expect(monogram("NS Groep B.V.")).toBe("NG");
  // Nothing to take initials from is stated, not filled in.
  expect(monogram("")).toBe("?");
  expect(monogram("1234 5678")).toBe("?");
});

test("tileColor is stable per counterparty and stays inside the token palette", () => {
  expect(tileColor("Albert Heijn")).toBe(tileColor("Albert Heijn"));
  expect(tileColor("Albert Heijn")).toMatch(/^var\(--[a-z-]+\)$/);
});

test("matchesSearch looks at counterparty, description and the derived category", () => {
  const row = { counterparty: "Brouwerij", description: "Leverancier", category: "Inkoop" };
  expect(matchesSearch(row, "")).toBe(true);
  expect(matchesSearch(row, "  ")).toBe(true);
  expect(matchesSearch(row, "brouw")).toBe(true);
  expect(matchesSearch(row, "leverancier")).toBe(true);
  expect(matchesSearch(row, "inkoop")).toBe(true);
  expect(matchesSearch(row, "vattenfall")).toBe(false);
});

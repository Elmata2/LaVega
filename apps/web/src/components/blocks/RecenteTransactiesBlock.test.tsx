import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { formatEuro } from "../../format.js";
import RecenteTransactiesBlock, { matchesSearch } from "./RecenteTransactiesBlock";
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

test("RecenteTransactiesBlock renders the reference's row: name, date, chip, amount", () => {
  const html = render();
  expect(html).toContain("Recente transacties");
  // Newest first.
  expect(html.indexOf("Brouwerij")).toBeLessThan(html.indexOf("Vattenfall"));
  // The counterparty's NAME, in full — no logo, and no monogram standing in
  // for one. A logo would mean a remote request per merchant, which would tell
  // that server who he pays; a monogram only repeated the name in two letters.
  expect(html).toContain(">Brouwerij<");
  expect(html).toContain(">Vattenfall<");
  expect(html).not.toContain("tx-tile");
  expect(html).not.toContain(">BR<");
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

test("RecenteTransactiesBlock never prints a booking time it does not have", () => {
  const html = render();
  // Bank exports carry a date and no clock, so the row shows the date alone —
  // never an invented "00:00". The note line that used to explain this is gone
  // (UI review round 2): the absence of a clock needs no paragraph.
  expect(html).not.toMatch(/\d{2}:\d{2}/);
  expect(html).not.toContain("module-foot");
  expect(html).toContain("11 aug");
});

test("RecenteTransactiesBlock renders an empty state with no transactions", () => {
  const html = render([]);
  expect(html).toContain("Nog geen transacties.");
  expect(html).not.toContain("tx-chip");
});

test("a transaction with no counterparty still shows something readable", () => {
  // The monogram is gone, so the name is the only identity the row has: an
  // empty counterparty falls back to the description, and then to a stated
  // "unknown" — never to a blank cell.
  const html = render([
    { ...txs[0], id: "x1", counterparty: "", description: "Incasso", amount: -12 },
    { ...txs[0], id: "x2", counterparty: "", description: "", amount: -13 },
  ]);
  expect(html).toContain(">Incasso<");
  expect(html).toContain("Onbekende tegenpartij");
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

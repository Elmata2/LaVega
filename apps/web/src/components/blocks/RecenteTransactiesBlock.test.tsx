import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { formatEuro } from "../../format.js";
import RecenteTransactiesBlock from "./RecenteTransactiesBlock";
import { accounts, own, rules, txs } from "./fixtures";

test("RecenteTransactiesBlock renders the newest transactions with a category chip", () => {
  const html = renderToStaticMarkup(
    <RecenteTransactiesBlock
      txs={txs}
      accounts={accounts}
      rules={rules}
      own={own}
      onNavigate={() => {}}
      onSelectCategory={() => {}}
    />,
  );
  expect(html).toContain("Recente transacties");
  // Newest first.
  expect(html.indexOf("Leverancier")).toBeLessThan(html.indexOf("Energie augustus"));
  // The entity/bank/date line comes from enrichTxs.
  expect(html).toContain("Holding BV · ING · 2026-08-11");
  expect(html).toContain(formatEuro(-1_100));
  // A manual label, a user rule and a Dutch default each become a chip.
  expect(html).toContain(">Inkoop<");
  expect(html).toContain(">Energie<");
  expect(html).toContain("tx-chip");
});

test("RecenteTransactiesBlock renders an empty state with no transactions", () => {
  const html = renderToStaticMarkup(
    <RecenteTransactiesBlock
      txs={[]}
      accounts={accounts}
      rules={rules}
      own={own}
      onNavigate={() => {}}
      onSelectCategory={() => {}}
    />,
  );
  expect(html).toContain("Nog geen transacties.");
  expect(html).not.toContain("tx-chip");
});

import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { formatEuro } from "../../format.js";
import PositieBlock from "./PositieBlock";
import { accounts, txs } from "./fixtures";

test("PositieBlock renders one row per entity with its banks and balance", () => {
  const html = renderToStaticMarkup(<PositieBlock accounts={accounts} txs={txs} onNavigate={() => {}} />);
  expect(html).toContain("Positie over je bedrijven");
  expect(html).toContain("Holding BV");
  expect(html).toContain("Café BV");
  expect(html).toContain("Webshop BV");
  expect(html).toContain(formatEuro(182_310));
  expect(html).toContain(formatEuro(21_900));
  // Webshop BV's only account has no saldo, so its position is unknown rather
  // than a partial sum.
  expect(html).toContain("onbekend");
  expect(html).toContain("ING · 1 rek.");
  expect(html).toContain("proportion-bar");
});

test("PositieBlock renders an empty state when no account has an entity", () => {
  const html = renderToStaticMarkup(<PositieBlock accounts={[]} txs={[]} onNavigate={() => {}} />);
  expect(html).toContain("Nog geen rekeningen met een entiteit");
  expect(html).not.toContain("position-row");
});

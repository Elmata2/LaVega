import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { formatEuro } from "../../format.js";
import PositieBlock from "./PositieBlock";
import { accounts } from "./fixtures";

test("PositieBlock renders one compact row per entity in a small card", () => {
  const html = renderToStaticMarkup(<PositieBlock accounts={accounts} onNavigate={() => {}} />);
  expect(html).toContain("Positie per bedrijf");
  expect(html).toContain("Holding BV");
  expect(html).toContain("Café BV");
  expect(html).toContain("Webshop BV");
  expect(html).toContain(formatEuro(182_310));
  expect(html).toContain(formatEuro(21_900));
  expect(html).toContain("proportion-bar");
  // Shrunk: the per-entity sparkline is gone, and so is the tall card.
  expect(html).toContain("module-short");
  expect(html).not.toContain("module-tall");
  expect(html).not.toContain("sparkline");
});

test("PositieBlock leaves an entity's position unknown when one saldo is missing", () => {
  const html = renderToStaticMarkup(<PositieBlock accounts={accounts} onNavigate={() => {}} />);
  // Webshop BV's only account has no saldo, so its position is unknown rather
  // than a partial sum or a zero.
  expect(html).toContain("onbekend");
  expect(html).toContain("1 bedrijf zonder compleet saldo");
  expect(html).not.toContain(formatEuro(0));
});

test("PositieBlock renders an empty state when no account has an entity", () => {
  const html = renderToStaticMarkup(<PositieBlock accounts={[]} onNavigate={() => {}} />);
  expect(html).toContain("Nog geen rekeningen met een entiteit");
  expect(html).not.toContain("entity-row");
});

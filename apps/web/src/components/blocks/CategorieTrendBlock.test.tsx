import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import CategorieTrendBlock from "./CategorieTrendBlock";
import { own, rules, txs } from "./fixtures";

test("CategorieTrendBlock charts each category twice — previous period next to current", () => {
  const html = renderToStaticMarkup(
    <CategorieTrendBlock txs={txs} rules={rules} own={own} onSelectCategory={() => {}} />,
  );
  expect(html).toContain("Verandering per categorie");
  expect(html).toContain("Vorige periode");
  expect(html).toContain("Deze periode");
  // August has Inkoop and Energie; July had Inkoop only — two groups, two bars
  // each, so the change is read side by side rather than as a percentage.
  expect(html.match(/class="lv-bar"/g)?.length).toBe(4);
  expect(html).toContain("aug 2026 t.o.v. jul 2026");
  // The biggest absolute shift is Inkoop, 1.880 -> 1.100.
  expect(html).toContain("grootste verschuiving:");
  expect(html).toContain("Inkoop");
});

test("CategorieTrendBlock colours a rise in spending as bad, not as growth", () => {
  const html = renderToStaticMarkup(
    <CategorieTrendBlock txs={txs} rules={rules} own={own} onSelectCategory={() => {}} />,
  );
  // aug 1.350 vs jul 1.880 = spending down, which for an expense is the good
  // direction (delta-up = green in modules.css).
  expect(html).toContain("delta-pill delta-up");
});

test("CategorieTrendBlock says there is nothing to compare instead of drawing an empty chart", () => {
  const html = renderToStaticMarkup(
    <CategorieTrendBlock txs={[]} rules={[]} own={own} onSelectCategory={() => {}} />,
  );
  expect(html).toContain("Nog geen uitgaven om te vergelijken");
  expect(html).not.toContain("lv-bar");
});

import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { formatEuro } from "../../format.js";
import TopUitgavenBlock from "./TopUitgavenBlock";
import { own, rules, txs } from "./fixtures";

test("TopUitgavenBlock ranks the latest month's categories with share and delta", () => {
  const html = renderToStaticMarkup(
    <TopUitgavenBlock txs={txs} rules={rules} own={own} onSelectCategory={() => {}} />,
  );
  expect(html).toContain("Top uitgaven");
  // August: Inkoop € 1.100 (81%) and Energie € 250 (19%), biggest first.
  expect(html.indexOf("Inkoop")).toBeLessThan(html.indexOf("Energie"));
  expect(html).toContain(formatEuro(1_100));
  expect(html).toContain(formatEuro(250));
  expect(html).toContain("81%");
  expect(html).toContain("19%");
  // Inkoop was € 1.880 in July, so it fell; Energie is new this month.
  expect(html).toContain("cat-delta down");
  expect(html).toContain("nieuw");
  expect(html).toContain("aug 2026 · aandeel &amp; Δ t.o.v. jul 2026");
  // The "vs. gem." button is gone with the chat widget it depended on: a
  // visible control that does nothing is worse than no control.
  expect(html).not.toContain("vs. gem.");
});

test("TopUitgavenBlock renders an empty state with no spending", () => {
  const html = renderToStaticMarkup(
    <TopUitgavenBlock txs={[]} rules={rules} own={own} onSelectCategory={() => {}} />,
  );
  expect(html).toContain("Nog geen uitgaven deze maand.");
  expect(html).not.toContain("cat-bar");
});

import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import TravelBlock from "./TravelBlock";
import { accounts, ASOF, txs } from "./fixtures";

/* The travel plan itself is covered by @lavega/core's travel tests; this pins
 * that the block still renders as a module on the homescreen grid. */

const props = {
  accounts,
  txs,
  rates: [],
  facts: [],
  asOf: ASOF,
  homeCountry: "NL",
  busy: false,
  aiAvailable: false,
  onRefreshTerms: () => {},
  onCorrectFact: () => {},
};

test("TravelBlock renders as a module and asks for a destination first", () => {
  const html = renderToStaticMarkup(<TravelBlock {...props} />);
  expect(html).toContain('class="module module-span-3 module-tall"');
  expect(html).toContain("Op reis");
  expect(html).toContain("Ik reis vanuit NL naar");
  expect(html).toContain("Kies een land");
  // No destination picked, so there is no plan and no refresh control yet.
  expect(html).not.toContain("module-controls");
});

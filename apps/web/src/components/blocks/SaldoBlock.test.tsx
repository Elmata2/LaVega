import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { formatEuro } from "../../format.js";
import SaldoBlock from "./SaldoBlock";
import { accounts, ASOF, scheduledFlows } from "./fixtures";

test("SaldoBlock renders the summed known balances and what the number covers", () => {
  const html = renderToStaticMarkup(
    <SaldoBlock accounts={accounts} scheduledFlows={scheduledFlows} asOf={ASOF} onNavigate={() => {}} />,
  );
  // A3 has no saldo, so the title is flagged "(deels)" and the figure is the
  // sum of the two known balances.
  expect(html).toContain("Totale positie (deels)");
  expect(html).toContain(formatEuro(182_310 + 21_900));
  expect(html).toContain("1 rekening nog zonder saldo");
  expect(html).toContain("Rekeningen");
  expect(html).toContain(">3<"); // 3 accounts
  // Two unpaid VAT outflows are reserved, so "beschikbaar" is the net figure.
  expect(html).toContain("Beschikbaar na BTW-reservering");
  expect(html).toContain(formatEuro((182_310 + 21_900) - (412_500 + 380_000) / 100));
});

test("SaldoBlock shows a dash and an instruction with no accounts at all", () => {
  const html = renderToStaticMarkup(
    <SaldoBlock accounts={[]} scheduledFlows={[]} asOf={ASOF} onNavigate={() => {}} />,
  );
  expect(html).toContain("—");
  expect(html).toContain("Importeer een bestand of vul saldo"); // apostrophe is HTML-escaped
  expect(html).not.toContain("Beschikbaar na BTW-reservering");
});

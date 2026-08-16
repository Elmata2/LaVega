import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { formatEuro } from "../../format.js";
import SaldoBlock, { changePct, positionSeries } from "./SaldoBlock";
import { accounts, ASOF, freshAccounts, freshTxs, scheduledFlows, txs } from "./fixtures";

const KNOWN_SUM = 182_310 + 21_900;

test("SaldoBlock renders the summed known balances and what the number covers", () => {
  const html = renderToStaticMarkup(
    <SaldoBlock
      accounts={accounts}
      txs={txs}
      scheduledFlows={scheduledFlows}
      asOf={ASOF}
      onNavigate={() => {}}
    />,
  );
  // A3 has no saldo, so the title is flagged "(deels)" and the figure is the
  // sum of the two known balances.
  expect(html).toContain("Totale positie (deels)");
  expect(html).toContain(formatEuro(KNOWN_SUM));
  expect(html).toContain("1 rekening nog zonder saldo");
  expect(html).toContain("Rekeningen");
  expect(html).toContain("3 rekeningen · 3 entiteiten");
  // Two unpaid VAT outflows are reserved, so "beschikbaar" is the net figure.
  expect(html).toContain("beschikbaar na BTW-reservering");
  expect(html).toContain(formatEuro(KNOWN_SUM - (412_500 + 380_000) / 100));
});

test("SaldoBlock draws the position graph and both comparisons when history allows", () => {
  const html = renderToStaticMarkup(
    <SaldoBlock
      accounts={accounts}
      txs={txs}
      scheduledFlows={scheduledFlows}
      asOf={ASOF}
      onNavigate={() => {}}
    />,
  );
  expect(html).toContain("lv-chart-svg");
  expect(html).toContain("Totale positie per dag");
  expect(html).toContain("Vorige week");
  expect(html).toContain("Vorige maand");
  // A week ago the only later movement was t6 (-1.100 on 11 aug), so the
  // position then was higher by exactly that.
  expect(html).toContain(formatEuro(KNOWN_SUM + 1_100));
  // A month ago, t5 (-250) and t6 (-1.100) had not landed yet.
  expect(html).toContain(formatEuro(KNOWN_SUM + 1_350));
  expect(html).not.toContain("Nog geen week geschiedenis");
});

test("the percentage beside the big number says what it is measured against", () => {
  const html = renderToStaticMarkup(
    <SaldoBlock
      accounts={accounts}
      txs={txs}
      scheduledFlows={scheduledFlows}
      asOf={ASOF}
      onNavigate={() => {}}
    />,
  );
  // "▲ 1%" on its own is unreadable — one percent since when? The pill is the
  // move against the position one week ago, and the card now says so.
  expect(html).toContain("delta-pill");
  expect(html).toContain("t.o.v. vorige week");
});

test("with no week of history there is neither a pill nor a claim about one", () => {
  const html = renderToStaticMarkup(
    <SaldoBlock
      accounts={freshAccounts}
      txs={freshTxs}
      scheduledFlows={[]}
      asOf={ASOF}
      onNavigate={() => {}}
    />,
  );
  expect(html).not.toContain("delta-pill");
  expect(html).not.toContain("t.o.v. vorige week");
});

test("SaldoBlock refuses to draw a line it cannot back with history", () => {
  const html = renderToStaticMarkup(
    <SaldoBlock
      accounts={freshAccounts}
      txs={freshTxs}
      scheduledFlows={[]}
      asOf={ASOF}
      onNavigate={() => {}}
    />,
  );
  // Two days of history: no chart, and the card says why rather than drawing a
  // flat line that would read as "your position did not move".
  expect(html).not.toContain("lv-chart-svg");
  expect(html).toContain("2 dagen transactiegeschiedenis");
  expect(html).toContain("Nog geen week geschiedenis");
  expect(html).toContain("Nog geen maand geschiedenis");
  // And no 0% pill anywhere.
  expect(html).not.toContain("delta-flat");
});

test("SaldoBlock shows a dash and an instruction with no accounts at all", () => {
  const html = renderToStaticMarkup(
    <SaldoBlock accounts={[]} txs={[]} scheduledFlows={[]} asOf={ASOF} onNavigate={() => {}} />,
  );
  expect(html).toContain("—");
  expect(html).toContain("Importeer een bestand of vul saldo"); // apostrophe is HTML-escaped
  expect(html).not.toContain("beschikbaar na BTW-reservering");
  expect(html).toContain("Nog geen transacties op de rekeningen met een saldo");
});

test("positionSeries walks today's position back through the transactions", () => {
  const s = positionSeries(accounts, txs, ASOF);
  expect(s.current).toBe(KNOWN_SUM);
  expect(s.excluded).toBe(1); // A3 has no saldo and is left out of both sides
  // 30-day window, so 31 daily points ending on asOf.
  expect(s.points).toHaveLength(31);
  expect(s.points[s.points.length - 1]).toEqual({ date: ASOF, value: KNOWN_SUM });
  expect(s.points[0].date).toBe("2026-07-17");
  expect(s.weekAgo).toBe(KNOWN_SUM + 1_100);
  expect(s.monthAgo).toBe(KNOWN_SUM + 1_350);
  // The step down happens on the day t6 landed, not before it.
  const at = (d: string) => s.points.find((p) => p.date === d)?.value;
  expect(at("2026-08-10")).toBe(KNOWN_SUM + 1_100);
  expect(at("2026-08-11")).toBe(KNOWN_SUM);
});

test("positionSeries stops at the oldest transaction and reports no comparison", () => {
  const s = positionSeries(freshAccounts, freshTxs, ASOF);
  expect(s.coverageDays).toBe(2);
  expect(s.points[0].date).toBe("2026-08-14");
  expect(s.weekAgo).toBeNull();
  expect(s.monthAgo).toBeNull();
});

test("positionSeries returns no history at all when nothing is imported", () => {
  const s = positionSeries([], [], ASOF);
  expect(s.points).toEqual([]);
  expect(s.coverageDays).toBe(0);
  expect(s.weekAgo).toBeNull();
});

test("changePct is null rather than 0% when there is nothing to compare against", () => {
  expect(changePct(100, null)).toBeNull();
  expect(changePct(100, 0)).toBeNull();
  expect(changePct(110, 100)).toBeCloseTo(10, 6);
  // A negative starting position still moves in the direction the money did.
  expect(changePct(-50, -100)).toBeCloseTo(50, 6);
});

test("coverage is the SHORTEST-covered account, so one fresh import cannot unlock a month's comparison", () => {
  // One account with a long history, one imported yesterday. The union reaches
  // back far enough; the newcomer does not. Rolling 30 days back would treat
  // the new account's balance as if it had been constant all month.
  const old = { key: "abn", iban: "", name: "ABN", bank: "ABN AMRO", entity: "BV1", currency: "EUR", balance: 1_000 } as never;
  const fresh = { key: "amex", iban: "", name: "Amex", bank: "American Express", entity: "BV1", currency: "EUR", balance: 500 } as never;
  const history = [
    { id: "a1", accountKey: "abn", date: "2026-07-01", amount: -10, currency: "EUR", counterparty: "X", description: "", category: "", manual: false },
    { id: "a2", accountKey: "abn", date: "2026-08-10", amount: -10, currency: "EUR", counterparty: "X", description: "", category: "", manual: false },
    { id: "b1", accountKey: "amex", date: "2026-08-15", amount: -10, currency: "EUR", counterparty: "Y", description: "", category: "", manual: false },
  ] as never[];

  const s = positionSeries([old, fresh], history, "2026-08-16");

  expect(s.coverageDays).toBe(1); // Amex, not ABN's six weeks
  expect(s.limitedBy).toEqual(["amex"]);
  expect(s.weekAgo).toBeNull(); // never a number the data cannot support
  expect(s.monthAgo).toBeNull();
});

test("an account with a saldo but no transactions blocks the comparison rather than being assumed flat", () => {
  const typed = { key: "amex", iban: "", name: "Amex", bank: "American Express", entity: "BV1", currency: "EUR", balance: 500 } as never;
  const banked = { key: "abn", iban: "", name: "ABN", bank: "ABN AMRO", entity: "BV1", currency: "EUR", balance: 1_000 } as never;
  const history = [
    { id: "a1", accountKey: "abn", date: "2026-06-01", amount: -10, currency: "EUR", counterparty: "X", description: "", category: "", manual: false },
    { id: "a2", accountKey: "abn", date: "2026-08-10", amount: -10, currency: "EUR", counterparty: "X", description: "", category: "", manual: false },
  ] as never[];

  // "No movements" and "not imported" are indistinguishable from here, so the
  // typed balance is not treated as having been constant for a month.
  const s = positionSeries([typed, banked], history, "2026-08-16");
  expect(s.coverageDays).toBe(0);
  expect(s.limitedBy).toEqual(["amex"]);
  expect(s.monthAgo).toBeNull();
});

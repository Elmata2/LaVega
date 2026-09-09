import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { categorize } from "@lavega/core";
import { formatEuro } from "../../format.js";
import StatistiekBlock, { customWindow, STAT_PERIODS } from "./StatistiekBlock";
import { freshTxs, own, rules, txs } from "./fixtures";

/** Today's default and every existing test's mode: a non-EUR row is left out
 *  exactly as it always was, never converted. */
const SEPARATE = { fxHistory: {}, mode: "separate" as const };

const render = (t = txs) =>
  renderToStaticMarkup(
    <StatistiekBlock txs={t} rules={rules} own={own} onSelectCategory={() => {}} {...SEPARATE} />,
  );

test("StatistiekBlock leads with the per-category-per-month view from the reference", () => {
  const html = render();
  expect(html).toContain("Statistieken");
  // Both reference views are offered.
  expect(html).toContain("Categorieën");
  expect(html).toContain("Weekdagen");
  // Grouped bars: three months of fixture data × three spend categories.
  expect(html).toContain('class="lv-bars-xaxis"');
  expect(html).toContain(">jun<");
  expect(html).toContain(">jul<");
  expect(html).toContain(">aug<");
  expect(html.match(/class="lv-bar"/g)?.length).toBe(9);
  // The categories are the ones the rules engine derived, not invented labels.
  expect(html).toContain("Inkoop"); // manual label on t3/t6
  expect(html).toContain("Energie"); // user rule on t5
  expect(html).toContain(categorize(txs[1], rules, own)); // Dutch default on t2
});

test("StatistiekBlock offers his five periods plus a real custom range", () => {
  const html = render();
  expect(STAT_PERIODS.map((p) => p.label)).toEqual([
    "1 week",
    "1 maand",
    "3 maanden",
    "6 maanden",
    "12 maanden",
    "Aangepast",
  ]);
  for (const p of STAT_PERIODS) expect(html).toContain(`>${p.label}<`);
  // "Aangepast" is not selected, so its two date fields are not on screen yet.
  expect(html).not.toContain('type="date"');
});

test("customWindow refuses to turn half a range into a window", () => {
  expect(customWindow("2026-06-01", "2026-08-01")).toEqual({
    start: "2026-06-01",
    end: "2026-08-01",
  });
  // A single day is a legitimate range; an empty field or a backwards range is
  // not a window at all — and is never quietly replaced by a preset.
  expect(customWindow("2026-06-01", "2026-06-01")).toEqual({
    start: "2026-06-01",
    end: "2026-06-01",
  });
  expect(customWindow("", "2026-08-01")).toBeNull();
  expect(customWindow("2026-06-01", "")).toBeNull();
  expect(customWindow("2026-08-01", "2026-06-01")).toBeNull();
});

test("StatistiekBlock states the window every figure in it belongs to", () => {
  const html = render();
  // The default is twelve calendar months, ending at the newest transaction —
  // and the block says where the data actually starts rather than implying it
  // has a year of it.
  expect(html).toContain("1 sep 2025 – 11 aug 2026");
  expect(html).toContain("gegevens vanaf 9 jun 2026");
  expect(html).toContain("Inkomsten in deze periode");
  expect(html).toContain("Uitgaven in deze periode");
  expect(html).toContain(formatEuro(12_000 + 9_500));
  expect(html).toContain(formatEuro(420.5 + 1_880 + 250 + 1_100));
});

test("StatistiekBlock carries no note line under it any more", () => {
  const html = render();
  // The footer explaining what Δ meant is gone (UI review round 2) — with it
  // went the per-month averages it was explaining.
  expect(html).not.toContain("module-foot");
  expect(html).not.toContain("Δ = ");
  expect(html).not.toContain("Gem. inkomsten p/m");
});

test("the 'smaller categories' line names the window and the floor it is true for", () => {
  // Nothing is under core's floor in the plain fixture, so nothing is claimed.
  const html = render();
  expect(html).not.toContain("kleinere categorie");

  const many = [
    ...txs,
    {
      ...txs[1],
      id: "m1",
      date: "2026-08-04",
      amount: -40,
      counterparty: "NS",
      description: "Trein",
    },
    {
      ...txs[1],
      id: "m2",
      date: "2026-08-05",
      amount: -30,
      counterparty: "Apotheek",
      description: "Zorg",
    },
    {
      ...txs[1],
      id: "m3",
      date: "2026-08-06",
      amount: -20,
      counterparty: "Bioscoop",
      description: "Film",
    },
  ];
  // Three small ones, each under core's window-scaled floor: the line names the
  // window it is true for, the floor, and that a shorter window moves it.
  const html2 = render(many);
  expect(html2).toContain("3 kleinere categorieën niet getoond in 9 jun – 11 aug 2026");
  expect(html2).toContain(`elk onder ${formatEuro((25 * 64) / 30)} over deze 64 dagen`);
  expect(html2).toContain("Een kortere periode legt die grens lager.");
});

test("only-small spending is reported as small, not as no spending at all", () => {
  // Five euros spread over sixty-four days: under core's floor for this window,
  // so nothing is charted — and an empty chart must not be captioned "geen
  // uitgaven in deze periode", which would be false.
  const tiny = [
    { ...txs[1], id: "tiny1", date: "2026-06-09", amount: -3, counterparty: "Kiosk" },
    { ...txs[1], id: "tiny2", date: "2026-08-11", amount: -2, counterparty: "Kiosk" },
  ];
  const html = render(tiny);
  expect(html).toContain("Alleen kleine uitgaven in deze periode");
  expect(html).toContain(formatEuro(5));
  expect(html).toContain(`elk onder ${formatEuro((25 * 64) / 30)} over deze 64 dagen`);
  expect(html).not.toContain("Geen uitgaven in deze periode");
});

test("StatistiekBlock never draws a month it has no statement for", () => {
  // The default period is twelve months but the fixture holds three, so the
  // axis has three groups — nine empty ones would be nine bars of zero, i.e. a
  // claim that nothing was spent in a month we never saw.
  const html = render();
  expect(html.match(/<span title="[^"]*">/g)?.length).toBeLessThanOrEqual(12);
  expect(html).not.toContain(">mei<");
  expect(html).not.toContain(">jan<");
});

test("StatistiekBlock renders an empty state instead of a chart with no transactions", () => {
  const html = render([]);
  expect(html).toContain("Nog geen transacties");
  expect(html).not.toContain("lv-bar");
});

test("StatistiekBlock names what it left out for being in a foreign currency", () => {
  const revolutHufSpend = {
    ...txs[0],
    id: "rHUF",
    accountKey: "A1",
    date: "2026-08-05",
    amount: -300_000,
    currency: "HUF",
    counterparty: "Bolt Budapest",
    description: "Taxi",
  };
  const html = render([...txs, revolutHufSpend]);
  expect(html).toContain("Buiten deze cijfers: 1 transactie in vreemde valuta (HUF 300.000).");
});

test("StatistiekBlock says nothing about foreign currency when there is none excluded", () => {
  const html = render();
  expect(html).not.toContain("vreemde valuta");
});

test("StatistiekBlock still renders with two days of history", () => {
  // The weekday view is the one that refuses (see statistics.test.ts); the
  // block itself must not crash on a nearly-empty vault.
  const html = render(freshTxs);
  expect(html).toContain("Statistieken");
});

/* ───────────────────────── FX-omrekening: convert versus separate */

const hufSpend = {
  ...txs[0],
  id: "rHUF",
  accountKey: "A1",
  date: "2026-08-05",
  amount: -300_000,
  currency: "HUF",
  counterparty: "Bolt Budapest",
  description: "Taxi",
};
const HUF_RATE = { HUF: { "2026-08-05": 400 } };

test("StatistiekBlock: convert mode with 300.000 HUF at 400 HUF/EUR drops the 'vreemde valuta' line and shows the one-time ECB note", () => {
  const html = renderToStaticMarkup(
    <StatistiekBlock
      txs={[...txs, hufSpend]}
      rules={rules}
      own={own}
      onSelectCategory={() => {}}
      fxHistory={HUF_RATE}
      mode="convert"
    />,
  );
  expect(html).not.toContain("vreemde valuta");
  expect(html).toContain("Vreemde valuta omgerekend via ECB-koers van de dag.");
  // 750 EUR extra uitgave: 420,50 + 1.880 + 250 + 1.100 + 750.
  expect(html).toContain(formatEuro(420.5 + 1_880 + 250 + 1_100 + 750));
});

test("StatistiekBlock: convert mode with no known rate keeps the row out, worded 'nog geen koers' rather than the separate-mode wording", () => {
  const html = renderToStaticMarkup(
    <StatistiekBlock
      txs={[...txs, hufSpend]}
      rules={rules}
      own={own}
      onSelectCategory={() => {}}
      fxHistory={{}}
      mode="convert"
    />,
  );
  expect(html).toContain("Buiten deze cijfers: 1 transactie, nog geen koers (HUF 300.000).");
  expect(html).not.toContain("in vreemde valuta (HUF");
  expect(html).not.toContain("Vreemde valuta omgerekend via ECB-koers van de dag.");
});

test("StatistiekBlock: separate mode reproduces exactly today's wording even when a rate is available", () => {
  const html = renderToStaticMarkup(
    <StatistiekBlock
      txs={[...txs, hufSpend]}
      rules={rules}
      own={own}
      onSelectCategory={() => {}}
      fxHistory={HUF_RATE}
      mode="separate"
    />,
  );
  expect(html).toContain("Buiten deze cijfers: 1 transactie in vreemde valuta (HUF 300.000).");
  expect(html).not.toContain("nog geen koers");
  expect(html).not.toContain("Vreemde valuta omgerekend via ECB-koers van de dag.");
});

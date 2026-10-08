// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Account } from "@lavega/core";
import { forecastCashflow } from "@lavega/core";
import Forecast from "./Forecast";

/* App review 2, 20 August: "remove the Forecast explainer about the
 * deterministic 13-week forecast, and the notes."
 *
 * Both blocks were true and both were defensible — the footnote answered "no ML,
 * every figure can be redone by hand" and the notes answered "prove you forecast
 * better than my spreadsheet". He has read them; they now cost a screen and earn
 * nothing. The chart, the banner, the drivers and the "gestopt" list all stay,
 * because those carry numbers rather than explain them.
 *
 * `coverageNotes` itself stays in forecast-view.ts with its own unit tests: the
 * derivation is still correct and still cheap, and it is the obvious input for a
 * hover or a disclosure later. Only the rendering is gone. */

/* Same bug forecast.ts had directly: a HUF balance must never enter the chart
 * at its raw face value. No txs, so every weekly point stays flat at the
 * opening — the last point's readout is the opening itself either way. */

test("a HUF balance shows its converted euro value in convert mode, and no position at all in separate mode", () => {
  const hufAccounts: Account[] = [
    {
      key: "H1",
      iban: "H1",
      name: "Buda",
      bank: "OTP",
      entity: "Prive",
      currency: "HUF",
      balance: 300_000,
    },
  ];
  const fxHistory = { HUF: { "2026-12-28": 400 } };

  // Sanity on the engine itself first: 300.000 HUF / 400 = €750.
  const converted = forecastCashflow([], hufAccounts, {
    asOf: "2026-12-28",
    fxHistory,
    mode: "convert",
  }).consolidated;
  expect(converted.openingCents).toBe(75_000);

  const convertHtml = renderToStaticMarkup(
    <Forecast
      txs={[]}
      accounts={hufAccounts}
      entityScope=""
      asOf="2026-12-28"
      bufferCents={0}
      scheduledFlows={[]}
      fxHistory={fxHistory}
      mode="convert"
    />,
  );
  expect(convertHtml).toContain("€750"); // never "€300.000"
  expect(convertHtml).not.toContain("300.000");

  const separateHtml = renderToStaticMarkup(
    <Forecast
      txs={[]}
      accounts={hufAccounts}
      entityScope=""
      asOf="2026-12-28"
      bufferCents={0}
      scheduledFlows={[]}
      fxHistory={fxHistory}
      mode="separate"
    />,
  );
  expect(separateHtml).toContain("Positie onbekend"); // excluded, not a raw or zero balance
  expect(separateHtml).not.toContain("€750");
});

// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { Account, CatalogValue, CatalogueEntryLike, LearnedFact } from "@lavega/core";
import { makeFact, planTravel, TRAVEL_AGENT } from "@lavega/core";
import TravelBlock, { type TravelBlockProps } from "./TravelBlock";
import { ASOF } from "./fixtures";

/* Amounts that describe spending or withdrawing ABROAD follow the destination
 * currency (display layer only, converted from core's euro figures at the rate
 * the app already holds: the vault's ECB reference history). What the card
 * charges in euro regardless (Kaartkosten) stays in euro. */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  try {
    sessionStorage.clear();
  } catch {
    /* no storage */
  }
});
beforeEach(() => {
  document.cookie = "lavega_locale=nl; Path=/";
});

const accounts: Account[] = [
  {
    key: "ing",
    iban: "NL01INGB0001",
    name: "Zakelijk",
    bank: "ING",
    entity: "Holding BV",
    currency: "EUR",
    balance: 4_000,
    type: "Betaalrekening",
  },
  {
    key: "rev",
    iban: "LT01REVO0001",
    name: "Reisgeld",
    bank: "Revolut",
    entity: "Privé",
    currency: "EUR",
    balance: 100,
    type: "Betaalrekening",
  },
];
const fact = (subject: string, key: string, value: string): LearnedFact =>
  makeFact({ agent: TRAVEL_AGENT, subject, key, value, source: "agent", updatedAt: "2026-08-01" });
const FACTS = [
  fact("ING betaalpas", "fxFeePct", "1.4"),
  fact("Revolut betaalpas", "fxFeePct", "1"),
];

const feeField = (value: number): CatalogValue =>
  ({
    value,
    period: "maand",
    route: "provider-page",
    sourceUrl: "https://example.test/tarieven",
    checkedAt: "2026-08-01",
    conditions: null,
    conditionsKnown: true,
  }) as unknown as CatalogValue;

const CATALOGUE: CatalogueEntryLike[] = [
  {
    id: "ing-betaalpas",
    product: "ING betaalpas",
    issuer: "ING Bank N.V.",
    kind: "betaalpas",
    fields: {
      fxFeePct: {
        value: 1.4,
        route: "agent",
        sourceUrl: "https://assets.ing.com/kosten.pdf",
        checkedAt: "2026-06-15",
        conditionsKnown: true,
        conditions:
          "Geldt bij betalen in vreemde valuta; bij geldopname in vreemde valuta geldt een apart tarief (€ 3,50 + 1,40%).",
      },
    },
  },
  {
    id: "licht",
    product: "Testkaart Licht",
    issuer: "Lichtbank N.V.",
    kind: "betaalpas",
    fields: {
      fxFeePct: {
        value: 0,
        route: "provider-page",
        sourceUrl: "https://example.test/tarieven",
        checkedAt: "2026-08-01",
        conditionsKnown: true,
        conditions: "Opslag buiten de euro.",
      },
      accountFee: feeField(1),
    },
  },
];

const props: TravelBlockProps = {
  accounts,
  txs: [],
  rates: [],
  facts: FACTS,
  catalogue: CATALOGUE,
  asOf: ASOF,
  homeCountry: "NL",
  homeCountryChosen: true,
  busy: false,
  aiAvailable: false,
  onRefreshTerms: () => {},
  onRecheckAi: () => {},
  onCorrectFact: () => {},
  onNavigate: () => {},
};

const RATE_DATE = "2026-08-14"; // a Friday before ASOF (Sunday): the rate walks back
const FX = { NZD: { [RATE_DATE]: 1.85 }, JPY: { [RATE_DATE]: 170 }, USD: { [RATE_DATE]: 1.15 } };

function setSelect(el: HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}
function render(destination: string, over: Partial<TravelBlockProps> = {}): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<TravelBlock {...props} {...over} />);
  });
  act(() => setSelect(container!.querySelector("select")!, destination));
  return container;
}
const text = (el: HTMLElement, sel: string) =>
  (el.querySelector(sel)?.textContent ?? "").replace(/ /g, " ");
const switchButtons = (el: HTMLElement) => [
  ...el.querySelectorAll<HTMLButtonElement>(".travel-ccy button"),
];
const nums = (s: string): number[] =>
  (s.match(/\d[\d.,]*/g) ?? []).map((n) => Number(n.replace(/\./g, "").replace(",", ".")));
const plan = (destination: string) =>
  planTravel({
    accounts,
    txs: [],
    rates: [],
    facts: FACTS,
    destination,
    asOf: ASOF,
    catalogue: CATALOGUE,
  });

test("NZ with a rate: the foreground lines are in NZD, Kaartkosten stays in euro", () => {
  const el = render("NZ", { fxHistory: FX });
  const pay = text(el, ".travel-winner-headline");
  expect(pay).toContain("NZ$");
  expect(pay).not.toContain("€");
  expect(pay).toMatch(/^Open Testkaart Licht: ≈NZ\$ /);
  const pin = text(el, ".travel-winner-pin");
  expect(pin).toContain("NZ$");
  expect(pin).not.toContain("€");
  // The small-withdrawal warning is an amount abroad too.
  expect(text(el, '[data-testid="travel-pin-caution"]')).toContain("NZ$");
  // What the card charges in euro does not move.
  const kosten = text(el, '[data-testid="travel-pay-kosten"]');
  expect(kosten).toContain("€");
  expect(kosten).not.toContain("NZ$");
  // The reference note in the fold follows the destination.
  expect(text(el, ".toonmeer-regel .travel-reference, .toonmeer-regel")).toContain("NZ$");
});

test("the converted figures are the euro figures from core times the rate", () => {
  const p = plan("NZ");
  const el = render("NZ", { fxHistory: FX });
  const pay = nums(text(el, ".travel-winner-headline"));
  // "Open X: ≈NZ$ {saving} minder dan met je Y op ≈NZ$ {reference}."
  expect(pay).toContain(Math.round(p.pay!.savingOnReference! * 1.85 * 100) / 100);
  expect(pay).toContain(Math.round(1000 * 1.85));
  const pin = nums(text(el, ".travel-winner-pin"));
  expect(pin).toContain(Math.round(p.withdrawAdvice!.costOnReference! * 1.85 * 100) / 100);
});

test("switching to EUR restores today's exact strings", () => {
  const euro = render("NZ", { fxHistory: {} });
  const want = [
    ".travel-winner-headline",
    ".travel-winner-pin",
    '[data-testid="travel-pin-caution"]',
  ].map((s) => text(euro, s));
  act(() => root!.unmount());
  container!.remove();

  const el = render("NZ", { fxHistory: FX });
  const [nzd, eur] = switchButtons(el);
  expect(nzd.textContent).toBe("NZD");
  expect(eur.textContent).toBe("EUR");
  expect(nzd.getAttribute("aria-pressed")).toBe("true");
  act(() => eur.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(switchButtons(el)[1].getAttribute("aria-pressed")).toBe("true");
  const got = [
    ".travel-winner-headline",
    ".travel-winner-pin",
    '[data-testid="travel-pin-caution"]',
  ].map((s) => text(el, s));
  expect(got).toEqual(want);
  expect(got[0]).not.toContain("≈");
});

test("the choice is remembered for the session", () => {
  const el = render("NZ", { fxHistory: FX });
  act(() => switchButtons(el)[1].dispatchEvent(new MouseEvent("click", { bubbles: true })));
  act(() => root!.unmount());
  container!.remove();
  const again = render("NZ", { fxHistory: FX });
  expect(switchButtons(again)[1].getAttribute("aria-pressed")).toBe("true");
});

test("the switch is a labelled, keyboard-reachable control", () => {
  const el = render("NZ", { fxHistory: FX });
  const group = el.querySelector(".travel-ccy")!;
  expect(group.getAttribute("role")).toBe("group");
  expect(group.getAttribute("aria-label")).toBe("Bedragen tonen in");
  for (const b of switchButtons(el)) {
    expect(b.tagName).toBe("BUTTON");
    expect(b.getAttribute("type")).toBe("button");
    expect(b.tabIndex).toBeGreaterThanOrEqual(0);
  }
});

test("JPY renders without decimals", () => {
  const el = render("JP", { fxHistory: FX });
  const pay = text(el, ".travel-winner-headline");
  expect(pay).toContain("¥");
  // No decimal comma anywhere in a yen figure.
  expect(pay).not.toMatch(/¥\s?\d[\d.]*,\d/);
  expect(nums(pay)).toContain(170_000);
});

test("no rate for the destination: euro only, no switch, nothing claims a conversion", () => {
  const el = render("NZ", { fxHistory: { JPY: FX.JPY } });
  expect(switchButtons(el)).toHaveLength(0);
  expect(text(el, ".travel-winner")).not.toContain("NZ$");
  expect(text(el, ".travel-winner")).not.toContain("≈");
  expect(text(el, ".travel-winner")).not.toContain("omgerekend");
  const none = render("NZ", {});
  expect(switchButtons(none)).toHaveLength(0);
});

test("a stale rate (older than the ECB gap rule allows) counts as no rate", () => {
  const el = render("NZ", { fxHistory: { NZD: { "2026-06-01": 1.85 } } });
  expect(switchButtons(el)).toHaveLength(0);
  expect(text(el, ".travel-winner")).not.toContain("NZ$");
});

test("a euro country has no switch and no conversion", () => {
  const el = render("DE", { fxHistory: FX });
  expect(switchButtons(el)).toHaveLength(0);
  expect(text(el, ".travel-winner")).not.toContain("≈");
});

test("the i says the amounts are converted, with the real rate date, only in converted mode", () => {
  const el = render("NZ", { fxHistory: FX });
  const why = text(el, ".travel-winner-name .toonmeer-panel");
  expect(why).toContain("Bedragen omgerekend naar NZD tegen de ECB-koers van");
  expect(why).toContain("14 aug");
  expect(why).toContain("je kaart rekent zelf in euro af");
  act(() => switchButtons(el)[1].dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(text(el, ".travel-winner")).not.toContain("omgerekend");
});

const words = (s: string, names: string[]) =>
  names
    .reduce((acc, n) => acc.split(n).join("X"), s)
    .trim()
    .split(/\s+/).length;

test("the 12-word rule holds in both modes, nl and en", () => {
  const names = [
    "Testkaart Licht",
    "ING betaalpas",
    "Revolut betaalpas",
    "ING debit card",
    "Revolut debit card",
  ];
  for (const locale of ["nl", "en"]) {
    document.cookie = `lavega_locale=${locale}; Path=/`;
    const el = render("NZ", { fxHistory: FX });
    for (const mode of [0, 1]) {
      if (mode === 1)
        act(() => switchButtons(el)[1].dispatchEvent(new MouseEvent("click", { bubbles: true })));
      for (const s of [".travel-winner-headline", ".travel-winner-pin"]) {
        expect(words(text(el, s), names), `${locale} ${mode} ${s}`).toBeLessThanOrEqual(12);
      }
    }
    act(() => root!.unmount());
    container!.remove();
    root = null;
  }
});

test("english: the label and the converted line", () => {
  document.cookie = "lavega_locale=en; Path=/";
  const el = render("NZ", { fxHistory: FX });
  expect(el.querySelector(".travel-ccy")!.getAttribute("aria-label")).toBe("Show amounts in");
  expect(text(el, ".travel-winner-headline")).toMatch(/^Open Testkaart Licht: ≈NZ\$/);
  expect(text(el, ".travel-winner-name .toonmeer-panel")).toContain(
    "Amounts converted to NZD at the ECB rate of",
  );
});

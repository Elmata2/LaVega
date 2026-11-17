// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { BUSINESS_SAVINGS_OFFERS, ownAccounts, type BusinessSavingsOffer } from "@lavega/core";
import Optimalisatie from "./views/Optimalisatie";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const echteFetch = globalThis.fetch;
beforeAll(() => {
  globalThis.fetch = (() => Promise.resolve({ ok: false } as Response)) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = echteFetch;
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

/** The offer while the 5,25% window was open. The bundled list dropped that
 *  closed promo on 2026-11-16; a test that wants the promo branch supplies it. */
const promoOffer: BusinessSavingsOffer = {
  ...(BUSINESS_SAVINGS_OFFERS[0] as BusinessSavingsOffer),
  promo: {
    ratePct: 5.25,
    newCustomersOnly: true,
    signupFrom: "2026-09-15",
    signupUntil: "2026-11-15",
    durationMonths: 3,
    capAmount: 100_000,
  },
};

function render(
  entityScope: "personal" | "business",
  asOf: string,
  businessOffers?: readonly BusinessSavingsOffer[],
): string {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <Optimalisatie
        txs={[]}
        accounts={[]}
        rules={[]}
        own={ownAccounts([])}
        asOf={asOf}
        busy={false}
        facts={[]}
        entityScope={entityScope}
        businessOffers={businessOffers}
        onRateCommit={() => {}}
      />,
    );
  });
  return host.textContent ?? "";
}

test("Zakelijk before the deadline shows an open promo, plan range, source and check date", () => {
  const text = render("business", "2026-10-15", [promoOffer]);
  expect(text).toContain("Revolut");
  expect(text).toContain(
    "5,25% actierente voor nieuwe klanten die zich aanmelden tot en met 15-11-2026: 3 maanden, over de eerste €100.000. Daarna 1,25–2,50%, afhankelijk van je Revolut-abonnement.",
  );
  expect(text).toContain("1,25–2,50%");
  expect(text).toContain("gecontroleerd op 16-11-2026");
  expect(
    host!.querySelector('a[href="https://www.revolut.com/en-NL/business/savings/"]'),
  ).not.toBeNull();
});

test("Zakelijk shows plan rates only when the bundled promo window has closed", () => {
  // The closed 5,25% action is gone from the data, so no injected client can
  // pull it back on screen. The check date moved with the 2026-11-16 re-read.
  const text = render("business", "2026-11-16");
  expect(text).toContain("Revolut");
  expect(text).toContain("1,25–2,50% afhankelijk van je abonnement");
  expect(text).toContain("gecontroleerd op 16-11-2026");
  expect(text).not.toContain("5,25");
});

test("Particulier shows no business savings", () => {
  const text = render("personal", "2026-10-15");
  expect(text).not.toContain("Business Savings");
});

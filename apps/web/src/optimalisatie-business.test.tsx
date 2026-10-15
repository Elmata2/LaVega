// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, expect, test } from "vitest";
import { ownAccounts } from "@lavega/core";
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

function render(entityScope: "personal" | "business", asOf: string): string {
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
        onRateCommit={() => {}}
      />,
    );
  });
  return host.textContent ?? "";
}

test("Zakelijk before the deadline shows the promo, plan range, source and check date", () => {
  const text = render("business", "2026-10-15");
  expect(text).toContain("Revolut");
  expect(text).toContain(
    "5,25% actierente voor nieuwe klanten die zich aanmelden tot en met 15-11-2026: 3 maanden, over de eerste €100.000. Daarna 1,25–2,50%, afhankelijk van je Revolut-abonnement.",
  );
  expect(text).toContain("1,25–2,50%");
  expect(text).toContain("gecontroleerd op 15-10-2026");
  expect(
    host!.querySelector('a[href="https://www.revolut.com/en-NL/business/savings/"]'),
  ).not.toBeNull();
});

test("Zakelijk after the deadline shows plan rates and no 5,25%", () => {
  const text = render("business", "2026-11-16");
  expect(text).toContain("Revolut");
  expect(text).toContain("1,25–2,50%");
  expect(text).not.toContain("5,25");
});

test("Particulier shows no business savings", () => {
  const text = render("personal", "2026-10-15");
  expect(text).not.toContain("Business Savings");
});

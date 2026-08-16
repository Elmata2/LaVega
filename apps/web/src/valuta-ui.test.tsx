// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { Account, LearnedFact } from "@lavega/core";
import { FX_RATE_FALLBACK, TRAVEL_AGENT, makeFact, productOf } from "@lavega/core";
import Valuta from "./views/Valuta";

/* Valuta rebuilt as the reference's "Transfer money" block.
 *
 * The rule under test is the one that makes the number trustworthy: what
 * ARRIVES is only shown when the cost of getting it there is known. With no
 * learned card terms the mid-market amount is NOT promoted to "what arrives" —
 * an unknown fee is not zero. */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

const ACCOUNTS: Account[] = [
  { key: "NL01ING", iban: "NL01ING", name: "Betaalrekening", bank: "ING", entity: "Prive", currency: "EUR", balance: 5000 },
  { key: "REV1", iban: "", name: "Revolut", bank: "Revolut", entity: "Prive", currency: "EUR", balance: 1200 },
];

/** Card terms as the travel agent stores them: keyed on the PRODUCT, which is
 *  what `rankJourneys` looks up. */
function terms(pct: Record<string, number>): LearnedFact[] {
  return Object.entries(pct).map(([subject, value]) =>
    makeFact({ agent: TRAVEL_AGENT, subject, key: "fxFeePct", value: String(value), source: "agent", updatedAt: "2026-08-16" }),
  );
}

const usd = (n: number) =>
  new Intl.NumberFormat("nl-NL", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n);

beforeEach(() => {
  // The view fetches a live rate on mount; keep the test on the offline
  // snapshot so the arithmetic below is deterministic.
  (globalThis as unknown as { fetch: typeof fetch }).fetch = (async () => ({
    ok: false,
    status: 503,
    json: async () => null,
  })) as unknown as typeof fetch;
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function render(facts: LearnedFact[] = []) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<Valuta accounts={ACCOUNTS} facts={facts} />);
  });
  return container;
}

function click(el: Element) {
  act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function arrives(): string {
  return (container!.querySelector('[data-testid="arrives"]') as HTMLElement).textContent ?? "";
}

test("the transfer block renders both legs, an amount and two currency pills", () => {
  const c = render();
  expect(c.querySelector('[aria-label="Van rekening"]')).not.toBeNull();
  expect(c.querySelector('[aria-label="Naar rekening"]')).not.toBeNull();
  expect((c.querySelector('[aria-label="Bedrag"]') as HTMLInputElement).value).toBe("1000");
  expect(c.querySelector('[aria-label="Van valuta"]')).not.toBeNull();
  expect(c.querySelector('[aria-label="Naar valuta"]')).not.toBeNull();
  expect(c.querySelector('[aria-label="Wissel van en naar"]')).not.toBeNull();
  // Both of his accounts are offerable as a leg.
  expect(c.textContent).toContain("ING");
  expect(c.textContent).toContain("Revolut");
});

test("with no known card terms, what arrives is 'onbekend' — never the mid-market amount", () => {
  const c = render();
  const mid = 1000 * FX_RATE_FALLBACK.rates.USD;

  expect(arrives()).toBe("onbekend");
  expect(c.textContent).toContain("Wat er aankomt is onbekend");
  expect(c.textContent).toContain("rekent een onbekende kostenpost niet als nul");
  // The market value is still shown, but only as market value — it is not the
  // figure in the "naar" leg.
  expect(c.textContent).toContain(usd(mid));
  expect(arrives()).not.toContain(usd(mid));
  // Unknown routes are listed, and listed as unknown.
  expect(c.querySelectorAll(".travel-journey-unknown").length).toBeGreaterThan(0);
});

test("with known terms the arriving amount is the mid-market amount minus the best route's cost", () => {
  const c = render(terms({ [productOf(ACCOUNTS[0])]: 2, [productOf(ACCOUNTS[1])]: 0.5 }));
  const mid = 1000 * FX_RATE_FALLBACK.rates.USD;

  // Revolut is the cheaper of the two he holds: 0,5%.
  expect(arrives()).toBe(usd(mid * (1 - 0.005)));
  expect(c.textContent).toContain("Je beste eigen route kost 0,5%");
  // The winner is marked, and it is the cheap one.
  const best = c.querySelector(".travel-journey-best");
  expect(best?.textContent).toContain("Revolut");
});

test("the info button explains that this is the best his OWN cards allow, and what would beat it", () => {
  const c = render(terms({ [productOf(ACCOUNTS[0])]: 2, [productOf(ACCOUNTS[1])]: 0.5 }));
  expect(c.querySelector(".info-panel")).toBeNull();

  click(c.querySelector('[aria-label="Uitleg bij dit bedrag"]')!);
  const panel = c.querySelector(".info-panel")!;
  expect(panel.textContent).toContain("Dit is het beste dat je eigen kaarten toelaten");
  expect(panel.textContent).toContain("Elke aanbieder die minder dan 0,5% rekent");
  // It never claims to know a provider he does not hold.
  expect(panel.textContent).toContain("een aanbieder die je niet hebt, staat hier niet in");

  click(c.querySelector('[aria-label="Uitleg bij dit bedrag"]')!);
  expect(c.querySelector(".info-panel")).toBeNull();
});

test("with unknown terms the info panel refuses to say whether switching pays", () => {
  const c = render();
  click(c.querySelector('[aria-label="Uitleg bij dit bedrag"]')!);
  const panel = c.querySelector(".info-panel")!;
  expect(panel.textContent).toContain("Een onbekend tarief is geen 0%");
  expect(panel.textContent).not.toContain("Elke aanbieder die minder dan");
});

// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { Account, CatalogueEntryLike, LearnedFact } from "@lavega/core";
import { FX_RATE_FALLBACK, TRAVEL_AGENT, makeFact, productOf } from "@lavega/core";
import Valuta from "./views/Valuta";

/* Valuta as the 20 August review asked for it.
 *
 * Two things are under test, and they are the two complaints:
 *   - ONE ROW PER BANK. "Just show one ING." The catalogue holds three ING cards;
 *     the screen shows ING once, and says which product the figure belongs to.
 *   - EVERY BANK, best first, with the difference in euros — but the amount that
 *     ARRIVES is priced on a route he can actually use. A bank he does not hold
 *     is listed and marked, never silently chosen.
 *
 * And the rule that survives from the first build: an unknown cost is not zero.
 * With no establishable figure, "wat er aankomt" stays "onbekend" and the
 * mid-market amount is labelled as market value. */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

const ACCOUNTS: Account[] = [
  { key: "NL01ING", iban: "NL01ING", name: "Betaalrekening", bank: "ING", entity: "Prive", currency: "EUR", balance: 5000 },
  { key: "REV1", iban: "", name: "Revolut", bank: "Revolut", entity: "Prive", currency: "EUR", balance: 1200 },
];

/** A covered catalogue figure: value, source, date AND conditions. */
function card(id: string, product: string, issuer: string, pct: number): CatalogueEntryLike {
  return {
    id,
    product,
    issuer,
    kind: "betaalpas",
    fields: {
      fxFeePct: {
        value: pct,
        route: "provider-pdf" as never,
        sourceUrl: `https://example.test/${id}`,
        checkedAt: "2026-06-15",
        conditions: "koersopslag bij betalen in vreemde valuta",
        conditionsKnown: true,
      },
    },
  };
}

/** Three ING cards, a Revolut card, and the cheapest thing on the market that he
 *  does not hold — the shape of the real catalogue in miniature. */
const ENTRIES: CatalogueEntryLike[] = [
  card("ing-betaalpas", "ING betaalpas", "ING Bank N.V.", 1.4),
  card("ing-creditcard", "ING creditcard", "International Card Services (ICS)", 2),
  card("ing-platinum", "ING Platinumcard", "International Card Services (ICS)", 0),
  card("revolut", "Revolut Standard betaalpas", "Revolut Bank UAB", 1),
  card("t212", "212 Card", "Paynetics; Trading 212", 0),
];

/** Card terms as the travel agent stores them, keyed on the PRODUCT. */
function terms(pct: Record<string, number>, source: "agent" | "user" = "agent"): LearnedFact[] {
  return Object.entries(pct).map(([subject, value]) =>
    makeFact({ agent: TRAVEL_AGENT, subject, key: "fxFeePct", value: String(value), source, updatedAt: "2026-08-16" }),
  );
}

const money = (n: number, ccy: string) =>
  new Intl.NumberFormat("nl-NL", { style: "currency", currency: ccy, maximumFractionDigits: 2 }).format(n);
const usd = (n: number) => money(n, "USD");
const eur = (n: number) => money(n, "EUR");

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

function render(opts: { facts?: LearnedFact[]; entries?: CatalogueEntryLike[]; accounts?: Account[] } = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <Valuta
        accounts={opts.accounts ?? ACCOUNTS}
        facts={opts.facts ?? []}
        entries={opts.entries ?? ENTRIES}
      />,
    );
  });
  return container;
}

function click(el: Element) {
  act(() => el.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

function arrives(): string {
  return (container!.querySelector('[data-testid="arrives"]') as HTMLElement).textContent ?? "";
}

/** The bank rows, in the order the screen ranks them. */
function rows(): HTMLElement[] {
  return [...container!.querySelectorAll(".travel-journeys .travel-journey")] as HTMLElement[];
}
function rowNamed(bank: string): HTMLElement {
  const hit = rows().filter((r) => (r.querySelector(".travel-journey-name")?.textContent ?? "").trim().startsWith(bank));
  expect(hit).toHaveLength(1); // a bank appears ONCE — that is the point
  return hit[0];
}

test("the transfer block renders both legs, an amount and two currency pills", () => {
  const c = render();
  expect(c.querySelector('[aria-label="Van rekening"]')).not.toBeNull();
  expect(c.querySelector('[aria-label="Naar rekening"]')).not.toBeNull();
  expect((c.querySelector('[aria-label="Bedrag"]') as HTMLInputElement).value).toBe("1000");
  expect(c.querySelector('[aria-label="Van valuta"]')).not.toBeNull();
  expect(c.querySelector('[aria-label="Naar valuta"]')).not.toBeNull();
  expect(c.querySelector('[aria-label="Wissel van en naar"]')).not.toBeNull();
});

test("ING appears ONCE, though the catalogue holds three ING cards", () => {
  render();
  const ing = rowNamed("ING");
  // And the row says which product the figure belongs to, because "ING 0%" is
  // only true of the Platinumcard.
  expect(ing.textContent).toContain("ING betaalpas");
  expect(ing.textContent).toContain("ING Platinumcard");
});

test("the whole market is ranked, cheapest first, and a bank he does not hold is marked", () => {
  render();
  const order = rows().map((r) => (r.querySelector(".travel-journey-name")?.textContent ?? "").trim().split(" ")[0]);
  expect(order[0]).toBe("Trading");            // 212 Card at 0%
  expect(rowNamed("Trading 212").textContent).toContain("niet van jou");
  expect(rowNamed("ING").textContent).toContain("van jou");
  expect(rowNamed("Revolut").textContent).toContain("van jou");
});

test("the amount that arrives is priced on a route he can use AND a figure that is his", () => {
  const c = render();
  const mid = 1000 * FX_RATE_FALLBACK.rates.USD;
  // Trading 212 is cheaper at 0% but he does not hold it. Revolut is cheaper
  // than ING at 1% — except that 1% is Revolut STANDARD's, and which Revolut
  // plan he is on is not something LaVega knows. The ING betaalpas figure is
  // his own product, so 1,4% is the number that may drive the amount.
  expect(arrives()).toBe(usd(mid * (1 - 0.014)));
  expect(c.querySelector('[data-testid="uitleg"]')!.textContent).toContain("Via ING");
  expect(c.querySelector('[data-testid="gekozen-route"]')!.textContent).toContain("ING betaalpas");
  expect(rowNamed("Revolut").textContent).toContain("of jouw pakket bij deze bank hetzelfde rekent, weet LaVega niet");
});

test("a cheaper bank he does not hold is named with the difference in euros, and not chosen", () => {
  const c = render();
  const note = c.querySelector('[data-testid="goedkoper"]')!;
  expect(note.textContent).toContain("Trading 212");
  // 1,4% of €1.000 versus 0%: €14.
  expect(note.textContent).toContain(eur(14));
  expect(note.textContent).toContain("Die bank heb je niet");
});

test("he can overrule the default, and the arriving amount follows his choice", () => {
  const c = render();
  const mid = 1000 * FX_RATE_FALLBACK.rates.USD;
  click(rowNamed("Trading 212"));
  expect(arrives()).toBe(usd(mid));
  expect(c.querySelector('[data-testid="uitleg"]')!.textContent).toContain("Via Trading 212");
  expect(c.querySelector('[data-testid="gekozen-route"]')!.textContent).toContain("deze bank heb je nog niet");
  // The alternatives are now priced against Trading 212: ING costs €14 more.
  expect(rowNamed("ING").textContent).toContain(`${eur(14)} meer`);
});

test("what he entered himself beats the catalogue for his own card", () => {
  const c = render({ facts: terms({ [productOf(ACCOUNTS[0])]: 0.4 }, "user") });
  const mid = 1000 * FX_RATE_FALLBACK.rates.USD;
  expect(arrives()).toBe(usd(mid * (1 - 0.004)));
  expect(c.querySelector('[data-testid="uitleg"]')!.textContent).toContain("Via ING");
});

test("with no establishable figure for his own banks, what arrives is 'onbekend' — and it says why", () => {
  const c = render({ entries: [] });
  const mid = 1000 * FX_RATE_FALLBACK.rates.USD;

  expect(arrives()).toBe("onbekend");
  expect(c.textContent).toContain("Wat er aankomt is onbekend");
  // The real cause, named: his banks are known, their tariffs are not.
  expect(c.textContent).toContain("kent LaVega de koersopslag niet");
  expect(c.textContent).toContain("een onbekend tarief is geen 0%");
  // The market value is still shown, but only as market value.
  expect(c.textContent).toContain(usd(mid));
  expect(arrives()).not.toContain(usd(mid));
});

test("an account without a bank cannot be looked up, and the screen says that instead", () => {
  const c = render({
    accounts: [{ key: "A 286", iban: "", name: "A 286-41213", bank: "", entity: "Prive", currency: "EUR", balance: 900 }],
    entries: [],
  });
  expect(arrives()).toBe("onbekend");
  expect(c.textContent).toContain("vul de bank in bij Rekeningen");
});

test("a bank he holds is never dropped and never shown as 0%", () => {
  const c = render({
    accounts: [...ACCOUNTS, { key: "AMEX1", iban: "", name: "Amex", bank: "American Express", type: "Creditcard", entity: "Prive", currency: "EUR", balance: -200 } as Account],
  });
  const amex = rowNamed("American Express");
  // The price cell says the cost is missing. It never prints a percentage there,
  // because a bank with no figure is not a cheap bank.
  expect(amex.querySelector(".travel-journey-cost")!.textContent).toBe("kosten onbekend");
  // Unknown sorts last, never above a bank whose figure we have.
  expect(rows().indexOf(amex)).toBe(rows().length - 1);
  expect(c.textContent).toContain("Voorwaarden van deze bank nog onbekend");
});

test("a cheapest row that is not a bank account says what it is", () => {
  const c = render({
    entries: [
      { ...card("cdc", "Crypto.com Prepaid Card — Private (Obsidian)", "Crypto.com", 0), kind: "prepaid" },
      card("ing-betaalpas", "ING betaalpas", "ING Bank N.V.", 1.4),
    ],
  });
  const first = rows()[0];
  expect(first.textContent).toContain("Crypto.com");
  // Ranked on the same evidence as the rest, and labelled — a 0% prepaid card is
  // not a bank account, and the ranking may not imply that it is.
  expect(first.textContent).toContain("prepaidkaart");
  expect(c.querySelector('[data-testid="goedkoper"]')!.textContent).toContain("Crypto.com");
});

test("the info button explains the ranking and what a collapsed row does not claim", () => {
  const c = render();
  expect(c.querySelector(".info-panel")).toBeNull();

  click(c.querySelector('[aria-label="Uitleg bij dit bedrag"]')!);
  const panel = c.querySelector(".info-panel")!;
  expect(panel.textContent).toContain("alle banken die LaVega kan onderbouwen");
  expect(panel.textContent).toContain("Eén regel per bank");
  expect(panel.textContent).toContain('"ING 0%" geldt alleen voor de Platinumcard');
  expect(panel.textContent).toContain("Elke bank die minder rekent");

  click(c.querySelector('[aria-label="Uitleg bij dit bedrag"]')!);
  expect(c.querySelector(".info-panel")).toBeNull();
});

test("with nothing known the info panel refuses to say whether switching pays", () => {
  const c = render({ entries: [] });
  click(c.querySelector('[aria-label="Uitleg bij dit bedrag"]')!);
  const panel = c.querySelector(".info-panel")!;
  expect(panel.textContent).toContain("Een onbekend tarief is geen 0%");
  expect(panel.textContent).not.toContain("Elke bank die minder rekent");
});

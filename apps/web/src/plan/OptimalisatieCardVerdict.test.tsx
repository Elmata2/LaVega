// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  computeCardAdvice,
  emptyPlanPreferences,
  type CardAdvice,
  type CardAdviceInput,
  type CatalogueEntryLike,
} from "@lavega/core";
import OptimalisatieCardVerdict from "./OptimalisatieCardVerdict";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let el: HTMLElement | null = null;
beforeEach(() => {
  document.cookie = "lavega_locale=nl";
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  el?.remove();
  root = null;
  el = null;
  document.cookie = "lavega_locale=; Max-Age=0; Path=/";
});

const cv = (value: number, extra: Record<string, unknown> = {}) => ({
  value,
  route: "provider-page" as const,
  sourceUrl: "https://example.test/bron",
  checkedAt: "2026-08-20",
  conditions: null,
  conditionsKnown: true,
  ...extra,
});
const card = (id: string, fee: number): CatalogueEntryLike =>
  ({
    id,
    product: id.toUpperCase(),
    kind: "creditcard",
    fields: {
      accountFee: cv(fee, { period: "jaar" }),
      fxFeePct: cv(0),
      pointsPerEuro: cv(0),
      cashbackPct: cv(1),
    },
  }) as CatalogueEntryLike;

const base: CardAdviceInput = {
  spend: { windowCents: 600_000, months: 6, foreignCents: 0, excludedForeignCount: 0 },
  catalogue: [card("cheap-card", 0), card("pricey-card", 400)],
  heldIds: ["cheap-card"],
  hasOtherCard: false,
  cardBalances: [],
  cardRepayment: null,
  rewards: [],
  preferences: emptyPlanPreferences(),
  rates: [],
  buffer: null,
  asOf: "2026-10-27",
};

const mount = (advice: CardAdvice): HTMLElement => {
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  act(() => root!.render(<OptimalisatieCardVerdict advice={advice} />));
  return el;
};
const byTestId = (c: ParentNode, id: string) =>
  c.querySelector<HTMLElement>(`[data-testid="${id}"]`);

const LEAD_NL = "Dit zijn de kaarten met de hoogste nettowaarde bij jouw uitgaven.";
const LEAD_EN = "These are the cards with the highest net value at your spending.";

test("unknown baseline: the lead sentence is followed by the ranking it announces", () => {
  const advice = computeCardAdvice({ ...base, hasOtherCard: true });
  expect(advice.verdict.kind).toBe("unknown-baseline");
  const c = mount(advice);
  expect(c.textContent).toContain(LEAD_NL);
  const rows = c.querySelectorAll(
    '[data-testid="plan-card-ranking"] [data-testid="plan-card-option"]',
  );
  expect(rows.length).toBe(advice.options.length);
  expect(rows.length).toBeGreaterThan(0);
  const lead = byTestId(c, "plan-card-verdict")!;
  const ranking = byTestId(c, "plan-card-ranking")!;
  expect(lead.compareDocumentPosition(ranking) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("unknown baseline in English: lead sentence and ranking", () => {
  document.cookie = "lavega_locale=en";
  const c = mount(computeCardAdvice({ ...base, hasOtherCard: true }));
  expect(c.textContent).toContain(LEAD_EN);
  expect(byTestId(c, "plan-card-ranking")).not.toBeNull();
});

test("the caveats are printed once, also when the ranking is shown", () => {
  const c = mount(computeCardAdvice({ ...base, hasOtherCard: true }));
  expect(c.querySelectorAll('[data-testid="plan-card-caveats"]').length).toBe(1);
});

test("no ranking rows: the lead sentence does not appear", () => {
  const advice = computeCardAdvice({ ...base, catalogue: [], heldIds: [], hasOtherCard: true });
  const c = mount(advice);
  expect(c.textContent).not.toContain(LEAD_NL);
});

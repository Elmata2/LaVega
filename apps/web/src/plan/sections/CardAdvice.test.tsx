// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  computeCardAdvice,
  emptyPlanPreferences,
  makeRewardsBalance,
  type CardAdvice,
  type CardAdviceInput,
  type CatalogueEntryLike,
} from "@lavega/core";
import CardAdviceBlock from "./CardAdvice";

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
const mount = (advice: CardAdvice): HTMLElement => {
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  act(() => root!.render(<CardAdviceBlock advice={advice} />));
  return el;
};
const q = (c: ParentNode, id: string) => c.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const qa = (c: ParentNode, id: string) => [...c.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];

const cv = (value: number, extra: Record<string, unknown> = {}) => ({
  value,
  route: "provider-page" as const,
  sourceUrl: "https://example.test/bron",
  checkedAt: "2026-08-20",
  conditions: null,
  conditionsKnown: true,
  ...extra,
});
const card = (id: string, fee: number, o: { ppe?: number; fx?: number } = {}): CatalogueEntryLike =>
  ({
    id,
    product: id.toUpperCase(),
    kind: "creditcard",
    fields: {
      accountFee: cv(fee, { period: "jaar" }),
      fxFeePct: cv(o.fx ?? 0),
      pointsPerEuro: cv(o.ppe ?? 0),
    },
  }) as CatalogueEntryLike;

const base: CardAdviceInput = {
  spend: { windowCents: 600_000, months: 6, foreignCents: 0, excludedForeignCount: 0 },
  catalogue: [
    card("american-express-gold-card", 240, { ppe: 1 }),
    card("cheap-card", 0),
    card("pricey-card", 400),
    { id: "no-fee", product: "NO-FEE", kind: "creditcard", fields: { fxFeePct: cv(0), pointsPerEuro: cv(0) } } as CatalogueEntryLike,
  ],
  heldIds: ["american-express-gold-card"],
  hasOtherCard: false,
  cardBalances: [
    { cardId: "american-express-gold-card", balanceCents: 300_000, paysInFull: false, ratePct: 15 },
  ],
  rewards: [
    makeRewardsBalance({
      program: "American Express Membership Rewards",
      points: 50_000,
      updatedAt: "2026-10-20",
    }),
  ],
  preferences: emptyPlanPreferences(),
  rates: [
    {
      bank: "Testbank",
      product: "Spaar",
      ratePct: 2,
      freeWithdrawal: true,
      asOf: "2026-10-01",
      sourceUrl: "https://example.test/rente",
    },
  ],
  buffer: { liquidSavingsCents: 1_000_000, fixedCostsMonthlyCents: 200_000, targetMonths: 3 },
  asOf: "2026-10-27",
};

test("a switch recommendation names the card, the net per year and the euro gain over the current card", () => {
  const c = mount(computeCardAdvice(base));
  const verdict = q(c, "plan-card-verdict")!.textContent!;
  expect(verdict).toContain("Aanbeveling: CHEAP-CARD");
  // Gold nets 12.000 x 0,3 cent - 240 = -204; the free card nets 0: gain 204.
  expect(verdict).toContain("€204 meer");
  const options = qa(c, "plan-card-option").map((o) => o.textContent!);
  expect(options[0]).toContain("CHEAP-CARD");
  expect(options[0]).toContain("+€204");
  expect(options.some((t) => t.includes("jouw kaart") && t.includes("-€204"))).toBe(true);
});

test("every option opens a 'Zo is het berekend' with the calculation and a dated source link", () => {
  const c = mount(computeCardAdvice(base));
  const how = qa(c, "plan-card-how");
  expect(how.length).toBeGreaterThan(0);
  const gold = qa(c, "plan-card-option").find((o) => o.textContent!.includes("jouw kaart"))!;
  const text = gold.textContent!;
  expect(text).toContain("Zo is het berekend");
  expect(text).toContain("Jaarkosten: €240,00");
  expect(text).toContain("12.000 punten, maal 0,3 cent per punt = €36,00");
  expect(text).toContain("gecontroleerd op 20 aug");
  const link = gold.querySelector<HTMLAnchorElement>("a[href^='https://']")!;
  expect(link.getAttribute("rel")).toContain("noopener");
});

test("cards with missing catalogue values are listed as not comparable with the reason, never ranked", () => {
  const c = mount(computeCardAdvice(base));
  const list = q(c, "plan-card-not-comparable")!;
  expect(list.textContent).toContain("NO-FEE: jaarkosten niet in de catalogus");
  expect(qa(c, "plan-card-option").some((o) => o.textContent!.includes("NO-FEE"))).toBe(false);
});

test("a revolving balance shows the yearly interest, the pay-off recommendation and its calculation", () => {
  const c = mount(computeCardAdvice(base));
  const t = q(c, "plan-card-interest")!.textContent!;
  expect(t).toContain("€3.000 staan tegen 15%");
  expect(t).toContain("€450 rente per jaar");
  expect(t).toContain("Aanbeveling: los het hele saldo af met spaargeld");
  expect(t).toContain("Netto €390 per jaar");
  expect(t).toContain("Zo is het berekend");
  expect(t).toContain("Testbank");
});

test("without a rate nothing is estimated and the cost of one percent is shown", () => {
  const advice = computeCardAdvice({
    ...base,
    cardBalances: [{ cardId: "american-express-gold-card", balanceCents: 300_000, paysInFull: false }],
  });
  const t = q(mount(advice), "plan-card-interest")!.textContent!;
  expect(t).toContain("Elke 1% rente kost daarover €30 per jaar");
  expect(t).toContain("niets geschat");
});

test("points show the indicative value with its source, and the expiry is unknown unless the user gave one", () => {
  const t = q(mount(computeCardAdvice(base)), "plan-card-points")!.textContent!;
  expect(t).toContain("50.000 punten");
  expect(t).toContain("Indicatieve waarde: €150");
  expect(t).toContain("Verloopt: niet bekend");
  expect(t).toContain("50.000 punten maal 0,3 cent per punt");
  expect(t).toContain("21 aug");
});

test("not enough history: one honest line, no numbers invented", () => {
  const c = mount(computeCardAdvice({ ...base, spend: { ...base.spend, months: 2 }, cardBalances: [], rewards: [] }));
  expect(q(c, "plan-card-verdict")!.textContent).toContain("minder dan 3 volle maanden");
  expect(qa(c, "plan-card-option")).toHaveLength(0);
});

test("English copy renders the same structure", () => {
  document.cookie = "lavega_locale=en";
  const c = mount(computeCardAdvice(base));
  expect(q(c, "plan-card-verdict")!.textContent).toContain("Recommendation: CHEAP-CARD");
  expect(q(c, "plan-card-interest")!.textContent).toContain("Recommendation: pay off the whole balance");
});

const buf = { liquidSavingsCents: 1_000_000, fixedCostsMonthlyCents: 100_000, targetMonths: 3 };

test("two revolving cards: the savings pot is split, highest rate first, and each card says what it got", () => {
  const advice = computeCardAdvice({
    ...base,
    buffer: buf,
    cardBalances: [
      { cardId: "american-express-gold-card", balanceCents: 500_000, paysInFull: false, ratePct: 15 },
      { cardId: "cheap-card", balanceCents: 500_000, paysInFull: false, ratePct: 14 },
    ],
  });
  const blocks = qa(mount(advice), "plan-card-interest").map((b) => b.textContent!);
  expect(blocks[0]).toContain("los het hele saldo af");
  expect(blocks[1]).toContain("los €2.000 af");
  expect(blocks[1]).toContain("waarvan €2.000 voor deze kaart overblijft na kaarten met een hogere rente");
  expect(blocks[1]).toContain("Er blijft €3.000 openstaan");
});

test("unknown buffer: says why there is no pay-off advice", () => {
  const advice = computeCardAdvice({
    ...base,
    buffer: { ...buf, fixedCostsMonthlyCents: 0 },
  });
  const t = q(mount(advice), "plan-card-interest")!.textContent!;
  expect(t).toContain("je buffer of je vaste lasten ontbreken");
  expect(t).not.toContain("los het hele saldo af");
});

test("a revolving user is told the comparison leaves out card interest", () => {
  const c = mount(computeCardAdvice(base));
  expect(q(c, "plan-card-interest-ignored")!.textContent).toContain("rente van kaarten zit niet");
});

test("an unvalued held card: no switch, and the reason is named", () => {
  const cat = [
    { ...card("flying-blue-american-express-gold-card", 198, { ppe: 1 }) },
    card("cheap-card", 0),
  ];
  const c = mount(
    computeCardAdvice({
      ...base,
      catalogue: cat,
      heldIds: ["flying-blue-american-express-gold-card"],
      cardBalances: [],
      rewards: [],
    }),
  );
  const v = q(c, "plan-card-verdict")!.textContent!;
  expect(v).toContain("niet te vergelijken");
  expect(v).toContain("vul een inwisselvoorbeeld in");
  expect(v).not.toContain("Aanbeveling:");
});

test("a minimum-spend fee explains itself and shows the source's own words", () => {
  const entry = card("american-express-blue-card", 0);
  (entry.fields as Record<string, { conditions: string | null }>)["accountFee"]!.conditions =
    "Bij een minimale besteding van € 3.000 per jaar. Anders € 35.";
  const c = mount(
    computeCardAdvice({
      ...base,
      catalogue: [entry],
      heldIds: [],
      cardBalances: [],
      rewards: [],
      spend: { windowCents: 120_000, months: 6, foreignCents: 0, excludedForeignCount: 0 },
    }),
  );
  const t = q(c, "plan-card-option")!.textContent!;
  expect(t).toContain("Jaarkosten: €35,00");
  expect(t).toContain("vanaf €3.000 per jaar");
  expect(t).toContain("Bij een minimale besteding van € 3.000 per jaar");
});

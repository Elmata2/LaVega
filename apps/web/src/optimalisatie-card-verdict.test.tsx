// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  computeCardAdvice,
  emptyPlanPreferences,
  makeFact,
  ownAccounts,
  TRAVEL_AGENT,
  type Account,
  type CardAdvice,
  type CardAdviceInput,
  type CatalogueEntryLike,
  type Tx,
} from "@lavega/core";
import CardAdviceBlock from "./plan/sections/CardAdvice";
import Optimalisatie from "./views/Optimalisatie";
import type { StatedAnswers } from "./plan/optimalisatieStated";

/* The credit-card block of Optimalisatie prints the plan's card advice
 * (`plan.sections.cards.figures.advice`) and nothing else. These tests hand the
 * screen an advice and check it shows that advice, not a figure of its own. */

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

const q = (c: ParentNode, id: string) => c.querySelector<HTMLElement>(`[data-testid="${id}"]`);

const cv = (value: number, extra: Record<string, unknown> = {}) => ({
  value,
  route: "provider-page" as const,
  sourceUrl: "https://example.test/bron",
  checkedAt: "2026-08-20",
  conditions: null,
  conditionsKnown: true,
  ...extra,
});
const card = (id: string, fee: number, o: { ppe?: number; fx?: number; cb?: number } = {}): CatalogueEntryLike =>
  ({
    id,
    product: id.toUpperCase(),
    kind: "creditcard",
    fields: {
      accountFee: cv(fee, { period: "jaar" }),
      fxFeePct: cv(o.fx ?? 0),
      pointsPerEuro: cv(o.ppe ?? 0),
      cashbackPct: cv(o.cb ?? 0),
    },
  }) as CatalogueEntryLike;

const GOLD = "american-express-gold-card";
const base: CardAdviceInput = {
  spend: { windowCents: 600_000, months: 6, foreignCents: 0, excludedForeignCount: 0 },
  catalogue: [card(GOLD, 240, { ppe: 1 }), card("cheap-card", 0), card("pricey-card", 400)],
  heldIds: [GOLD],
  hasOtherCard: false,
  cardBalances: [],
  cardRepayment: null,
  rewards: [],
  preferences: emptyPlanPreferences(),
  rates: [],
  buffer: { liquidSavingsCents: 1_000_000, fixedCostsMonthlyCents: 200_000, targetMonths: 3 },
  asOf: "2026-10-27",
};

const acc = (over: Partial<Account>): Account => ({
  key: "k",
  iban: "",
  name: "Rekening",
  bank: "ING",
  entity: "BV1",
  currency: "EUR",
  balance: 1000,
  ...over,
});
const spend = (key: string, month: number): Tx => ({
  id: key + month,
  accountKey: key,
  date: `2025-${String(month).padStart(2, "0")}-15`,
  amount: -2500,
  currency: "EUR",
  counterparty: "Albert Heijn",
  description: "",
  category: "",
  manual: false,
});
const ACCOUNTS = [
  acc({ key: "ing", bank: "ING", balance: 20_000, interestRate: 1.5 }),
  acc({ key: "t212", bank: "Trading 212", balance: 0, interestRate: 3.5 }),
];
const FACTS = [
  makeFact({
    agent: TRAVEL_AGENT,
    subject: "Trading 212 betaalpas",
    key: "cashbackPct",
    value: "1.5",
    source: "agent",
    updatedAt: "2026-08-18",
  }),
  makeFact({
    agent: TRAVEL_AGENT,
    subject: "ING betaalpas",
    key: "cashbackPct",
    value: "0",
    source: "agent",
    updatedAt: "2026-08-18",
  }),
];
const offer = (id: string, kind: string, pct: number): CatalogueEntryLike => ({
  id,
  product: id.toUpperCase(),
  issuer: "Testbank N.V.",
  kind,
  fields: { cashbackPct: cv(pct) },
} as CatalogueEntryLike);

type Props = Parameters<typeof Optimalisatie>[0];
const mount = (over: Partial<Props> = {}): HTMLElement => {
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  act(() =>
    root!.render(
      <Optimalisatie
        txs={Array.from({ length: 12 }, (_, i) => spend("ing", i + 1))}
        accounts={ACCOUNTS}
        rules={[]}
        own={ownAccounts(ACCOUNTS)}
        asOf="2026-01-15"
        busy={false}
        entries={[]}
        facts={FACTS}
        onRateCommit={() => {}}
        {...over}
      />,
    ),
  );
  return el;
};
const planText = (advice: CardAdvice): string => {
  const host = document.createElement("div");
  document.body.append(host);
  const r = createRoot(host);
  act(() => r.render(<CardAdviceBlock advice={advice} />));
  const text = q(host, "plan-card-verdict")!.textContent!;
  act(() => r.unmount());
  host.remove();
  return text;
};
const answers = (o: Partial<StatedAnswers> = {}): StatedAnswers => ({
  credit: [GOLD],
  debit: [],
  repayment: "full",
  balances: [],
  noCards: false,
  statedAt: "2026-11-01",
  ...o,
});

test("credit-card block shows the same card and euro figure as the plan advice", () => {
  const advice = computeCardAdvice(base);
  const c = mount({ cardAdvice: advice });
  const shown = q(c, "plan-card-verdict")!.textContent!;
  expect(shown).toBe(planText(advice));
  expect(shown).toContain("CHEAP-CARD");
  expect(shown).toContain("€204 meer");
});

test("a switch verdict shows the plan's caveats, and the page's disclaimer once", () => {
  const advice = computeCardAdvice(base);
  expect(advice.verdict.kind).toBe("switch");
  const c = mount({ cardAdvice: advice });
  const box = q(c, "optimalisatie-card-verdict")!;
  const caveats = q(box, "plan-card-caveats")!.textContent!;
  expect(caveats).toContain("Alle uitgaven staan in deze berekening op de kaart");
  expect(caveats).toContain("0% (aangenomen)");
  const notices = c.querySelectorAll('[data-testid="optimalisatie-disclaimer"]');
  expect(notices).toHaveLength(1);
  expect(notices[0]!.textContent).toContain("geen financieel advies");
  expect(c.textContent!.split("geen financieel advies").length - 1).toBe(1);
  // Below the verdict, not above it.
  expect(
    q(box, "plan-card-verdict")!.compareDocumentPosition(q(box, "plan-card-caveats")!) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

test("no figure, no caveats: short history shows neither caveats nor the disclaimer", () => {
  const short = computeCardAdvice({ ...base, spend: { ...base.spend, months: 2 } });
  const c = mount({ cardAdvice: short });
  expect(q(c, "plan-card-caveats")).toBeNull();
});

test("first card: foreign spend is counted, and the figure is the plan's, not one recomputed from the screen's own rows", () => {
  const first = computeCardAdvice({
    ...base,
    heldIds: [],
    catalogue: [card("points-card", 0, { cb: 1, fx: 1 })],
    spend: { windowCents: 600_000, months: 6, foreignCents: 300_000, excludedForeignCount: 0 },
  });
  const domestic = computeCardAdvice({
    ...base,
    heldIds: [],
    catalogue: [card("points-card", 0, { cb: 1, fx: 1 })],
    spend: { windowCents: 600_000, months: 6, foreignCents: 0, excludedForeignCount: 0 },
  });
  // The screen's own transactions are all domestic; the advice carries foreign spend.
  const shown = q(mount({ cardAdvice: first }), "plan-card-verdict")!.textContent!;
  expect(shown).toBe(planText(first));
  expect(first.verdict.kind).toBe("switch");
  expect(domestic.verdict.kind).toBe("switch");
  expect(planText(first)).not.toBe(planText(domestic));
});

test("card debt: the pay-off advice is above the verdict and the offer is not hidden", () => {
  const advice = computeCardAdvice({
    ...base,
    cardBalances: [{ cardId: GOLD, balanceCents: 300_000, paysInFull: false, ratePct: 15 }],
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
  });
  expect(advice.ignoresInterest).toBe(true);
  expect(advice.verdict.kind).toBe("switch");
  const c = mount({
    cardAdvice: advice,
    stated: answers({ repayment: "sometimes" }),
    entries: [offer("prepaid-x", "prepaid", 3)],
  });
  const interest = q(c, "plan-card-interest")!;
  const verdict = q(c, "plan-card-verdict")!;
  expect(interest.textContent).toContain("Aanbeveling: los het hele saldo af");
  expect(interest.compareDocumentPosition(verdict) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(verdict.textContent).toContain("CHEAP-CARD");
  expect(q(c, "plan-card-interest-ignored")!.textContent).toContain("rente van kaarten zit niet");
  // Offers are not hidden any more: the prepaid ranking shows too.
  expect(q(c, "cashback-debt")).toBeNull();
  expect(c.textContent).toContain("PREPAID-X");
});

test("debit and crypto cashback rows still render; a credit card is not in that ranking", () => {
  const c = mount({
    entries: [offer("crypto-card", "crypto", 5), offer("credit-two", "creditcard", 2)],
    cardAdvice: computeCardAdvice(base),
  });
  const answer = q(c, "cashback-antwoord")!.textContent!;
  expect(answer).toContain("CRYPTO-CARD");
  expect(answer).toContain("cryptokaart");
  expect(c.textContent).not.toContain("CREDIT-TWO");
  expect(c.textContent).toContain("Betaal met Trading 212 in plaats van ING");
});

test("unknown baseline: asks which card it is and saving calls the writer", async () => {
  const advice = computeCardAdvice({
    ...base,
    heldIds: [],
    unidentifiedCards: [{ accountKey: "CC1", label: "Mijn mystery kaart" }],
  });
  expect(advice.verdict.kind).toBe("unknown-baseline");
  const save = vi.fn(async () => {});
  const c = mount({ cardAdvice: advice, onSaveStatedCard: save });
  const ask = q(c, "plan-card-identify")!;
  expect(ask.textContent).toContain("Welke kaart is dit?");
  expect(ask.textContent).toContain("Mijn mystery kaart");
  expect(q(c, "plan-card-verdict")!.textContent).toContain("Mijn mystery kaart");
  const input = ask.querySelector<HTMLInputElement>("input[type=search]")!;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    set.call(input, "ING creditcard");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const box = [...c.querySelectorAll<HTMLElement>('[role="checkbox"]')].find(
    (b) => b.textContent === "ING creditcard",
  )!;
  await act(async () => box.click());
  expect(save).toHaveBeenCalledWith("CC1", "ing-creditcard");
});

test("unknown baseline without a writer: the reasons show, no question", () => {
  const advice = computeCardAdvice({
    ...base,
    heldIds: [],
    unidentifiedCards: [{ accountKey: "CC1", label: "Mijn mystery kaart" }],
  });
  const c = mount({ cardAdvice: advice });
  expect(q(c, "plan-card-verdict")!.textContent).toContain("niet te vergelijken");
  expect(q(c, "plan-card-identify")).toBeNull();
});

test("stated basis shows the stated line", () => {
  const advice = computeCardAdvice({
    ...base,
    spend: { windowCents: 0, months: 1, foreignCents: 0, excludedForeignCount: 0 },
    statedSpend: { annualCents: 1_200_000, foreignShare: 0 },
  });
  expect(advice.basis).toBe("stated");
  const c = mount({ cardAdvice: advice });
  expect(q(c, "plan-card-basis-stated")!.textContent).toContain("Op basis van je antwoorden");
});

test("keep prints the plan's own sentence, and short history shows the not-enough-data state", () => {
  const keep = computeCardAdvice({ ...base, heldIds: ["cheap-card"] });
  expect(keep.verdict.kind).toBe("keep");
  const kept = q(mount({ cardAdvice: keep }), "plan-card-verdict")!.textContent!;
  expect(kept).toBe(planText(keep));
  act(() => root!.unmount());
  el!.remove();
  const short = computeCardAdvice({ ...base, spend: { ...base.spend, months: 2 } });
  expect(q(mount({ cardAdvice: short }), "plan-card-verdict")!.textContent).toContain(
    "minder dan 3 volle maanden",
  );
});

test("keep with a card that is not held names the difference, not 'niets te winnen'", () => {
  // Held card is close to the best but not the best: the plan says by how much.
  const near = computeCardAdvice({
    ...base,
    catalogue: [card("held-near", 30), card("best-card", 20)],
    heldIds: ["held-near"],
  });
  expect(near.verdict.kind).toBe("keep");
  const text = q(mount({ cardAdvice: near }), "plan-card-verdict")!.textContent!;
  expect(text).toBe(planText(near));
  expect(text).not.toContain("niets te winnen");
});

test("the stated-basis line shows once for keep and no-card-worth-it too", () => {
  const stated = { windowCents: 0, months: 1, foreignCents: 0, excludedForeignCount: 0 };
  const keep = computeCardAdvice({
    ...base,
    spend: stated,
    statedSpend: { annualCents: 1_200_000, foreignShare: 0 },
    heldIds: ["cheap-card"],
  });
  expect(keep.verdict.kind).toBe("keep");
  expect(keep.basis).toBe("stated");
  let c = mount({ cardAdvice: keep });
  expect(c.querySelectorAll('[data-testid="plan-card-basis-stated"]')).toHaveLength(1);
  act(() => root!.unmount());
  el!.remove();
  const none = computeCardAdvice({
    ...base,
    spend: stated,
    statedSpend: { annualCents: 1_200_000, foreignShare: 0 },
    heldIds: [],
    catalogue: [card("pricey-card", 400)],
  });
  expect(none.verdict.kind).toBe("no-card-worth-it");
  c = mount({ cardAdvice: none });
  expect(c.querySelectorAll('[data-testid="plan-card-basis-stated"]')).toHaveLength(1);
});

const CREDIT_ACC = acc({
  key: "cc1",
  bank: "ING",
  name: "ING Creditcard",
  type: "Creditcard",
  balance: -1000,
});

test("a held credit card with a switch verdict gets no generic 'niets te winnen' or 'geen rekening' line", () => {
  const accounts = [CREDIT_ACC];
  const c = mount({
    accounts,
    own: ownAccounts(accounts),
    txs: Array.from({ length: 12 }, (_, i) => spend("cc1", i + 1)),
    entries: [offer("prepaid-x", "prepaid", 1.5)],
    cardAdvice: computeCardAdvice(base),
  });
  expect(q(c, "plan-card-verdict")!.textContent).toContain("CHEAP-CARD");
  expect(c.textContent).not.toContain("er is niets te winnen");
  expect(c.textContent).not.toContain("Nog geen betaalrekening of creditcard");
});

test("debit only and no advice: the generic line still shows", () => {
  const c = mount({ entries: [offer("b", "betaalrekening", 1)], facts: FACTS });
  expect(c.textContent).toContain("er is niets te winnen");
});

const cashbackAnswer = (c: HTMLElement) => q(c, "cashback-antwoord")?.textContent ?? null;

test("a credit card is not the baseline of the cashback answer: the gain rests on the debit spend only", () => {
  const debitTxs = Array.from({ length: 12 }, (_, i) => spend("ing", i + 1));
  const ccTxs = Array.from({ length: 12 }, (_, i) => ({ ...spend("cc1", i + 1), amount: -9000 }));
  const entries = [offer("prepaid-x", "prepaid", 1.5)];
  const debitOnly = [ACCOUNTS[0]!];
  const alone = mount({ entries, txs: debitTxs, accounts: debitOnly, own: ownAccounts(debitOnly) });
  const answerAlone = cashbackAnswer(alone);
  expect(answerAlone).not.toBeNull();
  act(() => root!.unmount());
  el!.remove();
  const accounts = [...debitOnly, CREDIT_ACC];
  const both = mount({ entries, accounts, own: ownAccounts(accounts), txs: [...debitTxs, ...ccTxs] });
  expect(cashbackAnswer(both)).toBe(answerAlone);
  expect(both.querySelector('section[aria-label="Cashback"]')!.textContent).not.toContain("Creditcard");
});

test("two credit cards held: no 'Betaal met X in plaats van Y' between them", () => {
  const a = acc({ key: "cc1", bank: "ING", name: "ING Creditcard", type: "Creditcard" });
  const b = acc({ key: "cc2", bank: "ABN AMRO", name: "ABN Creditcard", type: "Creditcard" });
  const accounts = [a, b];
  const f = [
    makeFact({ agent: TRAVEL_AGENT, subject: "ING creditcard", key: "cashbackPct", value: "0", source: "agent", updatedAt: "2026-08-18" }),
    makeFact({ agent: TRAVEL_AGENT, subject: "ABN AMRO creditcard", key: "cashbackPct", value: "2", source: "agent", updatedAt: "2026-08-18" }),
  ];
  const c = mount({
    accounts,
    own: ownAccounts(accounts),
    facts: f,
    txs: Array.from({ length: 12 }, (_, i) => spend("cc1", i + 1)),
  });
  expect(c.textContent).not.toContain("Betaal met");
});
test("while the plan loads there is no card verdict and no wrong 'no card' line", () => {
  const c = mount({ cardAdvice: null, stated: answers({ credit: [], noCards: true }) });
  expect(q(c, "optimalisatie-card-verdict")).toBeNull();
  expect(c.textContent).not.toContain("Je hebt geen creditcard");
});

test("the business half shows no card verdict", () => {
  const c = mount({ cardAdvice: computeCardAdvice(base), entityScope: "business" });
  expect(q(c, "optimalisatie-card-verdict")).toBeNull();
  expect(q(c, "plan-card-caveats")).toBeNull();
});

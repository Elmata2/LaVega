// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  AdvisorProfile,
  cardOfferOf,
  emptyPlanSection,
  emptyProfile,
  emptyProfileStore,
  ownAccounts,
  type Account,
  type AdvisorProfileStore,
  type CatalogueEntryLike,
  type PlanResult,
  type Tx,
} from "@lavega/core";
import catalogueFile from "../../../docs/catalog/catalog.json";
import OptimalisatieRoute from "./plan/OptimalisatieRoute";
import PlanRoute from "./plan/PlanRoute";
import type { PlanStorage, UsePlanInput } from "./plan/usePlan";

/* The same plan input is mounted twice, once as "Jouw plan" (Kaarten en punten) and
 * once as Optimalisatie, both through the real routes and the real committed
 * catalogue. The two screens must show the same card, the same euro figure and the
 * same extra blocks, and the Instinct offer (`cardOfferOf` on the plan the route
 * computed) must exist exactly when both show a switch from a held card on history without debt. */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TODAY = "2026-10-24";
const CATALOGUE = (catalogueFile as unknown as { entries: CatalogueEntryLike[] }).entries;

let root: Root | null = null;
let container: HTMLElement | null = null;
beforeEach(() => {
  localStorage.clear();
  document.cookie = "lavega_locale=nl";
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  document.cookie = "lavega_locale=; Max-Age=0; Path=/";
});

const storage = (): PlanStorage =>
  ({
    getSection: vi.fn(async (name: string) => (name === "plan" ? emptyPlanSection() : [])),
    putSection: vi.fn(async () => {}),
    appendEvents: vi.fn(async () => {}),
  }) as unknown as PlanStorage;

const stated = <T,>(value: T) => ({ value, source: "stated" as const, at: "2026-10-01" });

const storeWith = (
  over: Partial<ConstructorParameters<typeof AdvisorProfile>[0]>,
): AdvisorProfileStore => ({
  ...emptyProfileStore("2026-10-01"),
  current: new AdvisorProfile({
    ...emptyProfile(),
    ...over,
    intake: { blocksDone: 1, step0: null },
  }),
});

const FULL_YEAR = [
  "2025-10",
  "2025-11",
  "2025-12",
  "2026-01",
  "2026-02",
  "2026-03",
  "2026-04",
  "2026-05",
  "2026-06",
  "2026-07",
  "2026-08",
  "2026-09",
];
const TWO_MONTHS = ["2026-08", "2026-09"];

const account = (key: string, o: Partial<Account>): Account => ({
  key,
  iban: "",
  name: key,
  bank: "ING",
  entity: "Prive",
  currency: "EUR",
  balance: 0,
  balanceDate: "2026-10-20",
  ...o,
});
const spendOn = (key: string, months: readonly string[], perMonth = 1000): Tx[] =>
  months.flatMap((m, i) => [
    {
      id: `${key}-in-${i}`,
      accountKey: key,
      date: `${m}-01`,
      amount: 1,
      currency: "EUR",
      counterparty: "Start",
      description: "",
      category: "Salaris",
      manual: false,
    },
    {
      id: `${key}-out-${i}`,
      accountKey: key,
      date: `${m}-15`,
      amount: -perMonth,
      currency: "EUR",
      counterparty: "Shop",
      description: "",
      category: "Boodschappen",
      manual: false,
    },
  ]);

const inputOf = (accounts: Account[], txs: Tx[], store: AdvisorProfileStore): UsePlanInput => ({
  store,
  storage: storage(),
  accounts,
  txs,
  entityProfiles: [],
  rules: [],
  own: ownAccounts(accounts),
  rewards: [],
  facts: [],
  catalogue: CATALOGUE,
  rates: [],
  mode: "separate",
  fxHistory: {},
  asOf: TODAY,
});

const GOLD = account("AMEX", {
  name: "American Express Gold Card",
  bank: "American Express",
  type: "Creditcard",
  statedCardId: "american-express-gold-card",
});
const BLUE = account("AMEX", {
  name: "American Express Blue Card",
  bank: "American Express",
  type: "Creditcard",
  statedCardId: "american-express-blue-card",
});
const MYSTERY = account("MYS", {
  name: "Mystery Visa",
  bank: "Onbekende Bank",
  type: "Creditcard",
});

type Case = {
  name: string;
  input: UsePlanInput;
  /** What both screens must show. */
  kind: "switch" | "keep" | "unknown-baseline";
  /** The card name the verdict must contain, or null. */
  card: string | null;
  euro: string | null;
  basis: "history" | "stated";
  debt: boolean;
  identify: boolean;
  /** An Instinct offer exists: a switch from a held card, on history, with no card debt. */
  offer: boolean;
};

const CASES: Case[] = [
  {
    name: "a switch: Amex Gold holder, file-fed statedCardId",
    input: inputOf([GOLD], spendOn("AMEX", FULL_YEAR), storeWith({})),
    kind: "switch",
    card: "American Express Blue Card",
    euro: "222",
    basis: "history",
    debt: false,
    identify: false,
    offer: true,
  },
  {
    name: "a keep: Amex Blue holder, nothing better",
    input: inputOf([BLUE], spendOn("AMEX", FULL_YEAR), storeWith({})),
    kind: "keep",
    card: null,
    euro: null,
    basis: "history",
    debt: false,
    identify: false,
    offer: false,
  },
  {
    name: "unknown baseline: an unidentified connected card is asked about",
    input: inputOf([MYSTERY], spendOn("MYS", FULL_YEAR), storeWith({})),
    kind: "unknown-baseline",
    card: null,
    euro: null,
    basis: "history",
    debt: false,
    identify: true,
    offer: false,
  },
  {
    name: "card debt: a switch, interest first, no offer",
    input: inputOf(
      [GOLD],
      spendOn("AMEX", FULL_YEAR),
      storeWith({
        cardRepayment: stated("sometimes"),
        statedCards: stated(["american-express-gold-card"]),
        cardBalances: stated([
          {
            cardId: "american-express-gold-card",
            balanceCents: 200_000,
            paysInFull: false,
            ratePct: 15,
          },
        ]),
      }),
    ),
    kind: "switch",
    card: "American Express Blue Card",
    euro: "222",
    basis: "history",
    debt: true,
    identify: false,
    offer: false,
  },
  {
    name: "a first card: no card held, a switch, no unprompted offer",
    input: inputOf(
      [account("CUR", { name: "Betaalrekening" })],
      spendOn("CUR", FULL_YEAR, 5000),
      storeWith({}),
    ),
    kind: "switch",
    card: "American Express Green Card",
    euro: "102",
    basis: "history",
    debt: false,
    identify: false,
    offer: false,
  },
  {
    name: "short history (2 months) with wizard answers: stated basis, no offer",
    input: inputOf(
      [account("CUR", { name: "Betaalrekening", bank: "ING" })],
      spendOn("CUR", TWO_MONTHS),
      storeWith({
        statedCards: stated(["ics-mastercard-classic"]),
        statedRanges: stated({ spend: { lowCents: 100_000, highCents: 100_000 } }),
        foreignSpend: stated("never"),
      }),
    ),
    kind: "switch",
    card: "American Express Blue Card",
    euro: "57",
    basis: "stated",
    debt: false,
    identify: false,
    offer: false,
  },
];

async function mount(ui: React.ReactNode): Promise<HTMLElement> {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(ui);
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
  });
  return container;
}
function unmount() {
  act(() => root!.unmount());
  container!.remove();
  root = null;
  container = null;
}

const q = (c: ParentNode, id: string) => c.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const qa = (c: ParentNode, id: string) => c.querySelectorAll(`[data-testid="${id}"]`).length;

type Shown = {
  verdict: string;
  lines: string;
  stated: boolean;
  identify: number;
  interest: number;
  /** The pay-off block comes before the verdict in the DOM. */
  interestFirst: boolean;
};
const shownOn = (c: HTMLElement): Shown => ({
  verdict: q(c, "plan-card-verdict")?.textContent ?? "(missing)",
  lines: q(c, "plan-card-verdict-lines")?.textContent ?? "",
  stated: q(c, "plan-card-basis-stated") !== null,
  identify: qa(c, "plan-card-identify"),
  interest: qa(c, "plan-card-interest"),
  interestFirst:
    q(c, "plan-card-interest") !== null &&
    q(c, "plan-card-verdict") !== null &&
    Boolean(
      q(c, "plan-card-interest")!.compareDocumentPosition(q(c, "plan-card-verdict")!) &
      Node.DOCUMENT_POSITION_FOLLOWING,
    ),
});

describe("Jouw plan, Optimalisatie and the Instinct offer give one card verdict", () => {
  test.each(CASES.map((c) => [c.name, c] as const))("%s", async (_name, c) => {
    const onSaveStatedCard = vi.fn(async () => {});
    let plan: PlanResult | null = null;

    const planPage = await mount(
      <PlanRoute
        {...c.input}
        profileRead={{ kind: "ok", store: c.input.store! }}
        onRetry={() => {}}
        onSaveProfile={async () => {}}
        onNavigate={() => {}}
        onSaveStatedCard={onSaveStatedCard}
        onComputed={(r) => {
          plan = r;
        }}
      />,
    );
    // The "Kaarten en punten" card starts closed; open it like a reader does.
    await act(async () => {
      q(planPage, "plan-card-cards")!.querySelector("button")!.click();
    });
    const onPlan = shownOn(planPage);
    unmount();

    const optimalisatie = await mount(
      <OptimalisatieRoute
        planInput={c.input}
        profileLoaded
        txs={c.input.txs}
        accounts={c.input.accounts}
        rules={[]}
        own={c.input.own}
        asOf={TODAY}
        busy={false}
        facts={[]}
        onSaveStatedCard={onSaveStatedCard}
        onRateCommit={() => {}}
      />,
    );
    const onOpt = shownOn(optimalisatie);
    unmount();

    // The same card name and euro figure, word for word, and the same extra blocks.
    expect(onOpt.verdict).not.toBe("(missing)");
    expect(onOpt.verdict).toBe(onPlan.verdict);
    expect(onOpt.lines).toBe(onPlan.lines);
    expect(onOpt.stated).toBe(onPlan.stated);
    expect(onOpt.identify).toBe(onPlan.identify);
    expect(onOpt.interest).toBe(onPlan.interest);
    // With card debt the pay-off advice is first on both screens; without it there is none.
    expect(onPlan.interestFirst).toBe(c.debt);
    expect(onOpt.interestFirst).toBe(c.debt);

    // ...and they are the expected ones.
    if (c.card !== null) expect(onPlan.verdict).toContain(c.card);
    if (c.euro !== null) expect(onPlan.verdict).toContain(c.euro);
    if (c.kind === "keep") expect(onPlan.verdict).not.toContain("meer dan");
    expect(onPlan.stated).toBe(c.basis === "stated");
    expect(onPlan.identify > 0).toBe(c.identify);
    expect(onPlan.interest > 0).toBe(c.debt);

    // The plan the route computed: its verdict, and the Instinct offer read from it.
    expect(plan).not.toBeNull();
    const done = plan as unknown as PlanResult;
    const advice = done.sections.cards.figures.advice;
    expect(advice.verdict.kind).toBe(c.kind);
    expect(advice.basis).toBe(c.basis);
    expect(advice.ignoresInterest).toBe(c.debt);

    const offer = cardOfferOf(done, TODAY);
    // An offer exists exactly when the verdict is a switch from a held card
    // (best-held baseline), on history, with no card debt.
    const mayOffer =
      advice.verdict.kind === "switch" &&
      advice.baseline.kind === "best-held" &&
      advice.basis === "history" &&
      !advice.ignoresInterest;
    expect(offer !== null).toBe(mayOffer);
    expect(offer !== null).toBe(c.offer);
    if (offer !== null) {
      expect(onPlan.verdict).toContain(offer.name);
      expect(onOpt.verdict).toContain(offer.name);
    }
  });
});

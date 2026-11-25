// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  AdvisorProfile,
  emptyPlanSection,
  emptyProfileStore,
  ownAccounts,
  type Account,
  type AdvisorProfileStore,
} from "@lavega/core";
import OptimalisatieRoute from "./OptimalisatieRoute";
import PlanRoute from "./PlanRoute";
import { wizardFirst } from "../intake/wizardGate";
import type { PlanStorage, UsePlanInput } from "./usePlan";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const storage = {
  getSection: vi.fn(async (name: string) => (name === "plan" ? emptyPlanSection() : [])),
  putSection: vi.fn(async () => {}),
  appendEvents: vi.fn(async () => {}),
} as unknown as PlanStorage;

const storeWith = (blocksDone: number): AdvisorProfileStore => ({
  ...emptyProfileStore("2026-10-01"),
  current: new AdvisorProfile({ removed: [], intake: { blocksDone, step0: null } }),
});

const CREDIT: Account = {
  key: "cc1",
  iban: "",
  name: "ING Creditcard",
  bank: "ING",
  entity: "BV1",
  currency: "EUR",
  balance: -1000,
  type: "Creditcard",
};

const input = (store: AdvisorProfileStore | null, accounts: Account[]): UsePlanInput => ({
  store,
  storage,
  accounts,
  txs: [],
  entityProfiles: [],
  rules: [],
  own: ownAccounts(accounts),
  rewards: [],
  facts: [],
  catalogue: [],
  rates: [],
  mode: "separate",
  fxHistory: {},
  asOf: "2026-10-24",
});

const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};

const mountOptimalisatie = async (
  store: AdvisorProfileStore | null,
  accounts: Account[],
  onStartIntake = vi.fn(),
) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <OptimalisatieRoute
        planInput={input(store, accounts)}
        profileLoaded
        txs={[]}
        accounts={accounts}
        rules={[]}
        own={ownAccounts(accounts)}
        asOf="2026-10-24"
        busy={false}
        facts={[]}
        onStartIntake={onStartIntake}
        onRateCommit={() => {}}
      />,
    );
    await settle();
  });
  return { el: container, onStartIntake };
};

const q = (c: ParentNode, id: string) => c.querySelector<HTMLElement>(`[data-testid="${id}"]`);

test("no wizard and no credit card: Optimalisatie shows the invitation and no card verdict", async () => {
  const { el, onStartIntake } = await mountOptimalisatie(null, []);
  expect(q(el, "optimalisatie-card-verdict")).toBeNull();
  expect(q(el, "plan-card-verdict")).toBeNull();
  const invite = q(el, "optimalisatie-wizard-invite");
  expect(invite).not.toBeNull();
  const button = invite!.querySelector("button")!;
  expect(button.textContent).toBe("Begin met de vragen");
  act(() => button.click());
  expect(onStartIntake).toHaveBeenCalledTimes(1);
});

test("wizard started: the card verdict shows as before", async () => {
  const { el } = await mountOptimalisatie(storeWith(1), []);
  expect(q(el, "optimalisatie-wizard-invite")).toBeNull();
  expect(q(el, "optimalisatie-card-verdict")).not.toBeNull();
});

test("a connected credit card without the wizard: same as Jouw plan, the invitation", async () => {
  const { el } = await mountOptimalisatie(null, [CREDIT]);
  expect(q(el, "optimalisatie-wizard-invite")).not.toBeNull();
  expect(q(el, "optimalisatie-card-verdict")).toBeNull();
  act(() => root!.unmount());
  el.remove();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <PlanRoute
        {...input(null, [CREDIT])}
        profileRead={{ kind: "absent" }}
        onRetry={() => {}}
        onSaveProfile={async () => {}}
        onNavigate={() => {}}
      />,
    );
    await settle();
  });
  expect(q(container, "intake-invite")).not.toBeNull();
  expect(q(container, "plan-card-advice")).toBeNull();
});

test("Jouw plan and Optimalisatie share one rule", () => {
  expect(wizardFirst(null)).toBe(true);
  expect(wizardFirst(storeWith(0))).toBe(true);
  expect(wizardFirst(storeWith(1))).toBe(false);
});

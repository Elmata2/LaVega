// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { emptyPlanSection, ownAccounts } from "@lavega/core";
import OptimalisatieRoute from "./OptimalisatieRoute";
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

const planInput: UsePlanInput = {
  store: null,
  storage,
  accounts: [],
  txs: [],
  entityProfiles: [],
  rules: [],
  own: ownAccounts([]),
  rewards: [],
  facts: [],
  catalogue: [],
  rates: [],
  mode: "separate",
  fxHistory: {},
  asOf: "2026-10-24",
};

test("mounting Optimalisatie performs no stored-state write (no snapshot)", async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <OptimalisatieRoute
        planInput={planInput}
        profileLoaded
        txs={[]}
        accounts={[]}
        rules={[]}
        own={ownAccounts([])}
        asOf="2026-10-24"
        busy={false}
        facts={[]}
        onRateCommit={() => {}}
      />,
    );
    for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
  });
  expect(storage.getSection).toHaveBeenCalled();
  expect(storage.putSection).not.toHaveBeenCalled();
  expect(storage.appendEvents).not.toHaveBeenCalled();
});

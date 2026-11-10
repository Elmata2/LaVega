// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  AdvisorProfile,
  emptyPlanSection,
  emptyProfileStore,
  ownAccounts,
  type AdvisorProfileStore,
} from "@lavega/core";
import PlanRoute, { type PlanRouteProps } from "./PlanRoute";
import type { PlanStorage } from "./usePlan";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;
beforeEach(() => {
  localStorage.clear();
  document.cookie = "lavega_locale=en";
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

const props = (over: Partial<PlanRouteProps>): PlanRouteProps => ({
  profileRead: { kind: "absent" },
  onRetry: vi.fn(),
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
  onSaveProfile: vi.fn(async () => {}),
  onNavigate: vi.fn(),
  ...over,
});

async function render(p: PlanRouteProps) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<PlanRoute {...p} />);
    for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
  });
  return container;
}
const q = (c: HTMLElement, id: string) => c.querySelector(`[data-testid="${id}"]`);

test("loading shows the intake's loading line and stores nothing", async () => {
  const c = await render(props({ profileRead: "loading" }));
  expect(c.querySelector('[role="status"]')).not.toBeNull();
  expect(storage.putSection).not.toHaveBeenCalled();
});

test("a profile read error shows the retry button, not the invitation", async () => {
  const onRetry = vi.fn();
  const c = await render(props({ profileRead: "error", onRetry }));
  expect(c.querySelector('[role="alert"]')).not.toBeNull();
  expect(q(c, "intake-invite")).toBeNull();
  act(() => c.querySelector("button")!.click());
  expect(onRetry).toHaveBeenCalled();
});

test("a corrupt profile shows the notice and never an invitation to start", async () => {
  const c = await render(props({ profileRead: { kind: "corrupt" } }));
  expect(q(c, "plan-corrupt")).not.toBeNull();
  expect(q(c, "intake-invite")).toBeNull();
  expect(c.querySelector("button")).toBeNull();
});

test("no profile: the intake invitation, and Start opens the intake", async () => {
  const onNavigate = vi.fn();
  const c = await render(props({ onNavigate }));
  expect(q(c, "intake-invite")).not.toBeNull();
  act(() => c.querySelector("button")!.click());
  expect(onNavigate).toHaveBeenCalledWith("intake");
});

test("with a finished first block the page lists a status per section", async () => {
  const store = storeWith(1);
  const c = await render(props({ profileRead: { kind: "ok", store }, store }));
  expect(q(c, "intake-invite")).toBeNull();
  for (const id of ["month", "buffer", "debts", "spending", "subscriptions", "cards", "goals"]) {
    expect(q(c, `plan-status-${id}`)).not.toBeNull();
  }
});

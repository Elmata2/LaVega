// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { emptyProfileStore } from "@lavega/core";
import SummaryScreen from "./SummaryScreen";
import { summaryRows } from "./summaryRows";
import { wizardCopy } from "../../copy/wizard";
import { intakeCopy } from "../../copy/intake";
import {
  applyCardBalances,
  applyHousehold,
  applySpendMix,
  applyStatedCards,
  applyStatedRange,
  applyWork,
} from "../state";
import { WIZARD_DEBT, WIZARD_GOAL } from "./screens";
import { screensFor } from "./screens";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let el: HTMLElement | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  el?.remove();
  root = null;
  el = null;
});
function mount(node: React.ReactNode) {
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  act(() => root!.render(node));
  return el;
}

const AS_OF = "2026-10-23";
const ctx = { c: intakeCopy.en.aboutYou, locale: "en" as const, asOf: AS_OF };

function profile() {
  let p = emptyProfileStore("2026-10-23T10:00:00Z").current;
  p = applyHousehold(p, { kind: "alone" }, AS_OF);
  p = applyWork(p, ["employed"], AS_OF);
  p = applyStatedRange(p, "income", { lowCents: 325000, highCents: 325000 }, AS_OF);
  return p;
}

test("lists only answered screens", () => {
  const p = profile();
  const rows = summaryRows(p, screensFor(p), ctx);
  expect(rows.map((r) => r.screen)).toEqual(["household", "work", "income"]);
  expect(rows.find((r) => r.screen === "income")!.value).toContain("3,250");
  const c = mount(
    <SummaryScreen copy={wizardCopy.en} busy={false} rows={rows} onEdit={() => {}} onSubmit={() => {}} />,
  );
  expect(c.querySelectorAll(".wz-summary-row")).toHaveLength(3);
  expect(c.textContent).not.toContain("Spending");
});

test("each line has a Change button that reports its screen; Verder submits", () => {
  const p = profile();
  const rows = summaryRows(p, screensFor(p), ctx);
  const onEdit = vi.fn();
  const onSubmit = vi.fn();
  const c = mount(
    <SummaryScreen copy={wizardCopy.en} busy={false} rows={rows} onEdit={onEdit} onSubmit={onSubmit} />,
  );
  const buttons = [...c.querySelectorAll<HTMLButtonElement>(".wz-summary-row button")];
  expect(buttons.map((b) => b.textContent)).toEqual(["Change", "Change", "Change"]);
  act(() => buttons[2]!.click());
  expect(onEdit).toHaveBeenCalledWith("income");
  act(() => c.querySelector<HTMLButtonElement>(".wz-next")!.click());
  expect(onSubmit).toHaveBeenCalledTimes(1);
});

test("goal and debt lines come from the wizard goal and wizard debt only", () => {
  const base = profile();
  const goal = (id: string, purpose: string) => ({
    value: {
      id,
      purpose,
      targetCents: 100000,
      targetDate: "2027-06-01",
      kind: "general" as const,
      priority: "important" as const,
      accountRefs: [],
    },
    source: "stated" as const,
    at: AS_OF,
  });
  const p = {
    ...base,
    goals: [goal("other", "Other goal"), goal(WIZARD_GOAL, "Holiday")],
    debts: [
      { id: "other-debt", lender: "Other bank", monthlyCents: 5000, source: "stated" as const, at: AS_OF },
      { id: WIZARD_DEBT, lender: "Wizard bank", monthlyCents: 9000, source: "stated" as const, at: AS_OF },
    ],
  } as typeof base;
  const rows = summaryRows(p, ["goal", "debts"], ctx);
  expect(rows.map((r) => r.screen)).toEqual(["goal", "debts"]);
  expect(rows[0]!.label).toBe("Holiday");
  expect(rows[1]!.label).toBe("Wizard bank");
});

test("an answered card-balances screen shows a line; a pending one does not", () => {
  const stated = applyStatedCards(profile(), ["american-express-gold-card"], AS_OF);
  expect(summaryRows(stated, screensFor(stated), ctx).map((r) => r.screen)).not.toContain("card-balances");
  const p = applyCardBalances(
    stated,
    [{ cardId: "american-express-gold-card", balanceCents: 250_000, paysInFull: false, ratePct: 9.5 }],
    AS_OF,
  );
  const line = summaryRows(p, screensFor(p), ctx).find((r) => r.screen === "card-balances");
  expect(line!.value).toContain("2,500");
  expect(line!.value).toContain("9,5%");
  const nl = summaryRows(p, screensFor(p), { ...ctx, c: intakeCopy.nl.aboutYou, locale: "nl" }).find(
    (r) => r.screen === "card-balances",
  );
  expect(nl!.value).toContain("2.500");
});

test("a new personalisation field shows a summary line", () => {
  const p = applySpendMix(profile(), ["groceries", "travel"], AS_OF);
  const rows = summaryRows(p, screensFor(p), ctx);
  const line = rows.find((r) => r.screen === "spend-mix");
  expect(line).toBeDefined();
  expect(line!.value).toContain("Groceries");
  expect(line!.label).toBe(intakeCopy.en.aboutYou.sectionLabels.spendMix);
});

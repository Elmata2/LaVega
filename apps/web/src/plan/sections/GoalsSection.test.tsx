// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  computePlan,
  emptyPlanPreferences,
  findAdviceLanguage,
  type AdvisorProfileStore,
} from "@lavega/core";
import { goalsCopy } from "../../copy/plan/index.js";
import { richPlanInput, richStore } from "../richInput";
import type { UsePlan } from "../usePlan";
import GoalsSection from "./GoalsSection";
import type { PlanCtx } from "./types";

(
  globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;
beforeEach(() => {
  document.cookie = "lavega_locale=nl";
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  document.cookie = "lavega_locale=; Max-Age=0; Path=/";
});

function withProfile(
  over: {
    birthYear?: number;
    experience?: "beginner" | "some" | "experienced";
  },
  asOf = "2026-10-24",
): HTMLElement {
  const base = richStore();
  const at = "2026-10-01";
  const store: AdvisorProfileStore = {
    ...base,
    current: Object.assign(
      Object.create(Object.getPrototypeOf(base.current)),
      base.current,
      {
        ...(over.birthYear !== undefined && {
          birthYear: { value: over.birthYear, source: "stated", at },
        }),
        ...(over.experience !== undefined && {
          experience: { value: over.experience, source: "stated", at },
        }),
      },
    ),
  };
  const result = computePlan(richPlanInput(store)).sections.goals;
  expect(result.figures.rows.length).toBeGreaterThan(0);
  const plan = {
    result: computePlan(richPlanInput(store)),
    preferences: emptyPlanPreferences(),
    events: [],
    changes: {
      changes: [],
      statusChanges: [],
      material: false,
      baseline: false,
    },
    changesSince: null,
    loaded: true,
    stateError: false,
    writeError: false,
    recompute: async () => {},
    setPreference: vi.fn(async () => {}),
    appendPlanEvent: vi.fn(async () => {}),
  } as UsePlan;
  const ctx: PlanCtx = {
    plan,
    asOf,
    accounts: [],
    profile: { store, update: vi.fn(async () => true), saveFailed: false },
    onNavigate: vi.fn(),
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<GoalsSection result={result} ctx={ctx} />));
  act(() => {
    container!
      .querySelectorAll<HTMLButtonElement>("button[aria-expanded='false']")
      .forEach((b) => b.click());
  });
  return container;
}
const q = (c: HTMLElement, id: string) =>
  c.querySelector<HTMLElement>(`[data-testid="${id}"]`);

test("born 1990 in 2026 shows 31 years", () => {
  const c = withProfile({ birthYear: 1990 });
  expect(q(c, "plan-investing-years")!.textContent).toBe(
    "Nog 31 jaar tot je 67e. Je precieze AOW-leeftijd staat bij de SVB.",
  );
  const a = q(c, "plan-investing-years")!.querySelector("a")!;
  expect(a.getAttribute("href")).toBe(
    "https://www.svb.nl/nl/aow/aow-leeftijd/uw-aow-leeftijd",
  );
  expect(a.getAttribute("target")).toBe("_blank");
  expect(a.getAttribute("rel")).toBe("noopener noreferrer");
});

test("at 67 or older shows the SVB pointer instead of a number", () => {
  const c = withProfile({ birthYear: 1959 });
  expect(q(c, "plan-investing-years")!.textContent).toBe(
    "Je hebt de AOW-leeftijd bereikt of bijna bereikt. Kijk bij de SVB.",
  );
});

test("no birth year shows no years line", () => {
  const c = withProfile({ experience: "some" });
  expect(q(c, "plan-investing-years")).toBeNull();
  expect(q(c, "plan-investing-explainer")).toBeNull();
});

test("beginner sees the explainer first, others do not", () => {
  const c = withProfile({ experience: "beginner" });
  const ex = q(c, "plan-investing-explainer")!;
  expect(ex.textContent).toBe(goalsCopy.nl.investing.explainer);
  const score = [...c.querySelectorAll("p")].find((p) =>
    /Draagkracht uit je cijfers/.test(p.textContent!),
  )!;
  expect(
    ex.compareDocumentPosition(score) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

test("copy passes findAdviceLanguage", () => {
  for (const l of ["nl", "en"] as const) {
    const i = goalsCopy[l].investing;
    for (const s of [i.explainer, i.lead(31), i.lead(null)]) {
      expect(findAdviceLanguage(s, l), `${l}: ${s}`).toEqual([]);
      // AOW-leeftijd is a Dutch compound, not a hyphen inside a sentence.
      expect(s.replace(/AOW-leeftijd/g, "AOW leeftijd"), s).not.toMatch(/\p{L}-\p{L}/u);
    }
  }
});

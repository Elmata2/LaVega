// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { emptyProfile, findAdviceLanguage, type AdvisorProfileStore } from "@lavega/core";
import { IntakeInviteCard, IntakeInviteWidget, inviteState } from "./IntakeInviteCard";
import { setEnabledWidgets, WIDGETS } from "../moduleRegistry";
import { applyRiskAnswers, completeBlock, markStep0 } from "../../intake/state";
import { RISK_SCALE } from "@lavega/core";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AS_OF = "2026-10-23";
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
function mount(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
}
const text = () => container!.textContent ?? "";
const button = (label: string) =>
  [...container!.querySelectorAll("button")].find((b) => b.textContent === label)!;
const store = (build: (p: ReturnType<typeof emptyProfile>) => ReturnType<typeof emptyProfile>) =>
  ({
    current: build(emptyProfile()),
    versions: [],
    updatedAt: "2026-10-01T00:00:00Z",
  }) as AdvisorProfileStore;
const answers = Object.fromEntries(RISK_SCALE.items.map((i) => [i.id, i.options[0]!.id]));
const doneWithRisk = (at: string) =>
  store((p) => completeBlock(applyRiskAnswers(completeBlock(p, 3), answers, at), 3));

test("no profile -> invitation with Start; click opens the intake", () => {
  const open = vi.fn();
  mount(
    <IntakeInviteWidget store={null} asOf={AS_OF} onSave={async () => {}} onOpenIntake={open} />,
  );
  expect(text()).toContain("Tell LaVega about your situation");
  act(() => button("Start").click());
  expect(open).toHaveBeenCalledTimes(1);
});

test("partway through -> Continue, and a line about where they stopped", () => {
  const open = vi.fn();
  mount(
    <IntakeInviteWidget
      store={store((p) => completeBlock(p, 1))}
      asOf={AS_OF}
      onSave={async () => {}}
      onOpenIntake={open}
    />,
  );
  expect(text()).toContain("The questions about your situation are still open.");
  act(() => button("Continue").click());
  expect(open).toHaveBeenCalledTimes(1);
});

test("inviteState: fresh, step 0 done, blocks, finished, and finished with fresh risk", () => {
  expect(inviteState(null, AS_OF)).toEqual({ resumeAt: null, riskDue: false });
  expect(
    inviteState(
      store((p) => p),
      AS_OF,
    ),
  ).toEqual({ resumeAt: null, riskDue: false });
  expect(
    inviteState(
      store((p) => markStep0(p, "upload")),
      AS_OF,
    ),
  ).toEqual({
    resumeAt: "block1",
    riskDue: false,
  });
  expect(
    inviteState(
      store((p) => completeBlock(p, 2)),
      AS_OF,
    )?.resumeAt,
  ).toBe("block3");
  expect(inviteState(doneWithRisk("2026-08-01"), AS_OF)).toBeNull();
});

test("risk due -> resume at block 3: blocksDone goes to 2, answers stay, then the intake opens", async () => {
  const s = doneWithRisk("2025-09-01");
  expect(inviteState(s, AS_OF)).toEqual({ resumeAt: "block3", riskDue: true });
  const saved: AdvisorProfileStore[] = [];
  const open = vi.fn();
  mount(
    <IntakeInviteWidget
      store={s}
      asOf={AS_OF}
      onSave={async (n) => {
        saved.push(n);
      }}
      onOpenIntake={open}
    />,
  );
  expect(text()).toContain("time to look at your answers about risk again");
  await act(async () => button("Continue").click());
  expect(saved).toHaveLength(1);
  expect(saved[0]!.current.intake.blocksDone).toBe(2);
  expect(saved[0]!.current.risk?.answers).toEqual(answers);
  expect(open).toHaveBeenCalledTimes(1);
});

test("a failed save keeps the user on the home screen", async () => {
  const open = vi.fn();
  mount(
    <IntakeInviteWidget
      store={doneWithRisk("2025-09-01")}
      asOf={AS_OF}
      onSave={async () => {
        throw new Error("vault");
      }}
      onOpenIntake={open}
    />,
  );
  await act(async () => button("Continue").click());
  expect(open).not.toHaveBeenCalled();
});

test("intake done and risk current -> no invitation", () => {
  mount(
    <IntakeInviteWidget
      store={doneWithRisk("2026-08-01")}
      asOf={AS_OF}
      onSave={async () => {}}
      onOpenIntake={() => {}}
    />,
  );
  expect(container!.querySelector("[data-testid=intake-invite]")).toBeNull();
});

test("the invitation is a widget: registered, on by default, and the picker switch removes it", () => {
  expect(WIDGETS.some((w) => w.id === "intake-invite" && w.defaultOn === true)).toBe(true);
  setEnabledWidgets(["room-card"]);
  mount(
    <IntakeInviteWidget
      store={null}
      asOf={AS_OF}
      onSave={async () => {}}
      onOpenIntake={() => {}}
    />,
  );
  expect(container!.querySelector("[data-testid=intake-invite]")).toBeNull();
});

test("the invitation text trips no advice-language rule", () => {
  mount(<IntakeInviteCard resumeAt="block2" onStart={() => {}} />);
  expect(findAdviceLanguage(text(), "en")).toEqual([]);
});

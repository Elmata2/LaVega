// @vitest-environment jsdom
import { StrictMode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  RISK_SCALE,
  emptyProfile,
  findAdviceLanguage,
  type AdvisorProfileStore,
} from "@lavega/core";
import { HomePopups, type HomePopupsProps } from "./HomePopups";
import { intakeCopy } from "../copy/intake";
import { POPUPS_KEY, POPUP_SHOWN_KEY, forgetPopupMemory } from "../lib/popups";
import {
  applyBirthYear,
  applyForeignSpend,
  applyIncomeRegularity,
  applyPriorities,
  applyRiskAnswers,
  applySpendMix,
  applyStatedBanks,
} from "../intake/state";
import { markDone } from "../intake/wizard/screens";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AS_OF = "2026-10-23";
const NOW = "2026-11-13T09:00:00.000Z";
const DAY = 86_400_000;
const at = (days: number) => new Date(Date.parse(NOW) + days * DAY).toISOString();
const nl = intakeCopy.nl.home;

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  forgetPopupMemory();
  document.cookie = "lavega_locale=nl";
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  document.cookie = "lavega_locale=; Max-Age=0; Path=/";
  vi.restoreAllMocks();
});

const store = (build: (p: ReturnType<typeof emptyProfile>) => ReturnType<typeof emptyProfile>) =>
  ({
    current: build(emptyProfile()),
    versions: [],
    updatedAt: "2026-10-01T00:00:00Z",
  }) as AdvisorProfileStore;
const answers = Object.fromEntries(RISK_SCALE.items.map((i) => [i.id, i.options[0]!.id]));
const answerNew = (p: ReturnType<typeof emptyProfile>, banks: string[] = ["other"]) =>
  applyPriorities(
    applyForeignSpend(
      applySpendMix(
        applyStatedBanks(
          applyIncomeRegularity(applyBirthYear(p, 1990, AS_OF), "fixed", AS_OF),
          banks as never,
          AS_OF,
        ),
        ["groceries"],
        AS_OF,
      ),
      "never",
      AS_OF,
    ),
    ["save-more"],
    AS_OF,
  );
const finished = (riskAt: string, banks: string[] = ["other"]) =>
  store((p) =>
    answerNew(
      markDone(applyRiskAnswers(markDone(p, "invested"), answers, riskAt), "upload"),
      banks,
    ),
  );

function props(over: Partial<HomePopupsProps> = {}): HomePopupsProps {
  return {
    view: "overview",
    blocked: false,
    store: null,
    profileReady: true,
    asOf: AS_OF,
    hasTransactions: false,
    accounts: [],
    onSave: async () => {},
    onOpenIntake: () => {},
    onOpenRound2: () => {},
    onOpenAccounts: () => {},
    now: () => NOW,
    ...over,
  };
}

async function frame() {
  await act(async () => {
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  });
}
async function mount(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
  await frame();
}
async function rerender(node: React.ReactNode) {
  act(() => root!.render(node));
  await frame();
}
const dialogs = () => [...document.querySelectorAll<HTMLDialogElement>("dialog")];
const title = () => document.querySelector("dialog h2")?.textContent ?? null;
const button = (label: string) =>
  [...document.querySelectorAll("dialog button")].find((b) => b.textContent === label) as
    | HTMLButtonElement
    | undefined;
const popups = () => JSON.parse(localStorage.getItem(POPUPS_KEY) ?? "{}") as Record<string, string>;

test("no profile: the intake dialog opens; Begin calls onOpenIntake and writes no dismissal", async () => {
  const onOpenIntake = vi.fn();
  await mount(<HomePopups {...props({ onOpenIntake })} />);
  expect(title()).toBe(nl.invite.title);
  expect(dialogs()[0]!.open).toBe(true);
  act(() => button("Begin")!.click());
  expect(onOpenIntake).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem(POPUPS_KEY)).toBeNull();
  expect(dialogs()[0]!.open).toBe(false);
});

test("Later writes the dismissal, closes, and the pop-up stays away for 7 days", async () => {
  await mount(<HomePopups {...props()} />);
  act(() => button("Later")!.click());
  expect(popups()["intake:intake"]).toBe(NOW);
  expect(dialogs()[0]!.open).toBe(false);
  act(() => root!.unmount());
  container!.remove();

  sessionStorage.removeItem(POPUP_SHOWN_KEY);
  forgetPopupMemory();
  await mount(<HomePopups {...props({ now: () => at(6) })} />);
  expect(title()).toBeNull();
  act(() => root!.unmount());
  container!.remove();

  sessionStorage.removeItem(POPUP_SHOWN_KEY);
  forgetPopupMemory();
  await mount(<HomePopups {...props({ now: () => at(8) })} />);
  expect(title()).toBe(nl.invite.title);
});

test("the close button dismisses like Later", async () => {
  await mount(<HomePopups {...props()} />);
  act(() => document.querySelector<HTMLButtonElement>("button[aria-label=Sluiten]")!.click());
  expect(popups()["intake:intake"]).toBe(NOW);
});

test("a half-done intake says where it stopped and offers Ga verder", async () => {
  await mount(<HomePopups {...props({ store: store((p) => markDone(p, "housing")) })} />);
  expect(document.querySelector("dialog")!.textContent).toContain(nl.invite.resumed);
  expect(button("Ga verder")).toBeDefined();
});

test("new questions: own title and count, primary opens the intake", async () => {
  const onOpenIntake = vi.fn();
  const s = store((p) =>
    markDone(applyRiskAnswers(markDone(p, "invested"), answers, "2026-08-01"), "upload"),
  );
  await mount(<HomePopups {...props({ store: s, onOpenIntake })} />);
  expect(title()).toBe(nl.invite.newQuestions.title);
  act(() => button("Begin")!.click());
  expect(onOpenIntake).toHaveBeenCalledTimes(1);
});

test("round 2: own title, primary calls onOpenRound2", async () => {
  const onOpenRound2 = vi.fn();
  const onOpenIntake = vi.fn();
  await mount(
    <HomePopups
      {...props({
        store: finished("2026-10-01"),
        hasTransactions: true,
        onOpenRound2,
        onOpenIntake,
      })}
    />,
  );
  expect(title()).toBe(nl.invite.round2.title);
  act(() => button("Begin")!.click());
  expect(onOpenRound2).toHaveBeenCalledTimes(1);
  expect(onOpenIntake).not.toHaveBeenCalled();
});

test("risk due: the reopenRisk save resolves first, then the intake opens", async () => {
  const saved: AdvisorProfileStore[] = [];
  const onOpenIntake = vi.fn();
  await mount(
    <HomePopups
      {...props({
        store: finished("2025-09-01"),
        onSave: async (n) => {
          saved.push(n);
        },
        onOpenIntake,
      })}
    />,
  );
  expect(document.querySelector("dialog")!.textContent).toContain(nl.invite.riskDue);
  await act(async () => button("Ga verder")!.click());
  expect(saved).toHaveLength(1);
  expect(saved[0]!.current.intake.blocksDone).toBe(2);
  expect(saved[0]!.current.risk?.answers).toEqual(answers);
  expect(onOpenIntake).toHaveBeenCalledTimes(1);
  expect(popups()["intake:risk"]).toBeUndefined();
});

test("risk due: a failed save keeps the dialog open and the wizard closed", async () => {
  const onOpenIntake = vi.fn();
  await mount(
    <HomePopups
      {...props({
        store: finished("2025-09-01"),
        onSave: async () => {
          throw new Error("vault");
        },
        onOpenIntake,
      })}
    />,
  );
  await act(async () => button("Ga verder")!.click());
  expect(onOpenIntake).not.toHaveBeenCalled();
  expect(dialogs()[0]!.open).toBe(true);
});

test("finished intake and an unconnected brand: connect dialog, one primary to Rekeningen", async () => {
  const onOpenAccounts = vi.fn();
  await mount(
    <HomePopups {...props({ store: finished("2026-08-01", ["abn"]), onOpenAccounts })} />,
  );
  expect(title()).toBe(nl.connect.title);
  expect(document.querySelector("dialog")!.textContent).toContain(nl.connect.line("ABN AMRO"));
  expect(document.querySelectorAll("dialog li")).toHaveLength(1);
  act(() => button(nl.connect.link)!.click());
  expect(onOpenAccounts).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem(POPUPS_KEY)).toBeNull();
  expect(dialogs()[0]!.open).toBe(false);
});

test("connect Later is its own id: it does not silence a later intake pop-up", async () => {
  await mount(<HomePopups {...props({ store: finished("2026-08-01", ["abn"]) })} />);
  act(() => button("Later")!.click());
  expect(Object.keys(popups())).toEqual(["connect"]);
});

test("another view, or a blocked page, or an unready profile: nothing opens", async () => {
  await mount(<HomePopups {...props({ view: "profiel" })} />);
  expect(title()).toBeNull();
  await rerender(<HomePopups {...props({ profileReady: false })} />);
  expect(title()).toBeNull();
  await rerender(<HomePopups {...props({ blocked: true })} />);
  expect(title()).toBeNull();
  expect(sessionStorage.getItem(POPUP_SHOWN_KEY)).toBeNull();
});

test("when blocked turns false on the same mount, the dialog opens", async () => {
  await mount(<HomePopups {...props({ blocked: true })} />);
  expect(title()).toBeNull();
  await rerender(<HomePopups {...props({ blocked: false })} />);
  expect(title()).toBe(nl.invite.title);
});

test("a remount in the same session shows nothing", async () => {
  await mount(<HomePopups {...props()} />);
  expect(title()).not.toBeNull();
  act(() => root!.unmount());
  container!.remove();
  await mount(<HomePopups {...props()} />);
  expect(title()).toBeNull();
});

test("under StrictMode exactly one dialog opens", async () => {
  await mount(
    <StrictMode>
      <HomePopups {...props()} />
    </StrictMode>,
  );
  expect(dialogs().filter((d) => d.open)).toHaveLength(1);
  expect(title()).toBe(nl.invite.title);
});

test("nothing opens when storage is blocked, and the in-memory mark still holds", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  await mount(<HomePopups {...props()} />);
  expect(title()).toBe(nl.invite.title);
  act(() => root!.unmount());
  container!.remove();
  await mount(<HomePopups {...props()} />);
  expect(title()).toBeNull();
});

test("the copy has no advice language", () => {
  for (const l of ["nl", "en"] as const) {
    const h = intakeCopy[l].home;
    for (const t of [h.later, h.closeDialog, h.connect.link]) {
      expect(findAdviceLanguage(t, l)).toEqual([]);
    }
  }
});

test("Escape (cancel) dismisses the shown pop-up id", async () => {
  await mount(<HomePopups {...props({ store: finished("2026-08-01", ["abn"]) })} />);
  act(() => {
    dialogs()[0]!.dispatchEvent(new Event("cancel", { cancelable: true }));
  });
  expect(popups()["connect"]).toBe(NOW);
  expect(dialogs()[0]!.open).toBe(false);
});

test("leaving the overview closes the open dialog without a dismissal", async () => {
  await mount(<HomePopups {...props()} />);
  expect(dialogs()[0]!.open).toBe(true);
  await rerender(<HomePopups {...props({ view: "profiel" })} />);
  expect(dialogs()[0]!.open).toBe(false);
  expect(localStorage.getItem(POPUPS_KEY)).toBeNull();
  await rerender(<HomePopups {...props()} />);
  expect(dialogs()[0]!.open).toBe(false);
});

test("a blocked page closes the open dialog without a dismissal", async () => {
  await mount(<HomePopups {...props()} />);
  await rerender(<HomePopups {...props({ blocked: true })} />);
  expect(dialogs()[0]!.open).toBe(false);
  expect(localStorage.getItem(POPUPS_KEY)).toBeNull();
});

test("a double click on the risk button saves and opens once", async () => {
  const saved: AdvisorProfileStore[] = [];
  const onOpenIntake = vi.fn();
  await mount(
    <HomePopups
      {...props({
        store: finished("2025-09-01"),
        onSave: async (n) => {
          saved.push(n);
        },
        onOpenIntake,
      })}
    />,
  );
  const b = button("Ga verder")!;
  await act(async () => {
    b.click();
    b.click();
  });
  expect(saved).toHaveLength(1);
  expect(onOpenIntake).toHaveBeenCalledTimes(1);
});

function slowSave() {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  return { release: () => release(), onSave: async () => gate };
}

test("risk due: dismissing while the save runs does not open the wizard afterwards", async () => {
  const onOpenIntake = vi.fn();
  const slow = slowSave();
  await mount(
    <HomePopups {...props({ store: finished("2025-09-01"), onSave: slow.onSave, onOpenIntake })} />,
  );
  await act(async () => button("Ga verder")!.click());
  await act(async () => button(nl.later)!.click());
  expect(dialogs()[0]!.open).toBe(false);
  await act(async () => {
    slow.release();
    await Promise.resolve();
  });
  expect(onOpenIntake).not.toHaveBeenCalled();
});

test("risk due: leaving the overview while the save runs does not open the wizard", async () => {
  const onOpenIntake = vi.fn();
  const slow = slowSave();
  const p = props({ store: finished("2025-09-01"), onSave: slow.onSave, onOpenIntake });
  await mount(<HomePopups {...p} />);
  await act(async () => button("Ga verder")!.click());
  await rerender(<HomePopups {...p} view="profiel" />);
  await act(async () => {
    slow.release();
    await Promise.resolve();
  });
  expect(onOpenIntake).not.toHaveBeenCalled();
});

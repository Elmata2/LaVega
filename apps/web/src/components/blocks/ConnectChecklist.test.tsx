// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { emptyProfile, findAdviceLanguage, type AdvisorProfileStore } from "@lavega/core";
import { ConnectChecklist, ConnectChecklistWidget } from "./ConnectChecklist";
import { intakeCopy } from "../../copy/intake";
import { setEnabledWidgets } from "../moduleRegistry";

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
function mount(node: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
}
const text = () => container!.textContent ?? "";
const AT = "2026-11-01T00:00:00Z";
const field = <T,>(value: T) => ({ value, source: "stated" as const, at: AT });
const store = (patch: Record<string, unknown>) =>
  ({
    current: { ...emptyProfile(), ...patch },
    versions: [],
    updatedAt: AT,
  }) as AdvisorProfileStore;

test("lists an unconnected stated bank and one implied by a card, once each", () => {
  const open = vi.fn();
  mount(
    <ConnectChecklist
      store={store({
        statedBanks: field(["abn", "other"]),
        statedCards: field(["american-express-gold-card"]),
        statedDebitCards: field(["other"]),
      })}
      accounts={[]}
      onOpenAccounts={open}
    />,
  );
  expect(text()).toContain("ABN AMRO is not connected yet");
  expect(text()).toContain("American Express is not connected yet");
  expect(container!.querySelectorAll("li")).toHaveLength(2);
  act(() => container!.querySelector<HTMLButtonElement>("[data-testid=connect-checklist-link]")!.click());
  expect(open).toHaveBeenCalledTimes(1);
});

test("block hides when all connected", () => {
  mount(
    <ConnectChecklist
      store={store({ statedBanks: field(["ing"]) })}
      accounts={[{ bank: "ING", linkedAt: AT }]}
      onOpenAccounts={() => {}}
    />,
  );
  expect(container!.innerHTML).toBe("");
});

test("block hides with no stated banks or cards", () => {
  mount(<ConnectChecklist store={store({})} accounts={[]} onOpenAccounts={() => {}} />);
  expect(container!.innerHTML).toBe("");
  act(() => root!.render(<ConnectChecklist store={null} accounts={[]} onOpenAccounts={() => {}} />));
  expect(container!.innerHTML).toBe("");
});

test("the widget is on by default and can be switched off", () => {
  const props = {
    store: store({ statedBanks: field(["knab"]) }),
    accounts: [],
    onOpenAccounts: () => {},
  };
  mount(<ConnectChecklistWidget {...props} />);
  expect(text()).toContain("Knab is not connected yet");
  act(() => root!.unmount());
  container!.remove();
  setEnabledWidgets([]);
  mount(<ConnectChecklistWidget {...props} />);
  expect(container!.innerHTML).toBe("");
});

test("copy has no advice language and no hyphen in the sentence", () => {
  for (const l of ["nl", "en"] as const) {
    const c = intakeCopy[l].home.connect;
    const all = [c.title, c.line("ING"), c.link];
    for (const t of all) {
      expect(findAdviceLanguage(t, l)).toEqual([]);
      expect(t).not.toMatch(/\s-\s|\w-\w/);
    }
  }
});

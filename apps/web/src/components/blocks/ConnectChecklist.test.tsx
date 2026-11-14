// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { emptyProfile, type AdvisorProfileStore } from "@lavega/core";
import { ConnectChecklist } from "./ConnectChecklist";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;
beforeEach(() => {
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
const AT = "2026-11-01T00:00:00Z";
const field = <T,>(value: T) => ({ value, source: "stated" as const, at: AT });
const store = (patch: Record<string, unknown>) =>
  ({
    current: { ...emptyProfile(), ...patch },
    versions: [],
    updatedAt: AT,
  }) as AdvisorProfileStore;

test("one line per unconnected brand; the link opens accounts", () => {
  const open = vi.fn();
  mount(
    <ConnectChecklist
      store={store({
        statedBanks: field(["abn", "other"]),
        statedCards: field(["american-express-gold-card"]),
      })}
      accounts={[]}
      onOpenAccounts={open}
    />,
  );
  expect(container!.textContent).toContain("ABN AMRO is not connected yet");
  expect(container!.textContent).toContain("American Express is not connected yet");
  expect(container!.querySelectorAll("li")).toHaveLength(2);
  act(() =>
    container!.querySelector<HTMLButtonElement>("[data-testid=connect-checklist-link]")!.click(),
  );
  expect(open).toHaveBeenCalledTimes(1);
});

test("renders nothing when all are connected or nothing is stated", () => {
  mount(
    <ConnectChecklist
      store={store({ statedBanks: field(["ing"]) })}
      accounts={[{ bank: "ING", linkedAt: AT }]}
      onOpenAccounts={() => {}}
    />,
  );
  expect(container!.innerHTML).toBe("");
  act(() =>
    root!.render(<ConnectChecklist store={null} accounts={[]} onOpenAccounts={() => {}} />),
  );
  expect(container!.innerHTML).toBe("");
});

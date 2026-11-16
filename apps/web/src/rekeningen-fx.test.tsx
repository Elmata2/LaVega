// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ComponentProps } from "react";
import Rekeningen from "./views/Rekeningen";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* Vreemde valuta lives on Rekeningen now: a quiet control in the card header opens
 * the shared Dialog with the convert / separate checkbox. Same state, same handler. */

const noop = () => {};
function props(): ComponentProps<typeof Rekeningen> {
  return {
    accounts: [],
    txs: [],
    busy: false,
    onEntityChange: noop,
    onAccountCommit: noop,
    onAccountFieldChange: noop,
    onSaldoCommit: noop,
    onTypeCommit: noop,
    onSelectAccount: noop,
    onDeleteAccount: noop,
    duplicateGroups: [],
    onMergeDuplicates: noop,
    valuations: [],
    asOf: "2026-11-11",
    onOpeningCommit: noop,
    onValuationCommit: noop,
    onValuationRemove: noop,
  };
}

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

function render(overrides: Partial<ComponentProps<typeof Rekeningen>> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Rekeningen {...props()} {...overrides} />));
  return container;
}

const opener = () => container!.querySelector<HTMLElement>('[data-testid="fx-settings-open"]');
const dialog = () => container!.querySelector("dialog")!;
const checkbox = () =>
  container!.querySelector<HTMLInputElement>(
    'input[aria-label="Vreemde valuta omrekenen naar euro"]',
  );

test("without the fx props there is no control", () => {
  render();
  expect(opener()).toBeNull();
  expect(container!.querySelector("dialog")).toBeNull();
});

test("the control opens the dialog, the checkbox toggles the mode, Escape closes", () => {
  const onChange = vi.fn();
  render({ fxConversionMode: "convert", onFxConversionModeChange: onChange });
  expect(opener()?.textContent).toBe("Valuta-instellingen");
  expect(dialog().open).toBe(false);

  act(() => opener()!.click());
  expect(dialog().open).toBe(true);
  expect(dialog().textContent).toContain("Vreemde valuta");
  expect(dialog().textContent).toContain("ECB-koers");
  expect(checkbox()!.checked).toBe(true);

  act(() => checkbox()!.click());
  expect(onChange).toHaveBeenCalledWith("separate");

  act(() => {
    dialog().dispatchEvent(new Event("cancel", { bubbles: false, cancelable: true }));
  });
  expect(dialog().open).toBe(false);
});

test("the checkbox follows the mode prop", () => {
  render({ fxConversionMode: "separate", onFxConversionModeChange: noop });
  act(() => opener()!.click());
  expect(checkbox()!.checked).toBe(false);
});

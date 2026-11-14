// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AssistantSheet } from "./AssistantSheet";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement;

function render(open: boolean, onClose: () => void = () => {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <AssistantSheet
        open={open}
        onClose={onClose}
        title="Assistent"
        closeLabel="Assistent sluiten"
        initialFocus="#field"
      >
        <input id="field" />
        <button type="button" id="last">
          x
        </button>
      </AssistantSheet>,
    ),
  );
}
const dialog = () => host.querySelector<HTMLElement>('[role="dialog"]')!;
const key = (k: string, shiftKey = false) =>
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: k, shiftKey, bubbles: true }));
  });

beforeEach(() => {
  document.cookie = "lavega_locale=nl";
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
  vi.restoreAllMocks();
});

test("a modal dialog labelled by its title", () => {
  render(true);
  expect(dialog().getAttribute("aria-modal")).toBe("true");
  const label = host.querySelector(`#${CSS.escape(dialog().getAttribute("aria-labelledby")!)}`);
  expect(label?.textContent).toBe("Assistent");
});

test("closed: inert, so it holds no focus and no tab stop", () => {
  render(false);
  expect(host.querySelector(".shell2-sheet-root")!.hasAttribute("inert")).toBe(true);
});

test("Escape and the scrim call onClose", () => {
  const onClose = vi.fn();
  render(true, onClose);
  key("Escape");
  expect(onClose).toHaveBeenCalledTimes(1);
  act(() => host.querySelector<HTMLElement>(".shell2-scrim")!.click());
  expect(onClose).toHaveBeenCalledTimes(2);
});

test("the close button is named by closeLabel", () => {
  const onClose = vi.fn();
  render(true, onClose);
  act(() =>
    host.querySelector<HTMLButtonElement>('button[aria-label="Assistent sluiten"]')!.click(),
  );
  expect(onClose).toHaveBeenCalledTimes(1);
});

test("opening moves focus to the initialFocus element", () => {
  render(true);
  expect(document.activeElement?.id).toBe("field");
});

test("Tab wraps at both ends", () => {
  render(true);
  host.querySelector<HTMLElement>("#last")!.focus();
  key("Tab");
  expect(document.activeElement).toBe(host.querySelector(".shell2-sheet-close"));
  key("Tab", true);
  expect(document.activeElement?.id).toBe("last");
});

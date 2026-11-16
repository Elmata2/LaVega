// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import Dialog, { type DialogProps } from "./Dialog";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;

function render(props: Partial<DialogProps> = {}) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const full: DialogProps = {
    open: true,
    onClose: () => {},
    title: "Titel",
    closeLabel: "Sluiten",
    children: <p data-testid="body">Inhoud</p>,
    ...props,
  };
  act(() => root!.render(<Dialog {...full} />));
  return full;
}

function rerender(props: DialogProps) {
  act(() => root!.render(<Dialog {...props} />));
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

describe("Dialog", () => {
  it("opens with showModal and labels itself by the title", () => {
    const spy = vi.spyOn(HTMLDialogElement.prototype, "showModal");
    render();
    const dialog = document.querySelector("dialog")!;
    expect(spy).toHaveBeenCalledTimes(1);
    const heading = dialog.querySelector("h2")!;
    expect(heading.textContent).toBe("Titel");
    expect(dialog.getAttribute("aria-labelledby")).toBe(heading.id);
    expect(heading.id).not.toBe("");
  });

  it("Escape (cancel) calls onClose and keeps the native close out", () => {
    const onClose = vi.fn();
    render({ onClose });
    const event = new Event("cancel", { cancelable: true });
    act(() => {
      document.querySelector("dialog")!.dispatchEvent(event);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("a native close while open is still true calls onClose", () => {
    const onClose = vi.fn();
    render({ onClose });
    act(() => {
      document.querySelector("dialog")!.dispatchEvent(new Event("close"));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("the close event of our own close() does not call onClose", () => {
    const onClose = vi.fn();
    const props = render({ onClose });
    rerender({ ...props, open: false });
    act(() => {
      document.querySelector("dialog")!.dispatchEvent(new Event("close"));
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("a click on the dialog itself closes, a click inside does not", () => {
    const onClose = vi.fn();
    render({ onClose });
    act(() => {
      document.querySelector<HTMLElement>("[data-testid=body]")!.click();
    });
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      document.querySelector("dialog")!.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes the element when open turns false", () => {
    const props = render();
    const dialog = document.querySelector("dialog")!;
    expect(dialog.open).toBe(true);
    rerender({ ...props, open: false });
    expect(dialog.open).toBe(false);
  });

  it("the close button is named by closeLabel and calls onClose", () => {
    const onClose = vi.fn();
    render({ onClose });
    const button = document.querySelector<HTMLButtonElement>("button[aria-label=Sluiten]")!;
    expect(button).not.toBeNull();
    act(() => button.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("focuses initialFocusRef after opening", () => {
    const ref = { current: null as HTMLButtonElement | null };
    render({
      initialFocusRef: ref,
      actions: (
        <button type="button" ref={ref}>
          Ga
        </button>
      ),
    });
    expect(document.activeElement).toBe(ref.current);
  });

  it("renders actions in the footer", () => {
    render({ actions: <button type="button">Ga</button> });
    expect(document.querySelector(".ui-dialog-actions button")?.textContent).toBe("Ga");
  });
});

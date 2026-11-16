// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { SidebarResizeHandle } from "./SidebarResizeHandle";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement;
const onDrag = vi.fn();
const onCommit = vi.fn();
const onReset = vi.fn();

function render(width = 296, max = 440) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <SidebarResizeHandle
        width={width}
        min={240}
        max={max}
        onDrag={onDrag}
        onCommit={onCommit}
        onReset={onReset}
        controls="shell2-sidebar"
      />,
    ),
  );
}
const handle = () => host.querySelector<HTMLElement>('[role="separator"]')!;
const key = (k: string, shiftKey = false) =>
  act(() => {
    handle().dispatchEvent(new KeyboardEvent("keydown", { key: k, shiftKey, bubbles: true }));
  });
const ptr = (target: EventTarget, type: string, clientX: number) =>
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { clientX, bubbles: true, button: 0 }));
  });

beforeEach(() => {
  document.cookie = "lavega_locale=nl";
  onDrag.mockReset();
  onCommit.mockReset();
  onReset.mockReset();
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
});

test("separator semantics", () => {
  render();
  const h = handle();
  expect(h.getAttribute("aria-orientation")).toBe("vertical");
  expect(h.getAttribute("tabindex")).toBe("0");
  expect(h.getAttribute("aria-valuenow")).toBe("296");
  expect(h.getAttribute("aria-valuemin")).toBe("240");
  expect(h.getAttribute("aria-valuemax")).toBe("440");
  expect(h.getAttribute("aria-label")).toBe("Breedte zijbalk");
});

test("ArrowRight widens by 16, ArrowLeft narrows by 16, Shift by 64", () => {
  render();
  key("ArrowRight");
  expect(onCommit).toHaveBeenLastCalledWith(312);
  key("ArrowLeft");
  expect(onCommit).toHaveBeenLastCalledWith(280);
  key("ArrowRight", true);
  expect(onCommit).toHaveBeenLastCalledWith(360);
  key("ArrowLeft", true);
  expect(onCommit).toHaveBeenLastCalledWith(240);
});

test("keyboard never leaves min..max", () => {
  render(430);
  key("ArrowRight", true);
  expect(onCommit).toHaveBeenLastCalledWith(440);
});

test("Home and End jump to min and max", () => {
  render();
  key("Home");
  expect(onCommit).toHaveBeenLastCalledWith(240);
  key("End");
  expect(onCommit).toHaveBeenLastCalledWith(440);
});

test("Enter and double-click reset", () => {
  render();
  key("Enter");
  expect(onReset).toHaveBeenCalledTimes(1);
  act(() => {
    handle().dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  });
  expect(onReset).toHaveBeenCalledTimes(2);
});

test("drag: moves report live widths, storage commit only on pointer-up", () => {
  render();
  ptr(handle(), "pointerdown", 300);
  expect(onCommit).not.toHaveBeenCalled();
  expect(onDrag).toHaveBeenLastCalledWith(296);
  ptr(window, "pointermove", 340);
  expect(onDrag).toHaveBeenLastCalledWith(336);
  ptr(window, "pointermove", 900);
  expect(onDrag).toHaveBeenLastCalledWith(440);
  ptr(window, "pointermove", 0);
  expect(onDrag).toHaveBeenLastCalledWith(240);
  expect(onCommit).not.toHaveBeenCalled();
  ptr(window, "pointerup", 0);
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(onCommit).toHaveBeenCalledWith(240);
  ptr(window, "pointermove", 400);
  expect(onDrag).toHaveBeenCalledTimes(4);
});

test("unmounting mid-drag removes the window listeners and commits nothing", () => {
  render();
  ptr(handle(), "pointerdown", 300);
  act(() => root!.unmount());
  root = null;
  onDrag.mockClear();
  ptr(window, "pointermove", 400);
  ptr(window, "pointerup", 400);
  expect(onDrag).not.toHaveBeenCalled();
  expect(onCommit).not.toHaveBeenCalled();
});

test("the separator names the sidebar it controls", () => {
  render();
  expect(handle().getAttribute("aria-controls")).toBe("shell2-sidebar");
});

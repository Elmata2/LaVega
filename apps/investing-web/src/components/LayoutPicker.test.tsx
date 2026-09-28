// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { LayoutPicker } from "./LayoutPicker.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(() => vi.restoreAllMocks());

function render() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  return { container, root };
}

test("module picker locks Overview's switch and lists every other module", () => {
  const onChange = vi.fn();
  const { container, root } = render();
  act(() => {
    root.render(
      <LayoutPicker
        kind="module"
        enabled={["overview", "positions", "net-worth", "agents"]}
        onChange={onChange}
      />,
    );
  });
  const switches = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="switch"]'));
  expect(switches).toHaveLength(4);
  expect(switches[0]?.disabled).toBe(true);
  expect(switches[0]?.getAttribute("aria-checked")).toBe("true");
  root.unmount();
});

test("clicking a switch reports the next enabled set, not a mutation of the old one", () => {
  const onChange = vi.fn();
  const { container, root } = render();
  act(() => {
    root.render(<LayoutPicker kind="widget" enabled={["performance", "kpis"]} onChange={onChange} />);
  });
  const switches = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="switch"]'));
  const performanceSwitch = switches.find((el) => el.getAttribute("aria-checked") === "true")!;
  act(() => performanceSwitch.click());
  expect(onChange).toHaveBeenCalledWith(["kpis"]);
  root.unmount();
});

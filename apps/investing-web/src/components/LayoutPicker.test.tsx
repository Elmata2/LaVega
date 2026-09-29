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

test("clicking a switch reports only that id and its new state", () => {
  const onChange = vi.fn();
  const { container, root } = render();
  act(() => {
    root.render(
      <LayoutPicker kind="widget" enabled={["performance", "kpis"]} onChange={onChange} />,
    );
  });
  const switches = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="switch"]'));
  act(() =>
    switches.find((el) => el.getAttribute("aria-label") === "Performance on Overview")!.click(),
  );
  act(() =>
    switches
      .find((el) => el.getAttribute("aria-label") === "Sector allocation on Overview")!
      .click(),
  );
  expect(onChange.mock.calls).toEqual([
    ["performance", false],
    ["sectors", true],
  ]);
  root.unmount();
});

test("a disabled picker shows every switch as disabled and reports nothing", () => {
  const onChange = vi.fn();
  const { container, root } = render();
  act(() => {
    root.render(
      <LayoutPicker
        kind="module"
        enabled={["overview", "positions", "net-worth", "agents"]}
        onChange={onChange}
        disabled
      />,
    );
  });
  const switches = Array.from(container.querySelectorAll<HTMLButtonElement>('[role="switch"]'));
  for (const el of switches) {
    expect(el.disabled).toBe(true);
    expect(el.getAttribute("aria-disabled")).toBe("true");
  }
  act(() => switches[1]!.click());
  expect(onChange).not.toHaveBeenCalled();
  root.unmount();
});

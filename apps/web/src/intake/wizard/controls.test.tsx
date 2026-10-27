// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import ChoiceTiles from "./ChoiceTiles";
import MultiTiles from "./MultiTiles";
import WizardFrame from "./WizardFrame";
import AmountField from "./AmountField";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let el: HTMLElement | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  el?.remove();
  root = null;
  el = null;
});
function mount(node: React.ReactNode) {
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  act(() => root!.render(node));
  return el;
}

test("ChoiceTiles marks the stored value checked and calls onPick once", () => {
  const onPick = vi.fn();
  const c = mount(
    <ChoiceTiles
      label="Q"
      selected="b"
      onPick={onPick}
      options={[
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ]}
    />,
  );
  const radios = [...c.querySelectorAll('[role="radio"]')] as HTMLButtonElement[];
  expect(c.querySelector('[role="radiogroup"]')).not.toBeNull();
  expect(radios.map((r) => r.getAttribute("aria-checked"))).toEqual(["false", "true"]);
  act(() => radios[0]!.click());
  expect(onPick).toHaveBeenCalledTimes(1);
  expect(onPick).toHaveBeenCalledWith("a");
});

test("ChoiceTiles arrow keys move focus", () => {
  const c = mount(
    <ChoiceTiles
      label="Q"
      selected={null}
      onPick={() => {}}
      options={[
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ]}
    />,
  );
  const radios = [...c.querySelectorAll("button")] as HTMLButtonElement[];
  radios[0]!.focus();
  act(() => {
    radios[0]!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });
  expect(document.activeElement).toBe(radios[1]);
});

test("WizardFrame shows n / N and hides back on the first screen", () => {
  const c = mount(
    <WizardFrame step={1} total={20} section="S" question="Vraag?" onBack={null} backLabel="Terug">
      <p>x</p>
    </WizardFrame>,
  );
  expect(c.textContent).toContain("1 / 20");
  expect(c.querySelector(".wz-back")).toBeNull();
  const bar = c.querySelector('[role="progressbar"]')!;
  expect(bar.getAttribute("aria-valuenow")).toBe("1");
  expect(bar.getAttribute("aria-valuemax")).toBe("20");
  expect(c.querySelector("h1")!.textContent).toBe("Vraag?");
});

test("WizardFrame shows back after the first screen and moves focus to the question", () => {
  const onBack = vi.fn();
  const c = mount(
    <WizardFrame step={2} total={20} section="S" question="Q2" onBack={onBack} backLabel="Terug">
      <p>x</p>
    </WizardFrame>,
  );
  act(() => (c.querySelector(".wz-back") as HTMLButtonElement).click());
  expect(onBack).toHaveBeenCalledTimes(1);
  expect(document.activeElement).not.toBe(c.querySelector("h1"));
  const frame = (step: number) => (
    <WizardFrame step={step} total={20} section="S" question="Q" onBack={onBack} backLabel="Terug">
      <p>x</p>
    </WizardFrame>
  );
  act(() => root!.render(frame(3)));
  expect(document.activeElement).toBe(c.querySelector("h1"));
});

test("AmountField follows valueCents but keeps typing that still parses", () => {
  const f = (v: number | null) => <AmountField label="B" valueCents={v} onChange={() => {}} />;
  const c = mount(f(null));
  const input = c.querySelector("input")!;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    set.call(input, "3.250");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => root!.render(f(325000)));
  expect(input.value).toBe("3.250");
  act(() => root!.render(f(50000)));
  expect(input.value).toBe("500");
  act(() => root!.render(f(null)));
  expect(input.value).toBe("");
});

test("AmountField reports cents and null", () => {
  const onChange = vi.fn();
  const c = mount(<AmountField label="Bedrag" valueCents={null} onChange={onChange} />);
  const input = c.querySelector("input")!;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    set.call(input, "3.250");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(onChange).toHaveBeenLastCalledWith(325000);
  act(() => {
    set.call(input, "abc");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(onChange).toHaveBeenLastCalledWith(null);
});

test("MultiTiles toggles aria-checked", () => {
  const picked: string[] = [];
  const render = () => (
    <MultiTiles
      label="Q"
      selected={picked}
      onToggle={(v) => {
        const i = picked.indexOf(v);
        if (i >= 0) picked.splice(i, 1);
        else picked.push(v);
        act(() => root!.render(render()));
      }}
      options={[
        { value: "a", label: "A" },
        { value: "b", label: "B" },
      ]}
    />
  );
  const c = mount(render());
  const boxes = () => [...c.querySelectorAll('[role="checkbox"]')] as HTMLButtonElement[];
  expect(boxes().map((b) => b.getAttribute("aria-checked"))).toEqual(["false", "false"]);
  act(() => boxes()[0]!.click());
  act(() => boxes()[1]!.click());
  expect(boxes().map((b) => b.getAttribute("aria-checked"))).toEqual(["true", "true"]);
  act(() => boxes()[0]!.click());
  expect(boxes().map((b) => b.getAttribute("aria-checked"))).toEqual(["false", "true"]);
});

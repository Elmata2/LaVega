// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { wizardCopy } from "../../copy/wizard";
import CardPicker from "./CardPicker";
import { useState } from "react";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let el: HTMLElement | null = null;
afterEach(() => {
  if (root) act(() => root!.unmount());
  el?.remove();
  root = null;
  el = null;
});

function Harness({ lang = "nl" }: { lang?: "nl" | "en" }) {
  const [picked, setPicked] = useState<string[]>([]);
  return <CardPicker copy={wizardCopy[lang]} label="Kaarten" picked={picked} onChange={setPicked} />;
}
function mount(lang: "nl" | "en" = "nl") {
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  act(() => root!.render(<Harness lang={lang} />));
  return el;
}
const boxes = () => [...el!.querySelectorAll<HTMLElement>('[role="checkbox"]')].map((b) => b.textContent);
const brand = (re: RegExp) =>
  [...el!.querySelectorAll<HTMLButtonElement>("button[aria-expanded]")].find((b) =>
    re.test(b.textContent ?? ""),
  )!;
const click = (b: HTMLElement) => act(() => b.click());
const box = (name: string) =>
  [...el!.querySelectorAll<HTMLElement>('[role="checkbox"]')].find((b) => b.textContent === name)!;
function type(v: string) {
  const i = el!.querySelector<HTMLInputElement>("input[type=search]")!;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    set.call(i, v);
    i.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

test("empty search shows brand tiles, collapsed, no card checkboxes but the other choice", () => {
  mount();
  const brands = [...el!.querySelectorAll("button[aria-expanded]")];
  expect(brands.length).toBeGreaterThan(5);
  expect(brands.every((b) => b.getAttribute("aria-expanded") === "false")).toBe(true);
  expect(boxes()).toEqual(["Een andere kaart"]);
});

test("tapping American Express shows Blue, Gold, Platinum, Business Gold and Corporate", () => {
  mount();
  click(brand(/American Express/));
  expect(brand(/American Express/).getAttribute("aria-expanded")).toBe("true");
  const b = boxes();
  expect(b).toContain("American Express Blue Card");
  expect(b).toContain("American Express Gold Card");
  expect(b).toContain("American Express Platinum Card");
  expect(b).toContain("American Express Business Gold Card");
  expect(b).toContain("American Express Corporate Card");
  expect(b.at(-1)).toBe("Een andere kaart");
});

test("more than one brand can be open; a second tap closes one", () => {
  mount();
  click(brand(/American Express/));
  click(brand(/^ING/));
  expect(boxes()).toContain("ING creditcard");
  expect(boxes()).toContain("American Express Blue Card");
  click(brand(/American Express/));
  expect(boxes()).not.toContain("American Express Blue Card");
  expect(boxes()).toContain("ING creditcard");
});

test("picks survive collapse, search on/off, and show a count badge", () => {
  mount();
  click(brand(/American Express/));
  click(box("American Express Gold Card"));
  click(box("American Express Blue Card"));
  expect(brand(/American Express/).textContent).toContain("2 gekozen");
  click(brand(/American Express/));
  expect(brand(/American Express/).textContent).toContain("2 gekozen");
  type("amex");
  expect(box("American Express Gold Card").getAttribute("aria-checked")).toBe("true");
  expect(boxes()).toContain("American Express Business Gold Card");
  type("");
  click(brand(/American Express/));
  expect(box("American Express Gold Card").getAttribute("aria-checked")).toBe("true");
  expect(box("American Express Platinum Card").getAttribute("aria-checked")).toBe("false");
});

test("English badge, and a search with no match says so", () => {
  mount("en");
  click(brand(/American Express/));
  click(box("American Express Gold Card"));
  expect(brand(/American Express/).textContent).toContain("1 selected");
  type("zzzzqq");
  expect(el!.textContent).toContain("No card found");
});

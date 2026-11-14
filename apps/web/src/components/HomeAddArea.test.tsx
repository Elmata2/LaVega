// @vitest-environment jsdom
import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { shellCopy } from "../copy/shell";
import HomeAddArea from "./HomeAddArea";
import { resolvedAtContainerWidth } from "../test-support/resolveStyle";
import Module from "./Module";
import WidgetHideButton from "./WidgetHideButton";
import { WIDGETS, resetWidgets, setEnabledWidgets, useWidgetEnabled } from "./moduleRegistry";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const c = shellCopy.nl;
const KEY = "lavega.overviewWidgets";

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  localStorage.clear();
  resetWidgets();
  document.cookie = "lavega_locale=nl";
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  document.cookie = "lavega_locale=; Max-Age=0; Path=/";
  vi.restoreAllMocks();
});

function Aandacht() {
  return useWidgetEnabled("aandacht") ? (
    <Module title="Aandacht" widgetId="aandacht" menu={<WidgetHideButton id="aandacht" />}>
      body
    </Module>
  ) : null;
}
function Agenda() {
  return useWidgetEnabled("betaalagenda") ? (
    <Module
      title="Betaalagenda"
      widgetId="betaalagenda"
      menu={<WidgetHideButton id="betaalagenda" />}
    >
      body
    </Module>
  ) : null;
}

function mount(onOpenPicker: () => void = () => {}, strict = false) {
  container = document.createElement("div");
  container.id = "main";
  container.tabIndex = -1;
  document.body.appendChild(container);
  root = createRoot(container);
  const tree = (
    <>
      <Aandacht />
      <Agenda />
      <HomeAddArea onOpenPicker={onOpenPicker} />
    </>
  );
  act(() => root!.render(strict ? <StrictMode>{tree}</StrictMode> : tree));
}

const boxes = () => Array.from(container!.querySelectorAll<HTMLButtonElement>("[data-add-box]"));
const stored = () => JSON.parse(localStorage.getItem(KEY) ?? "null") as { on: string[] } | null;

test("shows four boxes: the first four off, non-archived widgets, in registry order", () => {
  mount();
  const names = boxes().map((b) => b.querySelector("[data-box-label]")?.textContent);
  expect(names).toEqual(["Aandacht", "Recente transacties", "Betaalagenda", "Top uitgaven"]);
  for (const b of boxes()) {
    expect(b.type).toBe("button");
    const w = WIDGETS.find((x) => x.label === b.querySelector("[data-box-label]")?.textContent)!;
    expect(b.textContent).toContain(c.modulePicker.widgets[w.id].what);
    expect(b.querySelector("[aria-hidden='true']")?.textContent).toBe("+");
  }
  expect(boxes()[0]!.getAttribute("aria-label") ?? boxes()[0]!.textContent).toMatch(
    /^\+?\s*Aandacht/,
  );
});

test("clicking a box adds the widget, announces it and moves focus to its heading", () => {
  mount();
  act(() => boxes()[0]!.click());
  expect(stored()?.on).toEqual(["aandacht"]);
  expect(boxes().map((b) => b.querySelector("[data-box-label]")?.textContent)).toEqual([
    "Recente transacties",
    "Betaalagenda",
    "Top uitgaven",
  ]);
  expect(container!.querySelector("[role='status']")?.textContent).toBe(c.home.added("Aandacht"));
  const heading = container!.querySelector('[data-widget="aandacht"]');
  expect(heading).not.toBeNull();
  expect(document.activeElement).toBe(heading);
});

test("the last box disappears when its widget is added", () => {
  setEnabledWidgets(["aandacht", "recente-transacties", "betaalagenda"]);
  mount();
  expect(boxes()).toHaveLength(1);
  act(() => boxes()[0]!.click());
  expect(container!.querySelector("[data-add-box]")).toBeNull();
});

test("renders no add area when every widget is on, only the empty live region", () => {
  setEnabledWidgets(WIDGETS.map((w) => w.id));
  mount();
  expect(container!.querySelector("[data-add-area]")).toBeNull();
  expect(container!.querySelector("[data-add-box]")).toBeNull();
  expect(container!.querySelector("[role='status']")?.textContent).toBe("");
});

test("adding the last widget still announces it, though the add area is gone", () => {
  setEnabledWidgets(["aandacht", "recente-transacties", "betaalagenda"]);
  mount();
  expect(boxes()).toHaveLength(1);
  const label = boxes()[0]!.querySelector("[data-box-label]")!.textContent!;
  const statusBefore = container!.querySelector("[role='status']");
  expect(statusBefore).not.toBeNull();
  act(() => boxes()[0]!.click());
  expect(container!.querySelector("[role='status']")).toBe(statusBefore);
  expect(container!.querySelector("[data-add-area]")).toBeNull();
  expect(container!.querySelectorAll("[role='status']")).toHaveLength(1);
  expect(container!.querySelector("[role='status']")?.textContent).toBe(c.home.added(label));
});

test("the add grid is 4 columns, 2 at a container <= 900px and 1 at <= 520px", () => {
  mount();
  const grid = container!.querySelector<HTMLElement>(".home-add-grid")!;
  const classes = grid.className.split(" ");
  const cols = (w: number) => resolvedAtContainerWidth(classes, "grid-template-columns", w);
  expect(cols(1000)).toBe("repeat(4,minmax(0,1fr))");
  expect(cols(600)).toBe("repeat(2,minmax(0,1fr))");
  expect(cols(400)).toBe("minmax(0,1fr)");
});

test("the all-widgets link calls onOpenPicker", () => {
  const open = vi.fn();
  mount(open);
  const link = Array.from(container!.querySelectorAll("button")).find(
    (b) => b.textContent === c.home.allWidgets,
  )!;
  act(() => link.click());
  expect(open).toHaveBeenCalledTimes(1);
});

test("the hide button has a text name, turns the widget off and focuses the add-area heading", () => {
  setEnabledWidgets(["betaalagenda"]);
  mount();
  const hide = container!.querySelector<HTMLButtonElement>(
    `button[aria-label="${c.home.hide("Betaalagenda")}"]`,
  )!;
  expect(hide).not.toBeNull();
  act(() => hide.click());
  expect(stored()?.on).toEqual([]);
  const heading = container!.querySelector("[data-add-heading]");
  expect(heading?.textContent).toBe(c.home.addHeading);
  expect(heading?.getAttribute("tabindex")).toBe("-1");
  expect(document.activeElement).toBe(heading);
  expect(container!.querySelector("[role='status']")?.textContent).toBe("");
});

test("when the card renders nothing, focus falls back to the add-area heading", () => {
  mount();
  const top = boxes().find((b) => b.textContent?.includes("Top uitgaven"))!;
  act(() => top.click());
  expect(document.activeElement).toBe(container!.querySelector("[data-add-heading]"));
});

test("when the card renders nothing and the area is gone, focus falls back to #main", () => {
  setEnabledWidgets(WIDGETS.filter((w) => w.id !== "top-uitgaven").map((w) => w.id));
  mount();
  act(() => boxes()[0]!.click());
  expect(container!.querySelector("[data-add-area]")).toBeNull();
  expect(document.activeElement).toBe(container);
});

test("under StrictMode one click adds exactly one widget", () => {
  mount(() => {}, true);
  act(() => boxes()[0]!.click());
  expect(stored()?.on).toEqual(["aandacht"]);
});

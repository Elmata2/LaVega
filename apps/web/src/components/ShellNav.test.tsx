// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Shell } from "./Shell";
import { MODULES, navModules, type ModuleId } from "./moduleRegistry";
import { forgetMemorySidebar } from "../lib/sidebar";
import type { View } from "../App";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement;

function stubDesktop(desktop: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: desktop,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}
function render(node: React.ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
}

const CORE: ModuleId[] = ["overview", "optimalisatie", "accounts"];

function frame(opts: {
  ids: ModuleId[];
  view?: View;
  onNavigate?: (v: View) => void;
  onOpenProfile?: () => void;
  onOpenMenu?: () => void;
  onOpenMore?: () => void;
}) {
  return (
    <Shell
      title="Overzicht"
      nav={{
        view: opts.view ?? "overview",
        modules: navModules(opts.ids),
        onNavigate: opts.onNavigate ?? (() => {}),
        onOpenProfile: opts.onOpenProfile ?? (() => {}),
        onOpenMenu: opts.onOpenMenu,
        onOpenMore: opts.onOpenMore,
      }}
    >
      <div className="content-container">body</div>
    </Shell>
  );
}
const labels = (el: Element) =>
  [...el.querySelectorAll("a, button")].map((a) => a.textContent?.trim());

beforeEach(() => {
  forgetMemorySidebar();
  window.localStorage.clear();
  document.cookie = "lavega_locale=nl";
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  stubDesktop(true);
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
  vi.restoreAllMocks();
});

test("desktop: exactly one nav, the rail, labelled", () => {
  render(frame({ ids: CORE }));
  const navs = host.querySelectorAll("nav");
  expect(navs).toHaveLength(1);
  expect(navs[0]!.classList.contains("shell2-rail")).toBe(true);
  expect(navs[0]!.getAttribute("aria-label")).toBe("Weergaven");
  expect(host.querySelector(".shell2-bottombar")).toBeNull();
});

test("phone: exactly one nav, the bottom bar, no rail, no sidebar", () => {
  stubDesktop(false);
  render(frame({ ids: CORE }));
  const navs = host.querySelectorAll("nav");
  expect(navs).toHaveLength(1);
  expect(navs[0]!.classList.contains("shell2-bottombar")).toBe(true);
  expect(host.querySelector(".shell2-rail")).toBeNull();
  expect(host.querySelector("aside")).toBeNull();
});

test("rail: items are links with href and a visible label; active has aria-current", () => {
  render(frame({ ids: [...CORE, "plan"], view: "accounts" }));
  const items = [...host.querySelectorAll<HTMLAnchorElement>(".shell2-rail-list a")];
  expect(items.map((a) => a.textContent)).toEqual(["Overzicht", "Optimalisatie", "Rekeningen"]);
  for (const a of items) expect(a.getAttribute("href")).toMatch(/^\//);
  const current = host.querySelectorAll('[aria-current="page"]');
  expect(current).toHaveLength(1);
  expect(current[0]!.textContent).toBe("Rekeningen");
  expect(current[0]!.classList.contains("shell2-rail-item")).toBe(true);
});

test("rail: brand dot is labelled; Investing and Profiel sit in the bottom group", () => {
  render(frame({ ids: CORE, view: "profiel" }));
  expect(host.querySelector('.shell2-rail-brand[aria-label="LaVega"]')).not.toBeNull();
  const bottom = host.querySelector(".shell2-rail-bottom")!;
  expect(labels(bottom)).toEqual(["Investing", "Profiel"]);
  expect(host.querySelector('.shell2-rail-bottom [aria-current="page"]')?.textContent).toBe(
    "Profiel",
  );
});

test("rail: click navigates without a reload; modified click is left to the browser", () => {
  const onNavigate = vi.fn();
  const onOpenProfile = vi.fn();
  render(frame({ ids: CORE, onNavigate, onOpenProfile }));
  const acc = [...host.querySelectorAll<HTMLAnchorElement>(".shell2-rail-list a")][2]!;
  const ev = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
  act(() => void acc.dispatchEvent(ev));
  expect(ev.defaultPrevented).toBe(true);
  expect(onNavigate).toHaveBeenCalledWith("accounts");
  const meta = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    button: 0,
    metaKey: true,
  });
  let preventedByApp: boolean | null = null;
  const sink = (e: Event) => {
    preventedByApp = e.defaultPrevented;
    e.preventDefault(); // keep jsdom from "navigating"
  };
  document.addEventListener("click", sink);
  act(() => void acc.dispatchEvent(meta));
  document.removeEventListener("click", sink);
  expect(preventedByApp).toBe(false);
  expect(onNavigate).toHaveBeenCalledTimes(1);
  const profile = host.querySelector<HTMLAnchorElement>(".shell2-rail-bottom a:last-child")!;
  act(() => profile.click());
  expect(onOpenProfile).toHaveBeenCalledTimes(1);
});

test("bottom bar: exactly the three core items, no Meer when nothing else is on", () => {
  stubDesktop(false);
  render(frame({ ids: CORE }));
  const bar = host.querySelector("nav")!;
  expect(labels(bar)).toEqual(["Overzicht", "Optimalisatie", "Rekeningen"]);
});

test("bottom bar: Jouw plan is never an item, even when the id is passed in", () => {
  stubDesktop(false);
  render(frame({ ids: [...CORE, "plan"] }));
  expect(labels(host.querySelector("nav")!)).toEqual(["Overzicht", "Optimalisatie", "Rekeningen"]);
});

test("on the plan view the bottom bar and phone top bar mark Profiel current", () => {
  stubDesktop(false);
  render(frame({ ids: CORE, view: "plan" }));
  expect(host.querySelector(".shell2-bottombar [aria-current]")).toBeNull();
  const current = host.querySelectorAll('[aria-current="page"]');
  expect(current).toHaveLength(1);
  expect(current[0]!.classList.contains("shell2-phonebar-profile")).toBe(true);
});

test("bottom bar: Meer appears only with another module on, and calls onOpenMore", () => {
  stubDesktop(false);
  const onOpenMore = vi.fn();
  const other = MODULES.find((m) => !CORE.includes(m.id) && m.id !== "plan")!.id;
  render(frame({ ids: [...CORE, "plan", other], onOpenMore }));
  const bar = host.querySelector("nav")!;
  expect(labels(bar)).toEqual(["Overzicht", "Optimalisatie", "Rekeningen", "Meer"]);
  const more = bar.querySelector<HTMLButtonElement>("button")!;
  expect(more.textContent).toBe("Meer");
  act(() => more.click());
  expect(onOpenMore).toHaveBeenCalledTimes(1);
});

test("bottom bar: aria-current on the active item", () => {
  stubDesktop(false);
  render(frame({ ids: CORE, view: "optimalisatie" }));
  const current = host.querySelectorAll('nav [aria-current="page"]');
  expect(current).toHaveLength(1);
  expect(current[0]!.textContent).toBe("Optimalisatie");
});

test("phone top bar: menu button, brand, Profiel avatar link; menu calls onOpenMenu", () => {
  stubDesktop(false);
  const onOpenMenu = vi.fn();
  render(frame({ ids: CORE, onOpenMenu }));
  const bar = host.querySelector("main .shell2-phonebar")!;
  expect(bar).not.toBeNull();
  const menu = bar.querySelector<HTMLButtonElement>("button")!;
  expect(menu.getAttribute("aria-label")).toBe("Menu openen");
  act(() => menu.click());
  expect(onOpenMenu).toHaveBeenCalledTimes(1);
  expect(bar.textContent).toContain("LaVega");
  const profile = bar.querySelector("a")!;
  expect(profile.getAttribute("aria-label")).toBe("Profiel");
  expect(profile.getAttribute("href")).toMatch(/profiel/);
  expect(host.querySelector(".shell2")!.classList.contains("shell2-narrow")).toBe(true);
});

test("phone top bar and callbacks default to no-ops", () => {
  stubDesktop(false);
  const other = MODULES.find((m) => !CORE.includes(m.id) && m.id !== "plan")!.id;
  render(frame({ ids: [...CORE, other] }));
  expect(() => {
    act(() => host.querySelector<HTMLButtonElement>(".shell2-phonebar button")!.click());
    act(() => host.querySelector<HTMLButtonElement>("nav button")!.click());
  }).not.toThrow();
});

test("skip link is the first focusable element and moves focus to #main", () => {
  render(frame({ ids: CORE }));
  const first = host.querySelector<HTMLElement>("a, button, input, [tabindex]")!;
  expect(first.classList.contains("shell2-skip")).toBe(true);
  expect(first.textContent).toBe("Naar inhoud");
  expect(first.getAttribute("href")).toBe("#main");
  act(() => first.click());
  expect(document.activeElement).toBe(host.querySelector("main#main"));
});

test("skip link is first on the phone too", () => {
  stubDesktop(false);
  render(frame({ ids: CORE }));
  const first = host.querySelector<HTMLElement>("a, button")!;
  expect(first.classList.contains("shell2-skip")).toBe(true);
});

test("English labels", () => {
  document.cookie = "lavega_locale=en";
  stubDesktop(false);
  const other = MODULES.find((m) => !CORE.includes(m.id) && m.id !== "plan")!.id;
  render(frame({ ids: [...CORE, other] }));
  const bar = host.querySelector("nav")!;
  expect(labels(bar)).toEqual(["Overview", "Optimise", "Accounts", "More"]);
  expect(host.querySelector(".shell2-skip")?.textContent).toBe("Skip to content");
});

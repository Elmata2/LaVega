// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Shell } from "./Shell";
import { MODULES, navModules, type ModuleId } from "./moduleRegistry";
import { forgetMemorySidebar } from "../lib/sidebar";
import type { View } from "../App";
import { pathForView } from "../appRoutes";
import { INVESTING_URL } from "../investing";

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
const OTHERS = MODULES.filter((m) => !CORE.includes(m.id) && m.id !== "plan")
  .slice(0, 2)
  .map((m) => m.id);
const ALL: ModuleId[] = [...CORE, "plan", ...OTHERS];

function frame(opts: { onNavigate?: (v: View) => void; view?: View } = {}) {
  return (
    <Shell
      title="Overzicht"
      nav={{
        view: opts.view ?? "overview",
        modules: navModules(ALL),
        onNavigate: opts.onNavigate ?? (() => {}),
        onOpenProfile: () => {},
      }}
      sidebar={(onNavigate) => (
        <div>
          <button type="button" className="go" onClick={onNavigate}>
            rij
          </button>
          <button type="button" className="stay">
            tab
          </button>
        </div>
      )}
    >
      <div className="content-container">body</div>
    </Shell>
  );
}

const menuBtn = () => host.querySelector<HTMLButtonElement>(".shell2-phonebar-menu")!;
const moreBtn = () => host.querySelector<HTMLButtonElement>(".shell2-bar-more")!;
const dialog = () => host.querySelector<HTMLElement>('[role="dialog"]')!;
const drawerRoot = () => host.querySelector<HTMLElement>(".shell2-drawer-root")!;
const click = (el: Element) => act(() => (el as HTMLElement).click());
const key = (k: string, init: KeyboardEventInit = {}) =>
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, ...init }));
  });

beforeEach(() => {
  forgetMemorySidebar();
  window.localStorage.clear();
  document.cookie = "lavega_locale=nl";
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  stubDesktop(false);
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
  vi.restoreAllMocks();
});

test("closed: dialog is in the DOM but inert, siblings are live", () => {
  render(frame());
  expect(dialog()).not.toBeNull();
  expect(drawerRoot().hasAttribute("inert")).toBe(true);
  expect(host.querySelector("main")!.hasAttribute("inert")).toBe(false);
  expect(menuBtn().getAttribute("aria-haspopup")).toBe("dialog");
  expect(menuBtn().getAttribute("aria-expanded")).toBe("false");
  expect(moreBtn().getAttribute("aria-haspopup")).toBe("dialog");
  expect(moreBtn().getAttribute("aria-expanded")).toBe("false");
});

test("desktop: no drawer at all", () => {
  stubDesktop(true);
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  render(frame());
  expect(host.querySelector(".shell2-drawer-root")).toBeNull();
});

test("menu opens a labelled modal dialog and moves focus to the close control", () => {
  render(frame());
  click(menuBtn());
  const d = dialog();
  expect(d.getAttribute("aria-modal")).toBe("true");
  const label = document.getElementById(d.getAttribute("aria-labelledby")!)!;
  expect(label.textContent).toBe("Menu");
  expect(drawerRoot().hasAttribute("inert")).toBe(false);
  expect(d.contains(document.activeElement)).toBe(true);
  expect(document.activeElement!.classList.contains("shell2-drawer-close")).toBe(true);
  expect(menuBtn().getAttribute("aria-expanded")).toBe("true");
});

test("menu lists all enabled modules, then the sidebar body", () => {
  render(frame());
  click(menuBtn());
  const items = [...dialog().querySelectorAll(".shell2-drawer-modules a")].map((a) =>
    a.textContent?.trim(),
  );
  expect(items).toHaveLength(ALL.length - 1);
  expect(items).not.toContain("Jouw plan");
  expect(items.slice(0, 3)).toEqual(["Overzicht", "Optimalisatie", "Rekeningen"]);
  expect(dialog().querySelector(".go")).not.toBeNull();
});

test("Meer lists exactly the enabled modules not in the bar, focus on the first", () => {
  render(frame());
  click(moreBtn());
  const links = [...dialog().querySelectorAll<HTMLAnchorElement>(".shell2-drawer-modules a")];
  const expected = navModules(OTHERS).map((m) => m.id);
  expect(links).toHaveLength(OTHERS.length);
  expect(links.map((a) => a.getAttribute("href"))).toEqual(expected.map((id) => pathForView(id)));
  expect(document.activeElement).toBe(links[0]);
  const label = document.getElementById(dialog().getAttribute("aria-labelledby")!)!;
  expect(label.textContent).toBe("Meer");
});

test("siblings of the drawer get inert while open", () => {
  render(frame());
  click(menuBtn());
  const shell = host.querySelector(".shell2")!;
  const others = [...shell.children].filter((el) => el !== drawerRoot());
  expect(others.length).toBeGreaterThan(2);
  for (const el of others) expect(el.hasAttribute("inert")).toBe(true);
});

test("Escape closes and focus returns to the menu button", () => {
  render(frame());
  click(menuBtn());
  key("Escape");
  expect(drawerRoot().hasAttribute("inert")).toBe(true);
  expect(host.querySelector("main")!.hasAttribute("inert")).toBe(false);
  expect(document.activeElement).toBe(menuBtn());
});

test("focus returns to Meer when it opened the drawer", () => {
  render(frame());
  click(moreBtn());
  key("Escape");
  expect(document.activeElement).toBe(moreBtn());
});

test("scrim click closes", () => {
  render(frame());
  click(menuBtn());
  click(host.querySelector(".shell2-scrim")!);
  expect(drawerRoot().hasAttribute("inert")).toBe(true);
  expect(document.activeElement).toBe(menuBtn());
});

test("close control closes", () => {
  render(frame());
  click(menuBtn());
  click(host.querySelector(".shell2-drawer-close")!);
  expect(drawerRoot().hasAttribute("inert")).toBe(true);
});

test("choosing a module navigates and closes", () => {
  const onNavigate = vi.fn();
  render(frame({ onNavigate }));
  click(menuBtn());
  click(dialog().querySelectorAll(".shell2-drawer-modules a")[1]!);
  expect(onNavigate).toHaveBeenCalledWith("optimalisatie");
  expect(drawerRoot().hasAttribute("inert")).toBe(true);
});

test("the sidebar's onNavigate seam closes; other controls do not", () => {
  render(frame());
  click(menuBtn());
  click(dialog().querySelector(".stay")!);
  expect(drawerRoot().hasAttribute("inert")).toBe(false);
  click(dialog().querySelector(".go")!);
  expect(drawerRoot().hasAttribute("inert")).toBe(true);
});

test("view change from outside closes for real: going back does not reopen", () => {
  render(frame());
  click(menuBtn());
  act(() => root!.render(frame({ view: "optimalisatie" })));
  expect(drawerRoot().hasAttribute("inert")).toBe(true);
  act(() => root!.render(frame({ view: "overview" })));
  expect(drawerRoot().hasAttribute("inert")).toBe(true);
  expect(host.querySelector("main")!.hasAttribute("inert")).toBe(false);
});

test("modifier-click on a module link does not close", () => {
  render(frame());
  click(menuBtn());
  const link = dialog().querySelectorAll<HTMLAnchorElement>(".shell2-drawer-modules a")[1]!;
  const swallow = (e: Event) => e.preventDefault();
  document.addEventListener("click", swallow);
  act(() => {
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }));
  });
  document.removeEventListener("click", swallow);
  expect(drawerRoot().hasAttribute("inert")).toBe(false);
});

test("menu mode has an Investing row below the modules; Meer mode does not", () => {
  render(frame());
  click(menuBtn());
  const row = dialog().querySelector<HTMLAnchorElement>("a.shell2-drawer-investing")!;
  expect(row.textContent).toBe("Investing");
  expect(row.getAttribute("href")).toBe(INVESTING_URL);
  if (INVESTING_URL!.startsWith("http"))
    expect(row.getAttribute("rel")).toBe("noopener noreferrer");
  const list = dialog().querySelector(".shell2-drawer-modules")!;
  expect(list.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(list.contains(row)).toBe(false);
  key("Escape");
  click(moreBtn());
  expect(dialog().querySelector(".shell2-drawer-investing")).toBeNull();
});

test("crossing to desktop while open does not move focus", () => {
  let fire: (() => void) | null = null;
  let desktop = false;
  window.matchMedia = ((q: string) => ({
    get matches() {
      return desktop;
    },
    media: q,
    addEventListener: (_: string, fn: () => void) => {
      fire = fn;
    },
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  render(frame());
  click(menuBtn());
  const focus = vi.spyOn(HTMLElement.prototype, "focus");
  desktop = true;
  act(() => fire!());
  expect(host.querySelector(".shell2-drawer-root")).toBeNull();
  expect(focus).not.toHaveBeenCalled();
});

test("Tab wraps inside the drawer (both ends)", () => {
  render(frame());
  click(menuBtn());
  const tabbables = [...dialog().querySelectorAll<HTMLElement>("a[href], button:not([disabled])")];
  const first = tabbables[0]!;
  const last = tabbables[tabbables.length - 1]!;
  last.focus();
  key("Tab");
  expect(document.activeElement).toBe(first);
  first.focus();
  key("Tab", { shiftKey: true });
  expect(document.activeElement).toBe(last);
});

test("English copy", () => {
  document.cookie = "lavega_locale=en";
  render(frame());
  click(menuBtn());
  const label = document.getElementById(dialog().getAttribute("aria-labelledby")!)!;
  expect(label.textContent).toBe("Menu");
  expect(host.querySelector(".shell2-drawer-close")!.getAttribute("aria-label")).toBe("Close menu");
});

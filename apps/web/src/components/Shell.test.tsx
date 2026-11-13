// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Shell, ShellSwitch } from "./Shell";
import { forgetMemorySidebar } from "../lib/sidebar";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement;

function setViewport(w: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
}
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

const frame = (
  <Shell title="Overzicht" actions={<button>act</button>} sidebar={<p>slot</p>}>
    <div className="content-container">body</div>
  </Shell>
);

beforeEach(() => {
  forgetMemorySidebar();
  window.localStorage.clear();
  document.cookie = "lavega_locale=nl";
  setViewport(1440);
  stubDesktop(true);
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
  vi.restoreAllMocks();
});

test("landmarks: aside, main#main with a header, the title as h1", () => {
  render(frame);
  const main = host.querySelector("main#main")!;
  expect(main).not.toBeNull();
  expect(main.querySelector("header h1")?.textContent).toBe("Overzicht");
  expect(host.querySelector("aside")?.getAttribute("aria-label")).toBe("Rekeningen");
  expect(host.querySelectorAll("main")).toHaveLength(1);
  expect(host.querySelector("nav")).toBeNull();
});

test("slots: actions in the top bar, sidebar content in the aside, children in main", () => {
  render(frame);
  expect(host.querySelector("main header")?.textContent).toContain("act");
  expect(host.querySelector("aside")?.textContent).toBe("slot");
  expect(host.querySelector("main .content-container")?.textContent).toBe("body");
});

test("the container wrapper is not a scroll element or an ancestor of the top bar", () => {
  render(frame);
  const wrapper = host.querySelector(".content-container")!;
  expect(wrapper.contains(host.querySelector("header"))).toBe(false);
  expect(wrapper.closest("main")).not.toBeNull();
});

test("toggle: aria-expanded and aria-controls point at the sidebar", () => {
  render(frame);
  const btn = host.querySelector<HTMLButtonElement>("main header button[aria-controls]")!;
  const aside = host.querySelector("aside")!;
  expect(btn.getAttribute("aria-controls")).toBe(aside.id);
  expect(btn.getAttribute("aria-expanded")).toBe("true");
  expect(btn.getAttribute("aria-label")).toBe("Zijbalk sluiten");
  expect(aside.hasAttribute("inert")).toBe(false);
});

test("collapsing sets inert on the sidebar and flips the toggle", () => {
  render(frame);
  const btn = host.querySelector<HTMLButtonElement>("main header button[aria-controls]")!;
  act(() => btn.click());
  const aside = host.querySelector("aside")!;
  expect(btn.getAttribute("aria-expanded")).toBe("false");
  expect(btn.getAttribute("aria-label")).toBe("Zijbalk openen");
  expect(aside.hasAttribute("inert")).toBe(true);
  act(() => btn.click());
  expect(aside.hasAttribute("inert")).toBe(false);
});

test("a stored collapsed state renders collapsed", () => {
  window.localStorage.setItem("lavega.sidebar", '{"open":false,"width":300}');
  render(frame);
  expect(host.querySelector("aside")!.hasAttribute("inert")).toBe(true);
});

test("sidebar width reaches the layout as a custom property", () => {
  window.localStorage.setItem("lavega.sidebar", '{"open":true,"width":360}');
  render(frame);
  const shell = host.querySelector<HTMLElement>(".shell2")!;
  expect(shell.style.getPropertyValue("--shell2-sidebar-w")).toBe("360px");
});

test("below 1024: main only, no rail, no sidebar, no toggle", () => {
  stubDesktop(false);
  render(frame);
  expect(host.querySelector("main#main")).not.toBeNull();
  expect(host.querySelector("aside")).toBeNull();
  expect(host.querySelector(".shell2-rail")).toBeNull();
  expect(host.querySelector("button[aria-controls]")).toBeNull();
});

test("English copy", () => {
  document.cookie = "lavega_locale=en";
  render(frame);
  expect(host.querySelector("aside")?.getAttribute("aria-label")).toBe("Accounts");
  expect(host.querySelector("button[aria-controls]")?.getAttribute("aria-label")).toBe(
    "Hide sidebar",
  );
});

test("ShellSwitch off renders the old shell and not the new one", () => {
  render(
    <ShellSwitch
      v2={false}
      title="Overzicht"
      actions={null}
      legacyNav={<nav>old-nav</nav>}
      legacyTop={<div className="topbar">old-top</div>}
    >
      <div className="content-container">body</div>
    </ShellSwitch>,
  );
  expect(host.querySelector(".shell > nav")?.textContent).toBe("old-nav");
  expect(host.querySelector(".shell .shell-body > .topbar")).not.toBeNull();
  expect(host.querySelector(".shell-body > main.content > .content-container")).not.toBeNull();
  expect(host.querySelector(".shell2")).toBeNull();
});

test("ShellSwitch on renders the new shell and not the old chrome", () => {
  render(
    <ShellSwitch
      v2
      title="Overzicht"
      actions={null}
      legacyNav={<nav>old-nav</nav>}
      legacyTop={<div className="topbar">old-top</div>}
    >
      <div className="content-container">body</div>
    </ShellSwitch>,
  );
  expect(host.querySelector(".shell2 main#main .content-container")).not.toBeNull();
  expect(host.textContent).not.toContain("old-nav");
  expect(host.querySelector(".shell")).toBeNull();
});

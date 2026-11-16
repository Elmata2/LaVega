// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { Shell } from "./Shell";
import { navModules } from "./moduleRegistry";
import { forgetMemorySidebar } from "../lib/sidebar";
import { forgetMemoryAssistant } from "../lib/assistantPanel";

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
  forgetMemoryAssistant();
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

const handle = () => host.querySelector<HTMLElement>('aside [role="separator"]')!;
const shellRoot = () => host.querySelector<HTMLElement>(".shell2")!;

test("resize handle sits in the sidebar and shares state with the toggle", () => {
  render(frame);
  expect(handle().getAttribute("aria-valuenow")).toBe("296");
  act(() => {
    handle().dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  });
  expect(shellRoot().style.getPropertyValue("--shell2-sidebar-w")).toBe("312px");
  expect(handle().getAttribute("aria-valuenow")).toBe("312");
  expect(JSON.parse(window.localStorage.getItem("lavega.sidebar")!)).toEqual({
    open: true,
    width: 312,
  });
  const btn = host.querySelector<HTMLButtonElement>("main header button[aria-controls]")!;
  act(() => btn.click());
  expect(host.querySelector("aside")!.hasAttribute("inert")).toBe(true);
  expect(JSON.parse(window.localStorage.getItem("lavega.sidebar")!)).toEqual({
    open: false,
    width: 312,
  });
});

test("dragging moves the width live, no class change leaks, storage only on pointer-up", () => {
  render(frame);
  const ptr = (target: EventTarget, type: string, clientX: number) =>
    act(() => {
      target.dispatchEvent(new MouseEvent(type, { clientX, bubbles: true, button: 0 }));
    });
  ptr(handle(), "pointerdown", 300);
  expect(shellRoot().classList.contains("shell2-dragging")).toBe(true);
  ptr(window, "pointermove", 340);
  expect(shellRoot().style.getPropertyValue("--shell2-sidebar-w")).toBe("336px");
  expect(window.localStorage.getItem("lavega.sidebar")).toBeNull();
  ptr(window, "pointerup", 340);
  expect(shellRoot().classList.contains("shell2-dragging")).toBe(false);
  expect(JSON.parse(window.localStorage.getItem("lavega.sidebar")!).width).toBe(336);
  expect(shellRoot().style.getPropertyValue("--shell2-sidebar-w")).toBe("336px");
});

test("double-click on the handle resets to 296", () => {
  window.localStorage.setItem("lavega.sidebar", '{"open":true,"width":400}');
  render(frame);
  expect(handle().getAttribute("aria-valuenow")).toBe("400");
  act(() => {
    handle().dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  });
  expect(handle().getAttribute("aria-valuenow")).toBe("296");
});

/* The assistant column (Task 3). */
function Probe({ onClose, active }: { onClose?: () => void; active?: boolean }) {
  return (
    <div data-testid="probe" data-active={String(active)}>
      <input id="assistant-input" />
      <button type="button" id="probe-close" onClick={onClose}>
        x
      </button>
    </div>
  );
}
const withAssistant = (
  <Shell title="Overzicht" sidebar={<p>slot</p>} assistant={<Probe />}>
    <div>body</div>
  </Shell>
);
const assistantAside = () => host.querySelector<HTMLElement>("aside#shell2-assistant")!;
const assistantToggle = () =>
  host.querySelector<HTMLButtonElement>('main header button[aria-controls="shell2-assistant"]')!;
const sidebarToggle = () =>
  host.querySelector<HTMLButtonElement>('main header button[aria-controls="shell2-sidebar"]')!;

test("assistant: aside after main, labelled, toggle controls it and flips aria-expanded", () => {
  window.localStorage.setItem("lavega.assistantPanel", '{"open":false,"width":380}');
  render(withAssistant);
  const aside = assistantAside();
  expect(aside.getAttribute("aria-label")).toBe("Assistent");
  expect(host.querySelector("main")!.compareDocumentPosition(aside)).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
  expect(assistantToggle().getAttribute("aria-expanded")).toBe("false");
  expect(aside.hasAttribute("inert")).toBe(true);
  act(() => assistantToggle().click());
  expect(assistantToggle().getAttribute("aria-expanded")).toBe("true");
  expect(aside.hasAttribute("inert")).toBe(false);
  expect(JSON.parse(window.localStorage.getItem("lavega.assistantPanel")!).open).toBe(true);
});

test("assistant: the toggle sits after the actions at the right end of the top bar", () => {
  render(
    <Shell title="T" actions={<button id="act">a</button>} assistant={<Probe />}>
      x
    </Shell>,
  );
  const bar = host.querySelector("main header")!;
  const act_ = bar.querySelector("#act")!;
  expect(act_.compareDocumentPosition(assistantToggle())).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
});

test("assistant: no prop, no toggle and no aside", () => {
  render(frame);
  expect(host.querySelector("#shell2-assistant")).toBeNull();
  expect(host.querySelector('button[aria-controls="shell2-assistant"]')).toBeNull();
});

test("assistant: below 1024 neither the aside nor the toggle renders", () => {
  stubDesktop(false);
  render(withAssistant);
  expect(host.querySelector("#shell2-assistant")).toBeNull();
  expect(host.querySelector('button[aria-controls="shell2-assistant"]')).toBeNull();
});

test("assistant: opening by the toggle focuses the input, closing returns focus to the toggle", () => {
  window.localStorage.setItem("lavega.assistantPanel", '{"open":false,"width":380}');
  render(withAssistant);
  act(() => assistantToggle().click());
  expect(document.activeElement?.id).toBe("assistant-input");
  act(() => host.querySelector<HTMLButtonElement>("#probe-close")!.click());
  expect(assistantAside().hasAttribute("inert")).toBe(true);
  expect(document.activeElement).toBe(assistantToggle());
});

test("assistant: Escape does not close the panel", () => {
  window.localStorage.setItem("lavega.assistantPanel", '{"open":true,"width":380}');
  render(withAssistant);
  act(() => {
    host
      .querySelector("#assistant-input")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(assistantAside().hasAttribute("inert")).toBe(false);
});

test("assistant: active reaches the panel and follows the open state", () => {
  window.localStorage.setItem("lavega.assistantPanel", '{"open":false,"width":380}');
  render(withAssistant);
  const probe = () => host.querySelector("[data-testid=probe]")!;
  expect(probe().getAttribute("data-active")).toBe("false");
  act(() => assistantToggle().click());
  expect(probe().getAttribute("data-active")).toBe("true");
});

test("assistant: at 1100 opening it hides the sidebar but keeps lavega.sidebar open", () => {
  setViewport(1100);
  window.localStorage.setItem("lavega.sidebar", '{"open":true,"width":296}');
  window.localStorage.setItem("lavega.assistantPanel", '{"open":false,"width":380}');
  render(withAssistant);
  const sidebar = host.querySelector("aside#shell2-sidebar")!;
  expect(sidebar.hasAttribute("inert")).toBe(false);
  act(() => assistantToggle().click());
  expect(sidebar.hasAttribute("inert")).toBe(true);
  expect(assistantAside().hasAttribute("inert")).toBe(false);
  expect(JSON.parse(window.localStorage.getItem("lavega.sidebar")!).open).toBe(true);
  expect(sidebarToggle().getAttribute("aria-expanded")).toBe("false");
  /* Asking for the sidebar swaps them; its stored choice stays open. */
  act(() => sidebarToggle().click());
  expect(sidebar.hasAttribute("inert")).toBe(false);
  expect(assistantAside().hasAttribute("inert")).toBe(true);
  expect(JSON.parse(window.localStorage.getItem("lavega.sidebar")!).open).toBe(true);
});

test("assistant: the resize handle sits on the left edge and writes the width", () => {
  window.localStorage.setItem("lavega.assistantPanel", '{"open":true,"width":380}');
  render(withAssistant);
  const h = assistantAside().querySelector<HTMLElement>('[role="separator"]')!;
  expect(h.getAttribute("aria-valuenow")).toBe("380");
  /* Left edge: ArrowLeft widens. */
  act(() => {
    h.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
  });
  expect(h.getAttribute("aria-valuenow")).toBe("396");
  expect(JSON.parse(window.localStorage.getItem("lavega.assistantPanel")!).width).toBe(396);
  expect(shellRoot().style.getPropertyValue("--shell2-assistant-w")).toBe("396px");
});

/* The assistant sheet below 1024 (Task 4). */
function phoneFrame(onOverlayChange?: (open: boolean) => void) {
  return (
    <Shell
      title="Overzicht"
      sidebar={<p>slot</p>}
      assistant={<Probe />}
      onOverlayChange={onOverlayChange}
      nav={{
        view: "overview",
        modules: navModules(["overview", "optimalisatie", "accounts", "plan"]),
        onNavigate: () => {},
        onOpenProfile: () => {},
      }}
    >
      <div>body</div>
    </Shell>
  );
}
const barAssistant = () => host.querySelector<HTMLButtonElement>(".shell2-bar-assistant")!;
const sheetRoot = () => host.querySelector<HTMLElement>(".shell2-sheet-root")!;

test("sheet: the bar item opens it, backs the page out and reports the overlay", () => {
  stubDesktop(false);
  const onOverlayChange = vi.fn();
  render(phoneFrame(onOverlayChange));
  expect(sheetRoot().hasAttribute("inert")).toBe(true);
  expect(barAssistant().getAttribute("aria-expanded")).toBe("false");
  act(() => barAssistant().click());
  expect(sheetRoot().hasAttribute("inert")).toBe(false);
  expect(barAssistant().getAttribute("aria-expanded")).toBe("true");
  expect(host.querySelector("main")!.hasAttribute("inert")).toBe(true);
  expect(host.querySelector(".shell2-bottombar")!.hasAttribute("inert")).toBe(true);
  expect(onOverlayChange).toHaveBeenLastCalledWith(true);
  expect(document.activeElement?.id).toBe("assistant-input");
  expect(host.querySelector("[data-testid=probe]")!.getAttribute("data-active")).toBe("true");
});

test("sheet: it holds the one panel element, not the aside", () => {
  stubDesktop(false);
  render(phoneFrame());
  expect(host.querySelector("aside")).toBeNull();
  expect(sheetRoot().querySelector("[data-testid=probe]")).not.toBeNull();
  expect(host.querySelectorAll("[data-testid=probe]")).toHaveLength(1);
});

test("sheet: Escape closes it and focus returns to the bar item", () => {
  stubDesktop(false);
  const onOverlayChange = vi.fn();
  render(phoneFrame(onOverlayChange));
  act(() => barAssistant().click());
  act(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(sheetRoot().hasAttribute("inert")).toBe(true);
  expect(host.querySelector("main")!.hasAttribute("inert")).toBe(false);
  expect(onOverlayChange).toHaveBeenLastCalledWith(false);
  expect(document.activeElement).toBe(barAssistant());
});

test("sheet: the scrim closes it", () => {
  stubDesktop(false);
  render(phoneFrame());
  act(() => barAssistant().click());
  act(() => sheetRoot().querySelector<HTMLElement>(".shell2-scrim")!.click());
  expect(sheetRoot().hasAttribute("inert")).toBe(true);
});

test("sheet: the menu drawer and the sheet are never open together", () => {
  stubDesktop(false);
  render(phoneFrame());
  const drawer = () => host.querySelector(".shell2-drawer-root")!;
  act(() => host.querySelector<HTMLButtonElement>(".shell2-phonebar-menu")!.click());
  expect(drawer().hasAttribute("inert")).toBe(false);
  /* The page is inert behind the drawer, so a user cannot reach the bar item;
   * a programmatic click still must not leave both open. */
  act(() => barAssistant().click());
  expect(sheetRoot().hasAttribute("inert")).toBe(false);
  expect(drawer().hasAttribute("inert")).toBe(true);
  act(() => sheetRoot().querySelector<HTMLElement>(".shell2-scrim")!.click());
  act(() => host.querySelector<HTMLButtonElement>(".shell2-phonebar-menu")!.click());
  expect(drawer().hasAttribute("inert")).toBe(false);
  expect(sheetRoot().hasAttribute("inert")).toBe(true);
});

test("sheet: widening to 1024 closes it", () => {
  let listener: (() => void) | undefined;
  let desktop = false;
  window.matchMedia = ((q: string) => ({
    get matches() {
      return desktop;
    },
    media: q,
    addEventListener: (_: string, l: () => void) => {
      listener = l;
    },
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
  render(phoneFrame());
  act(() => barAssistant().click());
  expect(sheetRoot().hasAttribute("inert")).toBe(false);
  desktop = true;
  act(() => listener?.());
  expect(host.querySelector(".shell2-sheet-root")).toBeNull();
  desktop = false;
  act(() => listener?.());
  expect(sheetRoot().hasAttribute("inert")).toBe(true);
});

test("sheet: no assistant prop, no bar item and no sheet", () => {
  stubDesktop(false);
  render(
    <Shell
      title="x"
      nav={{
        view: "overview",
        modules: navModules(["overview", "accounts"]),
        onNavigate: () => {},
        onOpenProfile: () => {},
      }}
    >
      b
    </Shell>,
  );
  expect(host.querySelector(".shell2-bar-assistant")).toBeNull();
  expect(host.querySelector(".shell2-sheet-root")).toBeNull();
});

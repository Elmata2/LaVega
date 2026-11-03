// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import Landing from "./Landing";
import { useAuthState } from "../authClient.js";
import { landingCopy } from "../landingCopy.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../authClient.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../authClient.js")>();
  return { ...actual, useAuthState: vi.fn() };
});

/** An observer that reports every target as on screen the moment it is observed. */
class OnScreen {
  constructor(private cb: IntersectionObserverCallback) {}
  observe(target: Element) {
    this.cb([{ isIntersecting: true, target } as IntersectionObserverEntry], this as never);
  }
  unobserve() {}
  disconnect() {}
}

let container: HTMLElement | null = null;
let root: Root | null = null;

function motion(reduce: boolean) {
  vi.stubGlobal("IntersectionObserver", OnScreen);
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: reduce, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(useAuthState).mockReturnValue({ state: { kind: "signed-out" }, refresh: vi.fn() });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Landing onEnter={() => {}} locale="en" />));
  return container;
}

const moves = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>(".move")];

test("the plan ticks itself, and a manual click stops the autoplay", async () => {
  motion(false);
  const el = render();
  expect(moves(el).map((m) => m.getAttribute("aria-pressed"))).toEqual(["false", "false", "false"]);
  await act(async () => void (await vi.advanceTimersByTimeAsync(1600)));
  expect(moves(el).map((m) => m.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);
  expect(el.querySelector(".plan .total b")?.textContent).toBe("€47 a month");
  act(() => moves(el)[2]!.click());
  expect(el.querySelector(".plan .total b")?.textContent).toBe("€59 a month");
  await act(async () => void (await vi.advanceTimersByTimeAsync(10_000)));
  expect(moves(el).map((m) => m.getAttribute("aria-pressed"))).toEqual(["true", "false", "true"]);
});

test("the account deck rotates on click", () => {
  motion(true);
  const el = render();
  const front = () => el.querySelector(".acct[data-p='0'] em")?.textContent;
  expect(front()).toBe("Current account");
  act(() => el.querySelector<HTMLButtonElement>(".stack")!.click());
  expect(front()).toBe("Savings");
});

test("the typed conversation runs, then every timer is gone after unmount", async () => {
  motion(false);
  const el = render();
  const copy = landingCopy("en").acts.talks[0];
  await act(async () => void (await vi.advanceTimersByTimeAsync(32 * copy.q.length + 600)));
  expect(el.querySelector(".ask [aria-hidden='true']")?.textContent).toContain(copy.q);
  expect(el.querySelector(".ask .sr")?.textContent).toContain(copy.a);
  act(() => root!.unmount());
  root = null;
  expect(vi.getTimerCount()).toBe(0);
});

test("reduced motion: static first conversation, plan ticked, no timers", () => {
  motion(true);
  const el = render();
  const copy = landingCopy("en").acts.talks[0];
  expect(el.querySelector(".ghost")).toBeNull();
  expect(el.querySelector(".bubble")?.textContent).toBe(copy.a);
  expect(el.querySelectorAll(".row[data-sk]").length).toBe(0);
  expect(moves(el).every((m) => m.getAttribute("aria-pressed") === "true")).toBe(true);
  expect(el.querySelector(".plan .total b")?.textContent).toBe("€77 a month");
  /* jsdom queues a zero-delay timer for the <details open> toggle event; run it. */
  act(() => void vi.advanceTimersByTime(0));
  expect(vi.getTimerCount()).toBe(0);
});

test("the burger opens the menu, Escape closes it, and body scroll comes back", () => {
  motion(true);
  const el = render();
  const burger = el.querySelector<HTMLButtonElement>(".burger")!;
  const panel = el.querySelector("#panel")!;
  act(() => burger.click());
  expect(burger.getAttribute("aria-expanded")).toBe("true");
  expect(panel.classList.contains("open")).toBe(true);
  expect(document.body.style.overflow).toBe("hidden");
  expect(panel.contains(document.activeElement)).toBe(true);
  expect(el.querySelector("main")?.hasAttribute("inert")).toBe(true);
  expect(el.querySelector("nav")?.hasAttribute("inert")).toBe(false);
  act(() => void window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
  expect(document.activeElement).toBe(burger);
  expect(el.querySelector("main")?.hasAttribute("inert")).toBe(false);
  expect(burger.getAttribute("aria-expanded")).toBe("false");
  expect(panel.classList.contains("open")).toBe(false);
  expect(document.body.style.overflow).toBe("visible");
  expect(panel.querySelector("a[href='#does']")).not.toBeNull();
  expect(panel.querySelector("a[href='#faq']")).not.toBeNull();
  expect(panel.querySelector("a.lp-lang-menu")).not.toBeNull();
});

test("the open menu closes when the viewport grows past the mobile breakpoint", () => {
  motion(true);
  let onChange: (e: { matches: boolean }) => void = () => {};
  vi.stubGlobal(
    "matchMedia",
    vi.fn((q: string) => ({
      matches: q.includes("reduce"),
      addEventListener: (_: string, cb: typeof onChange) => (onChange = cb),
      removeEventListener: vi.fn(),
    })),
  );
  const el = render();
  const burger = el.querySelector<HTMLButtonElement>(".burger")!;
  act(() => burger.click());
  expect(burger.getAttribute("aria-expanded")).toBe("true");
  act(() => onChange({ matches: true }));
  expect(burger.getAttribute("aria-expanded")).toBe("false");
});

test("the dialog is labelled by its heading", () => {
  motion(true);
  const el = render();
  const dlg = el.querySelector("dialog")!;
  expect(el.querySelector(`#${dlg.getAttribute("aria-labelledby")}`)?.tagName).toBe("H2");
});

test("the first FAQ item is open, the rest are closed", () => {
  motion(true);
  const el = render();
  expect([...el.querySelectorAll<HTMLDetailsElement>(".faq details")].map((d) => d.open)).toEqual([
    true,
    false,
    false,
    false,
    false,
    false,
  ]);
});

test("the conversation stays revealed while it types, thinks and fills its rows", async () => {
  motion(false);
  const el = render();
  const t = landingCopy("en").acts.talks[0];
  const revealed = () =>
    [...el.querySelectorAll("#acts .r")].every((n) => n.classList.contains("in-view"));
  expect(revealed()).toBe(true);
  await act(
    async () =>
      void (await vi.advanceTimersByTimeAsync(
        32 * t.q.length + 500 + 20 * t.a.length + 200 + 3 * 160 + 100,
      )),
  );
  expect(el.querySelector("#acts .bubble")?.hasAttribute("data-think")).toBe(false);
  expect(el.querySelectorAll("#acts .row[data-sk]").length).toBe(0);
  expect(revealed()).toBe(true);
});

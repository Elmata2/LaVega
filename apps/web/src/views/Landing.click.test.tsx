// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import Landing from "./Landing";
import { rememberLocale } from "../locale.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* CardSpiral drives GSAP against a real scroller; it has nothing to say about
 * the switcher, so it is stubbed out rather than rendered. */
vi.mock("./CardSpiral", () => ({ default: () => null }));

vi.mock("../locale.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../locale.js")>();
  return { ...actual, rememberLocale: vi.fn() };
});

let container: HTMLElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  vi.mocked(rememberLocale).mockClear();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function render(locale: "nl" | "en") {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Landing onEnter={() => {}} locale={locale} />));
  return container;
}

test("the switcher remembers the alternate locale on click, and lets navigation proceed", () => {
  const el = render("nl");
  const link = el.querySelector<HTMLAnchorElement>(".lp-lang")!;
  act(() => {
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  expect(rememberLocale).toHaveBeenCalledTimes(1);
  expect(rememberLocale).toHaveBeenCalledWith("en");
});

test("the same switcher remembers the other direction, starting from English", () => {
  const el = render("en");
  const link = el.querySelector<HTMLAnchorElement>(".lp-lang")!;
  act(() => {
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  expect(rememberLocale).toHaveBeenCalledTimes(1);
  expect(rememberLocale).toHaveBeenCalledWith("nl");
});

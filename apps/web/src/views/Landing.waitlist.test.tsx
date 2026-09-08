// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import Landing from "./Landing";
import { landingCopy } from "../landingCopy.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./CardSpiral", () => ({ default: () => null }));

let container: HTMLElement | null = null;
let root: Root | null = null;
let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Landing onEnter={() => {}} locale="en" />));
  return container;
}

/* React tracks input value through its own setter, so writing `el.value`
 * directly leaves it unaware of the change — the native setter is required
 * for the dispatched "input" event to reach the component's onChange. */
function setValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function fillEmail(el: HTMLElement, value: string) {
  setValue(el.querySelector<HTMLInputElement>('input[type="email"]')!, value);
}

function submit(el: HTMLElement) {
  const form = el.querySelector<HTMLFormElement>(".lp-waitlist-form")!;
  act(() => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}

test("a filled honeypot pretends success without posting", () => {
  const el = render();
  setValue(el.querySelector<HTMLInputElement>('input[name="company"]')!, "Acme Inc");
  fillEmail(el, "person@example.com");
  submit(el);
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(el.textContent).toContain(landingCopy("en").waitlist.done);
});

test("a submit within the 2s fill window is held until the window closes, then posted", async () => {
  vi.useFakeTimers();
  try {
    const el = render();
    fillEmail(el, "person@example.com");
    submit(el);
    expect(fetchSpy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchSpy).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});

test("the honeypot field carries no visible label text", () => {
  const el = render();
  const honeypot = el.querySelector<HTMLInputElement>('input[name="company"]')!;
  expect(honeypot.getAttribute("aria-hidden")).toBe("true");
  expect(honeypot.placeholder).toBe("");
  expect(honeypot.getAttribute("aria-label")).toBeNull();
});

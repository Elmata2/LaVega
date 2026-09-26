// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import Landing from "./Landing";
import { signIn, useAuthState } from "../authClient.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* CardSpiral drives GSAP against a real scroller; it has nothing to say about
 * sign-in, so it is stubbed out rather than rendered (same as Landing.click.test.tsx). */
vi.mock("./CardSpiral", () => ({ default: () => null }));

vi.mock("../authClient.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../authClient.js")>();
  return { ...actual, useAuthState: vi.fn(), signIn: vi.fn() };
});

let container: HTMLElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  vi.mocked(signIn).mockReset();
  vi.mocked(useAuthState).mockReset();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function render(onEnter: () => void = () => {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Landing onEnter={onEnter} locale="nl" />));
  return container;
}

function loginButton(el: HTMLElement): HTMLButtonElement {
  return [...el.querySelectorAll("button")].find(
    (b) => b.textContent === "Inloggen",
  ) as HTMLButtonElement;
}

function click(el: HTMLElement) {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function setNativeValue(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function submit(form: HTMLFormElement) {
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

test("clicking Inloggen signed-out reveals the sign-in form", () => {
  vi.mocked(useAuthState).mockReturnValue({ state: { kind: "signed-out" }, refresh: vi.fn() });
  const el = render();
  act(() => click(loginButton(el)));
  expect(el.querySelector("#account-email")).not.toBeNull();
});

test("submitting valid credentials navigates to the app", async () => {
  vi.mocked(useAuthState).mockReturnValue({ state: { kind: "signed-out" }, refresh: vi.fn() });
  vi.mocked(signIn).mockResolvedValue({ ok: true, state: { kind: "signed-in", email: "x@y.nl" } });
  const assign = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, assign },
  });
  const onEnter = vi.fn();
  const el = render(onEnter);
  act(() => click(loginButton(el)));
  act(() => setNativeValue(el.querySelector("#account-email") as HTMLInputElement, "x@y.nl"));
  act(() =>
    setNativeValue(el.querySelector("#account-password") as HTMLInputElement, "secret"),
  );
  await act(async () => submit(el.querySelector("form") as HTMLFormElement));
  expect(assign).toHaveBeenCalledWith("/app");
});

test("clicking Inloggen while already signed in calls onEnter immediately without showing the form", () => {
  vi.mocked(useAuthState).mockReturnValue({
    state: { kind: "signed-in", email: "x@y.nl" },
    refresh: vi.fn(),
  });
  const onEnter = vi.fn();
  const el = render(onEnter);
  act(() => click(loginButton(el)));
  expect(onEnter).toHaveBeenCalledTimes(1);
  expect((el.querySelector("dialog") as HTMLDialogElement).open).toBe(false);
});

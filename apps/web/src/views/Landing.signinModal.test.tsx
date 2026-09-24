// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import Landing from "./Landing";
import { signIn, useAuthState } from "../authClient.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* CardSpiral drives GSAP against a real scroller; it has nothing to say about
 * sign-in, so it is stubbed out rather than rendered (same as Landing.signin.test.tsx). */
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

function dialog(el: HTMLElement): HTMLDialogElement {
  return el.querySelector("dialog") as HTMLDialogElement;
}

function click(el: HTMLElement | null) {
  el?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function setNativeValue(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function submit(form: HTMLFormElement) {
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

test("the dialog is closed before the trigger is clicked, and open after", () => {
  vi.mocked(useAuthState).mockReturnValue({ state: { kind: "signed-out" }, refresh: vi.fn() });
  const el = render();
  expect(dialog(el).open).toBe(false);
  act(() => click(loginButton(el)));
  expect(dialog(el).open).toBe(true);
});

test("clicking the trigger moves focus into #account-email", () => {
  vi.mocked(useAuthState).mockReturnValue({ state: { kind: "signed-out" }, refresh: vi.fn() });
  const el = render();
  act(() => click(loginButton(el)));
  expect(document.activeElement).toBe(el.querySelector("#account-email"));
});

test("the close button closes the dialog and returns focus to the trigger", () => {
  vi.mocked(useAuthState).mockReturnValue({ state: { kind: "signed-out" }, refresh: vi.fn() });
  const el = render();
  const trigger = loginButton(el);
  act(() => click(trigger));
  const closeButton = el.querySelector('[aria-label="Sluiten"]') as HTMLButtonElement;
  expect(closeButton).not.toBeNull();
  act(() => click(closeButton));
  expect(dialog(el).open).toBe(false);
  expect(document.activeElement).toBe(trigger);
});

test("a click on the dialog's own box (backdrop) closes it and returns focus to the trigger", () => {
  vi.mocked(useAuthState).mockReturnValue({ state: { kind: "signed-out" }, refresh: vi.fn() });
  const el = render();
  const trigger = loginButton(el);
  act(() => click(trigger));
  const dlg = dialog(el);
  act(() => dlg.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
  expect(dlg.open).toBe(false);
  expect(document.activeElement).toBe(trigger);
});

/* Escape doesn't dispatch through jsdom's key-event plumbing into the
 * dialog's default close behavior the way a real browser does, so this
 * dispatches the `cancel` event directly — the same event a real Escape
 * press fires on the dialog (confirmed against the built app: pressing
 * Escape on an open dialog fired exactly one `cancel` event and zero `close`
 * events). That is the event Landing.tsx's onCancel handler listens for. */
test("Escape (a native cancel event) closes the dialog and returns focus to the trigger", () => {
  vi.mocked(useAuthState).mockReturnValue({ state: { kind: "signed-out" }, refresh: vi.fn() });
  const el = render();
  const trigger = loginButton(el);
  act(() => click(trigger));
  const dlg = dialog(el);
  expect(dlg.open).toBe(true);
  act(() => dlg.dispatchEvent(new Event("cancel", { cancelable: true, bubbles: false })));
  expect(dlg.open).toBe(false);
  expect(document.activeElement).toBe(trigger);
});

/* Defect regression: showSignIn used to be toggled by the trigger's onClick
 * and never reset when the dialog closed, so the click that opened it again
 * after a close actually flipped it true -> false and nothing opened. The
 * user had to click twice. */
test("closing the dialog, then a single trigger click, reopens it", () => {
  vi.mocked(useAuthState).mockReturnValue({ state: { kind: "signed-out" }, refresh: vi.fn() });
  const el = render();
  const trigger = loginButton(el);
  act(() => click(trigger));
  const closeButton = el.querySelector('[aria-label="Sluiten"]') as HTMLButtonElement;
  act(() => click(closeButton));
  expect(dialog(el).open).toBe(false);
  act(() => click(trigger));
  expect(dialog(el).open).toBe(true);
});

test("a failed sign-in keeps the dialog open and keeps the typed email", async () => {
  vi.mocked(useAuthState).mockReturnValue({ state: { kind: "signed-out" }, refresh: vi.fn() });
  vi.mocked(signIn).mockResolvedValue({ ok: false, kind: "wrong-credentials" });
  const el = render();
  act(() => click(loginButton(el)));
  const emailInput = el.querySelector("#account-email") as HTMLInputElement;
  act(() => setNativeValue(emailInput, "x@y.nl"));
  act(() => setNativeValue(el.querySelector("#account-password") as HTMLInputElement, "wrong"));
  await act(async () => submit(el.querySelector("form") as HTMLFormElement));
  expect(dialog(el).open).toBe(true);
  expect((el.querySelector("#account-email") as HTMLInputElement).value).toBe("x@y.nl");
});

test("submitting valid credentials calls onEnter once", async () => {
  vi.mocked(useAuthState).mockReturnValue({ state: { kind: "signed-out" }, refresh: vi.fn() });
  vi.mocked(signIn).mockResolvedValue({ ok: true, state: { kind: "signed-in", email: "x@y.nl" } });
  const onEnter = vi.fn();
  const el = render(onEnter);
  act(() => click(loginButton(el)));
  act(() => setNativeValue(el.querySelector("#account-email") as HTMLInputElement, "x@y.nl"));
  act(() =>
    setNativeValue(el.querySelector("#account-password") as HTMLInputElement, "secret"),
  );
  await act(async () => submit(el.querySelector("form") as HTMLFormElement));
  expect(onEnter).toHaveBeenCalledTimes(1);
});

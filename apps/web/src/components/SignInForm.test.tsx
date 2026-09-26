// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import SignInForm from "./SignInForm";
import { signIn } from "../authClient.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../authClient.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../authClient.js")>();
  return { ...actual, useAuthState: vi.fn(), signIn: vi.fn() };
});

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  vi.mocked(signIn).mockReset();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function render(onSuccess: () => void = () => {}, introClassName?: string) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <SignInForm
        locale="nl"
        intro="Log in om verder te gaan."
        onSuccess={onSuccess}
        introClassName={introClassName}
      />,
    ),
  );
  return container;
}

function setNativeValue(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function submit(form: HTMLFormElement) {
  form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

test("renders the intro prop", () => {
  const el = render();
  expect(el.textContent).toContain("Log in om verder te gaan.");
});

test("without introClassName, the intro keeps the default cell-sub class (Profiel's call site)", () => {
  const el = render();
  const intro = el.querySelector("p");
  expect(intro?.className).toBe("cell-sub");
});

test("with introClassName, the intro uses it instead of cell-sub", () => {
  const el = render(() => {}, "custom-class");
  const intro = el.querySelector("p");
  expect(intro?.className).toBe("custom-class");
  expect(intro?.className).not.toContain("cell-sub");
});

test("submitting calls signIn with the typed email and password", async () => {
  vi.mocked(signIn).mockResolvedValue({ ok: true, state: { kind: "signed-in", email: "x@y.nl" } });
  const el = render();
  act(() => setNativeValue(el.querySelector("#account-email") as HTMLInputElement, "x@y.nl"));
  act(() =>
    setNativeValue(el.querySelector("#account-password") as HTMLInputElement, "secret"),
  );
  await act(async () => submit(el.querySelector("form") as HTMLFormElement));
  expect(signIn).toHaveBeenCalledWith("x@y.nl", "secret");
});

test("a wrong-credentials result shows the matching error text and does not call onSuccess", async () => {
  vi.mocked(signIn).mockResolvedValue({ ok: false, kind: "wrong-credentials" });
  const onSuccess = vi.fn();
  const el = render(onSuccess);
  act(() => setNativeValue(el.querySelector("#account-email") as HTMLInputElement, "x@y.nl"));
  act(() => setNativeValue(el.querySelector("#account-password") as HTMLInputElement, "wrong"));
  await act(async () => submit(el.querySelector("form") as HTMLFormElement));
  expect(el.querySelector('[role="alert"]')?.textContent).toBe(
    "Onjuist e-mailadres of wachtwoord.",
  );
  expect(onSuccess).not.toHaveBeenCalled();
});

test("an ok result calls onSuccess once", async () => {
  vi.mocked(signIn).mockResolvedValue({ ok: true, state: { kind: "signed-in", email: "x@y.nl" } });
  const onSuccess = vi.fn();
  const el = render(onSuccess);
  act(() => setNativeValue(el.querySelector("#account-email") as HTMLInputElement, "x@y.nl"));
  act(() =>
    setNativeValue(el.querySelector("#account-password") as HTMLInputElement, "secret"),
  );
  await act(async () => submit(el.querySelector("form") as HTMLFormElement));
  expect(onSuccess).toHaveBeenCalledTimes(1);
});

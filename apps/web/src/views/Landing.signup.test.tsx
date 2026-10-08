// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import Landing from "./Landing";
import { useAuthState } from "../authClient.js";
import type { Locale } from "../locale.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./CardSpiral", () => ({ default: () => null }));

vi.mock("../authClient.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../authClient.js")>();
  return { ...actual, useAuthState: vi.fn() };
});

let container: HTMLElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  vi.mocked(useAuthState).mockReturnValue({ state: { kind: "signed-out" }, refresh: vi.fn() });
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function render(locale: Locale) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Landing onEnter={() => {}} locale={locale} />));
  return container;
}

function click(el: Element | null | undefined) {
  el?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}

function dialog(el: HTMLElement): HTMLDialogElement {
  return el.querySelector("dialog") as HTMLDialogElement;
}

test.each([
  ["nl", "Account aanmaken"],
  ["en", "Create account"],
] as const)("%s: every account CTA opens the dialog on the sign-up view", (locale, label) => {
  const el = render(locale);
  const ctas = [...el.querySelectorAll("button, a")].filter(
    (n) => !dialog(el).contains(n) && n.textContent?.trim().startsWith(label),
  );
  expect(ctas.length).toBeGreaterThanOrEqual(3);
  for (const cta of ctas) {
    act(() => click(cta));
    expect(dialog(el).open).toBe(true);
    expect(dialog(el).querySelector("#signup-consent")).not.toBeNull();
    expect(dialog(el).querySelector("#account-password")).toBeNull();
    act(() => click(dialog(el).querySelector(".lp-signin-dialog-close")));
    expect(dialog(el).open).toBe(false);
  }
});

test("the dialog toggles between sign-up and sign-in", () => {
  const el = render("nl");
  const cta = [...el.querySelectorAll("button")].find(
    (b) => !dialog(el).contains(b) && b.textContent?.trim().startsWith("Account aanmaken"),
  );
  act(() => click(cta));
  act(() => click(dialog(el).querySelector("[data-testid='auth-toggle']")));
  expect(dialog(el).querySelector("#account-password")).not.toBeNull();
  expect(dialog(el).querySelector("#signup-consent")).toBeNull();
  act(() => click(dialog(el).querySelector("[data-testid='auth-toggle']")));
  expect(dialog(el).querySelector("#signup-consent")).not.toBeNull();
});

test("header Inloggen on the open sign-up view switches to sign-in and stays open", () => {
  const el = render("nl");
  const cta = [...el.querySelectorAll("button")].find(
    (b) => !dialog(el).contains(b) && b.textContent?.trim().startsWith("Account aanmaken"),
  );
  act(() => click(cta));
  expect(dialog(el).querySelector("#signup-consent")).not.toBeNull();
  const login = [...el.querySelectorAll("header button")].find(
    (b) => b.textContent?.trim() === "Inloggen",
  );
  act(() => click(login));
  expect(dialog(el).open).toBe(true);
  expect(dialog(el).querySelector("#account-password")).not.toBeNull();
  expect(dialog(el).querySelector("#signup-consent")).toBeNull();
  act(() => click(login));
  expect(dialog(el).open).toBe(false);
});

test.each([
  ["nl", "bevestigingslink"],
  ["en", "confirmation link"],
] as const)("%s: a bad verification link opens sign-in with an explanation", (locale, word) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Landing onEnter={() => {}} locale={locale} linkError />));
  expect(dialog(container).open).toBe(true);
  expect(dialog(container).querySelector("#account-password")).not.toBeNull();
  expect(dialog(container).querySelector('[role="alert"]')?.textContent).toContain(word);
});

// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import SignUpForm from "./SignUpForm";
import { signUp } from "../authClient.js";
import type { Locale } from "../locale.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../authClient.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../authClient.js")>();
  return { ...actual, signUp: vi.fn() };
});

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  vi.mocked(signUp).mockReset();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function render(locale: Locale = "nl") {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<SignUpForm locale={locale} intro="Maak een account." />));
  return container;
}

function setNativeValue(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function fill(el: HTMLElement) {
  act(() => setNativeValue(el.querySelector("#signup-name") as HTMLInputElement, "Anna"));
  act(() => setNativeValue(el.querySelector("#signup-email") as HTMLInputElement, "a@b.nl"));
  act(() => setNativeValue(el.querySelector("#signup-password") as HTMLInputElement, "longenough"));
}

function consent(el: HTMLElement): HTMLInputElement {
  return el.querySelector("#signup-consent") as HTMLInputElement;
}

function submitButton(el: HTMLElement): HTMLButtonElement {
  return el.querySelector('button[type="submit"]') as HTMLButtonElement;
}

function submit(el: HTMLElement) {
  el.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
}

test("the consent checkbox starts unchecked and links to /privacy and /terms", () => {
  const el = render();
  expect(consent(el).checked).toBe(false);
  expect(consent(el).required).toBe(true);
  const hrefs = [...el.querySelectorAll("label a")].map((a) => a.getAttribute("href"));
  expect(hrefs).toEqual(["/privacy", "/terms"]);
});

test("submit stays disabled until every field is filled and consent is checked", () => {
  const el = render();
  expect(submitButton(el).disabled).toBe(true);
  fill(el);
  expect(submitButton(el).disabled).toBe(true);
  act(() => consent(el).click());
  expect(submitButton(el).disabled).toBe(false);
  act(() => consent(el).click());
  expect(submitButton(el).disabled).toBe(true);
});

test("submitting without consent never calls signUp, even if the form event fires", async () => {
  const el = render();
  fill(el);
  await act(async () => submit(el));
  expect(signUp).not.toHaveBeenCalled();
});

test("submitting calls signUp with name, email, password and a callback into the personal app", async () => {
  vi.mocked(signUp).mockResolvedValue({ ok: true });
  const el = render();
  fill(el);
  act(() => consent(el).click());
  await act(async () => submit(el));
  expect(signUp).toHaveBeenCalledWith({
    name: "Anna",
    email: "a@b.nl",
    password: "longenough",
    callbackURL: `${window.location.origin}/app`,
  });
});

test("success replaces the form with the check-your-email state", async () => {
  vi.mocked(signUp).mockResolvedValue({ ok: true });
  const el = render("en");
  fill(el);
  act(() => consent(el).click());
  await act(async () => submit(el));
  expect(el.querySelector("form")).toBeNull();
  expect(el.querySelector('[role="status"]')?.textContent).toContain("Check your email");
  expect(el.textContent).toContain("a@b.nl");
});

test.each([
  ["weak-password", "nl", "Kies een wachtwoord van minimaal 8 tekens."],
  ["rate-limited", "en", "Too many attempts. Wait a minute and try again."],
  ["unreachable", "en", "Creating the account didn't work. Please try again later."],
] as const)("a %s failure shows its %s message and keeps the form", async (kind, locale, text) => {
  vi.mocked(signUp).mockResolvedValue({ ok: false, kind });
  const el = render(locale);
  fill(el);
  act(() => consent(el).click());
  await act(async () => submit(el));
  expect(el.querySelector('[role="alert"]')?.textContent).toBe(text);
  expect(el.querySelector("form")).not.toBeNull();
});

test("the password input is capped at the server's 128 characters", () => {
  const el = render();
  expect((el.querySelector("#signup-password") as HTMLInputElement).maxLength).toBe(128);
});

test("whitespace-only name, email or password counts as incomplete", () => {
  const el = render();
  fill(el);
  act(() => consent(el).click());
  expect(submitButton(el).disabled).toBe(false);
  for (const id of ["#signup-name", "#signup-email", "#signup-password"]) {
    fill(el);
    act(() => setNativeValue(el.querySelector(id) as HTMLInputElement, "   "));
    expect(submitButton(el).disabled, id).toBe(true);
  }
});

test("a whitespace-only field never reaches signUp even if the form event fires", async () => {
  const el = render();
  fill(el);
  act(() => setNativeValue(el.querySelector("#signup-name") as HTMLInputElement, "  "));
  act(() => consent(el).click());
  await act(async () => submit(el));
  expect(signUp).not.toHaveBeenCalled();
});

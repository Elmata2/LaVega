// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { VaultStorage } from "@lavega/adapters";
import VaultGate from "./VaultGate";
import type { GateState } from "../vault-gate.js";
import { signOut } from "../authClient.js";
import { setAppLocale } from "../appLocale.js";
import { shellCopy } from "../copy/shell.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../authClient.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../authClient.js")>();
  return { ...actual, signOut: vi.fn() };
});

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  vi.mocked(signOut).mockReset();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function render(gate: GateState, locale: "nl" | "en", onSignedOut = vi.fn()) {
  setAppLocale(locale);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const onRetry = vi.fn();
  act(() =>
    root!.render(
      <VaultGate
        gate={gate}
        storage={{} as VaultStorage}
        onReady={vi.fn()}
        onRetry={onRetry}
        onSignedOut={onSignedOut}
      />,
    ),
  );
  return { el: container, onSignedOut, onRetry };
}

function buttons(el: HTMLElement) {
  return [...el.querySelectorAll("button")];
}

test.each([
  ["unreadable", "nl"],
  ["unreadable", "en"],
  ["unreachable", "nl"],
  ["unreachable", "en"],
] as const)("%s key error shows a sign-out button in %s", (error, locale) => {
  const { el } = render({ error }, locale);
  const label = shellCopy[locale].vaultGate.keyError.signOut;
  const btn = buttons(el).find((b) => b.textContent === label);
  expect(btn).toBeDefined();
  expect(btn!.getAttribute("type")).toBe("button");
  expect(btn!.disabled).toBe(false);
  expect(label).toBe(locale === "nl" ? "Uitloggen" : "Sign out");
});

test("clicking sign out calls signOut once, disables the button meanwhile, then navigates", async () => {
  let release!: () => void;
  vi.mocked(signOut).mockReturnValue(new Promise<void>((r) => (release = r)));
  const { el, onSignedOut } = render({ error: "unreadable" }, "en");
  const btn = buttons(el).find((b) => b.textContent === "Sign out")!;
  act(() => btn.click());
  expect(signOut).toHaveBeenCalledTimes(1);
  expect(btn.disabled).toBe(true);
  expect(onSignedOut).not.toHaveBeenCalled();
  await act(async () => release());
  expect(onSignedOut).toHaveBeenCalledTimes(1);
});

test("a failing sign out shows the error and re-enables the button", async () => {
  vi.mocked(signOut).mockRejectedValue(new Error("offline"));
  const { el, onSignedOut } = render({ error: "unreadable" }, "en");
  const btn = buttons(el).find((b) => b.textContent === "Sign out")!;
  await act(async () => btn.click());
  expect(onSignedOut).not.toHaveBeenCalled();
  expect(btn.disabled).toBe(false);
  const alerts = [...el.querySelectorAll('[role="alert"]')].map((a) => a.textContent);
  expect(alerts).toContain(shellCopy.en.vaultGate.keyError.signOutError);
  expect(alerts).toContain(shellCopy.en.vaultGate.keyError.unreadable);
});

test("retry button still works and loading state has no sign-out", () => {
  const { el, onRetry } = render({ error: "unreadable" }, "en");
  act(() =>
    buttons(el)
      .find((b) => b.textContent === "Try again")!
      .click(),
  );
  expect(onRetry).toHaveBeenCalledTimes(1);
  act(() => root!.unmount());
  container!.remove();
  const loading = render("loading", "en");
  expect(buttons(loading.el)).toHaveLength(0);
});

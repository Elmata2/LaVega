// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import VaultGate from "./VaultGate";
import type { VaultStorage } from "@lavega/adapters";

// React only suppresses its act() warning when the environment declares itself.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* The pure rule in vaultPassword.ts is worth nothing if the screen never calls
 * it — which is exactly how `verifiedSession` came to guard no route. So this
 * drives the real form. */

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function renderSetup() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const storage = { setup: async () => {}, unlock: async () => true } as unknown as VaultStorage;
  act(() => {
    root!.render(<VaultGate gate="setup" storage={storage} onReady={() => {}} onBackup={() => {}} />);
  });
  return host;
}

function fill(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function fillBoth(container: HTMLElement, value: string) {
  fill(container.querySelector<HTMLInputElement>("#setup-pass1")!, value);
  fill(container.querySelector<HTMLInputElement>("#setup-pass2")!, value);
  const box = container.querySelector<HTMLInputElement>('.vault-checkbox-field input[type="checkbox"]')!;
  if (!box.checked) act(() => box.click());
}

test("a one-character password can no longer create a vault", () => {
  const container = renderSetup();
  fillBoth(container, "x");
  const button = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  expect(button.disabled).toBe(true);
});

test("the screen says why the password is refused", () => {
  const container = renderSetup();
  fillBoth(container, "x");
  expect(container.textContent).toMatch(/12/);
});

test("a strong passphrase enables vault creation", () => {
  const container = renderSetup();
  fillBoth(container, "mijn kluis is van mij");
  const button = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  expect(button.disabled).toBe(false);
});

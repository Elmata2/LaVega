// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { VaultStorage } from "@lavega/adapters";
import Backup from "./Backup";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  document.cookie = "lavega_locale=nl; Path=/";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 401 })),
  );
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
  document.cookie = "lavega_locale=; Path=/; Max-Age=0";
  vi.unstubAllGlobals();
});

async function render() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <Backup
        storage={{} as VaultStorage}
        asOf="2026-11-14"
        owner={{ kind: "device" }}
        onRestored={() => {}}
      />,
    );
  });
}

test("the primary actions are visible; everything else sits inside a closed details", async () => {
  await render();
  const details = container!.querySelector<HTMLDetailsElement>("details")!;
  expect(details).not.toBeNull();
  expect(details.open).toBe(false);
  expect(details.querySelector("summary")?.textContent).toBe("Meer opties");

  const primary = container!.querySelector('[data-testid="backup-primary"]')!;
  expect(details.contains(primary)).toBe(false);
  const labels = [...primary.querySelectorAll("button")].map((b) => b.textContent);
  expect(labels).toEqual(["Back-up maken", "Terugzetten"]);

  // The portable export and the server back-up are in "Meer opties", not on the card face.
  expect(details.querySelector('[data-testid="portable-export"]')).not.toBeNull();
  expect(primary.querySelector('[data-testid="portable-export"]')).toBeNull();
});

test("Terugzetten opens the restore form with its warning, and nothing is restored by opening it", async () => {
  await render();
  expect(container!.querySelector("#backup-restore-file")).toBeNull();
  const restore = [...container!.querySelectorAll("button")].find(
    (b) => b.textContent === "Terugzetten",
  )!;
  await act(async () => restore.click());
  expect(restore.getAttribute("aria-expanded")).toBe("true");
  expect(container!.querySelector("#backup-restore-file")).not.toBeNull();
  expect(container!.textContent).toContain("vervangt je huidige data");
  const submit = container!.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  expect(submit.disabled).toBe(true);
});

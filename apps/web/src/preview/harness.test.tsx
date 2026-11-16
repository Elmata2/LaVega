// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { installNetworkStub, refusedRequests } from "./network";
import { boot, MODES, Stage } from "./harness";

vi.hoisted(() => {
  /* What vite-preview-plugin.ts defines for the harness: same-origin API. */
  import.meta.env.VITE_API_URL = "";
  import.meta.env.VITE_RATES_URL = "/api/rates";
});

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let el: HTMLElement | null = null;

beforeAll(async () => {
  document.cookie = "lavega_locale=en; Path=/";
  installNetworkStub();
  await boot();
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  el?.remove();
  root = null;
  el = null;
});

async function show(id: string, dataset: "fixture" | "empty", path = "/app") {
  window.history.replaceState({}, "", path);
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  const mode = MODES.find((m) => m.id === id)!;
  await act(async () => {
    root!.render(<Stage mode={mode} dataset={dataset} />);
  });
  for (
    let i = 0;
    i < 600 &&
    (el.querySelector(".pv-loading") ||
      (mode.kind === "app" && !el.querySelector(".shell2")) ||
      i < 40);
    i++
  )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 25));
    });
  return el;
}

test(
  "the sample vault reaches the app shell and shows the synthetic accounts",
  { timeout: 60_000 },
  async () => {
    const c = await show("accounts", "fixture", "/app/accounts");
    expect(c.querySelector(".shell2")).not.toBeNull();
    expect(c.textContent).toContain("American Express");
  },
);

test("the empty vault still renders the shell", { timeout: 60_000 }, async () => {
  const c = await show("overview", "empty");
  expect(c.querySelector(".shell2")).not.toBeNull();
});

test("every non-app mode renders something", { timeout: 120_000 }, async () => {
  for (const m of MODES.filter((x) => x.kind !== "app")) {
    const c = await show(m.id, "fixture", "/app/preview");
    expect(c.textContent?.length ?? 0, m.id).toBeGreaterThan(20);
    act(() => root!.unmount());
    c.remove();
    root = null;
    el = null;
  }
});

test("nothing left the machine", () => {
  expect(refusedRequests()).toEqual([]);
});

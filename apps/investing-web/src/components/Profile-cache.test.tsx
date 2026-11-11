// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { ClearPriceCache } from "./Profile.js";

/* Issue #307 acceptance 9, web half: with a database the server answers 405
 * because prices are shared reference data, so the profile must not offer a
 * control that can only fail. A local file store keeps the control. */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

async function renderWithHealth(sharedPriceStore: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, service: "investing-server", sharedPriceStore }),
    })),
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<ClearPriceCache />);
  });
  // Let the health promise settle.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  return container;
}

test("a shared price store hides the clear-cache control", async () => {
  const view = await renderWithHealth(true);
  expect(view.querySelector("button")).toBeNull();
  expect(view.textContent).not.toContain("Price");
});

test("a local file store still offers the control", async () => {
  const view = await renderWithHealth(false);
  expect(view.querySelector("button")?.textContent).toBe("Clear price data");
});

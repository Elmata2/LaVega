// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { BrokerSettings } from "./BrokerSettings.js";

/* Issue #325: the stale-data problem links to `/profile#degiro-import`. The
 * hash must select the import tab, not just scroll to the broker section. */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

async function render(): Promise<HTMLElement> {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/api/investing/brokers/degiro/import"))
        return Response.json({
          mode: "status",
          importedAt: null,
          files: [],
          coverage: null,
          positionsAsOf: null,
        });
      return Response.json({});
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<BrokerSettings />);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return container;
}

test("the degiro-import hash opens the import tab", async () => {
  window.history.replaceState(null, "", "#degiro-import");
  const view = await render();
  expect(view.querySelector("#broker-tab-degiro")?.getAttribute("aria-selected")).toBe("true");
  expect(view.querySelector("#broker-panel-degiro")?.hasAttribute("hidden")).toBe(false);
  expect(view.querySelector("#broker-panel-api")?.hasAttribute("hidden")).toBe(true);
});

test("without the hash the API tab stays the default", async () => {
  const view = await render();
  expect(view.querySelector("#broker-tab-api")?.getAttribute("aria-selected")).toBe("true");
  expect(view.querySelector("#broker-panel-degiro")?.hasAttribute("hidden")).toBe(true);
});

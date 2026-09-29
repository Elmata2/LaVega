// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { dashboard } from "../test/fetchFixtures.js";
import { forgetDashboards } from "../lib/dashboardResource.js";
import { NetWorthPage } from "./NetWorthPage.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  forgetDashboards();
});

function render() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  return { container, root };
}

test("shows the net worth chart once the dashboard loads", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(dashboard), { status: 200 })),
  );
  const { container, root } = render();
  act(() => {
    root.render(<NetWorthPage />);
  });
  await act(async () => {});
  expect(
    container.querySelector('[role="group"][aria-label="Choose net worth period"]'),
  ).not.toBeNull();
});

test("shows an empty state when the dashboard fails to load", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("", { status: 500 })),
  );
  const { container, root } = render();
  act(() => {
    root.render(<NetWorthPage />);
  });
  await act(async () => {});
  expect(container.textContent).toContain("Dashboard unavailable");
});

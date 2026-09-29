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

test("folds the owner's shared Personal totals into the chart's net worth", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/investing/personal-net-worth"))
        return new Response(
          JSON.stringify({ totals: [{ date: "2026-08-18", totalCents: 50_000 }] }),
          { status: 200 },
        );
      return new Response(JSON.stringify(dashboard), { status: 200 });
    }),
  );
  const { container, root } = render();
  act(() => {
    root.render(<NetWorthPage />);
  });
  await act(async () => {});
  expect(container.textContent).toContain("Bank accounts (Personal, as of 18 Aug 2026)");
  expect(container.textContent).toContain("€620.00");
});

test("an owner who has never shared a total sees the chart unchanged", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/investing/personal-net-worth"))
        return new Response(JSON.stringify({ totals: [] }), { status: 200 });
      return new Response(JSON.stringify(dashboard), { status: 200 });
    }),
  );
  const { container, root } = render();
  act(() => {
    root.render(<NetWorthPage />);
  });
  await act(async () => {});
  expect(container.textContent).not.toContain("Bank accounts");
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

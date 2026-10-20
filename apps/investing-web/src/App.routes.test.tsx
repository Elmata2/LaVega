// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { forgetDashboards } from "./lib/dashboardResource";
import { forgetLayout } from "./lib/layoutResource";
import { emptyResponseFor } from "./test/fetchFixtures";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

beforeEach(() => forgetLayout());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  forgetDashboards();
  forgetLayout();
  document.body.innerHTML = "";
});

function Location() {
  const location = useLocation();
  return <output data-testid="path">{location.pathname}</output>;
}

test.each([
  ["/positions", "/positions/ASML"],
  ["/agents", "/agents/research"],
])("disabled %s module redirects detail route %s to Overview", async (modulePath, detailPath) => {
  const moduleId = modulePath.slice(1);
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/investing/layout")
        return Promise.resolve(
          new Response(JSON.stringify({ modules: { [moduleId]: false }, widgets: {} })),
        );
      return Promise.resolve(emptyResponseFor(input, init));
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[detailPath]}>
        <Location />
        <App />
      </MemoryRouter>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(container.querySelector('[data-testid="path"]')?.textContent).toBe("/");
  expect(
    container.querySelector(`nav[aria-label="Main navigation"] a[href="${modulePath}"]`),
  ).toBeNull();
  act(() => root.unmount());
});

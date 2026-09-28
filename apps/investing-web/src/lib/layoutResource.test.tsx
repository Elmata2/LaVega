// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { useInvestingLayout } from "./layoutResource.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(() => vi.restoreAllMocks());

function Probe() {
  const layout = useInvestingLayout();
  return (
    <div>
      <span data-testid="status">{layout.status}</span>
      <span data-testid="modules">{layout.modules.join(",")}</span>
      <span data-testid="widgets">{layout.widgets.join(",")}</span>
    </div>
  );
}

function render() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  return { container, root };
}

test("resolves registry defaults immediately, before the fetch settles", async () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
  const { container, root } = render();
  act(() => root.render(<Probe />));
  expect(container.querySelector('[data-testid="status"]')?.textContent).toBe("loading");
  expect(container.querySelector('[data-testid="modules"]')?.textContent).toBe(
    "overview,positions,net-worth,agents",
  );
  root.unmount();
});

test("applies the tenant's stored choices once the fetch resolves", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ modules: { agents: false }, widgets: { sectors: false } })),
      ),
    ),
  );
  const { container, root } = render();
  await act(async () => {
    root.render(<Probe />);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.querySelector('[data-testid="status"]')?.textContent).toBe("ready");
  expect(container.querySelector('[data-testid="modules"]')?.textContent).toBe(
    "overview,positions,net-worth",
  );
  expect(container.querySelector('[data-testid="widgets"]')?.textContent).toBe(
    "performance,allocation,kpis,risk,agent",
  );
  root.unmount();
});

test("a failed or unauthorized fetch keeps the registry defaults instead of erroring", async () => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("", { status: 401 }))));
  const { container, root } = render();
  await act(async () => {
    root.render(<Probe />);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.querySelector('[data-testid="modules"]')?.textContent).toBe(
    "overview,positions,net-worth,agents",
  );
  root.unmount();
});

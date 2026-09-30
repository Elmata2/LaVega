// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { usePersonalNetWorthTotals } from "./personalNetWorthResource";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;
const originalFetch = globalThis.fetch;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  globalThis.fetch = originalFetch;
});

function Probe() {
  const totals = usePersonalNetWorthTotals();
  return <div data-testid="totals">{JSON.stringify(totals)}</div>;
}

async function render() {
  act(() => root!.render(<Probe />));
  await act(async () => {});
}

test("renders the totals the server answers with", async () => {
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({ totals: [{ date: "2026-09-01", totalCents: 100_00 }] }),
      { status: 200 },
    ),
  );
  await render();
  expect(container!.querySelector('[data-testid="totals"]')!.textContent).toBe(
    JSON.stringify([{ date: "2026-09-01", totalCents: 100_00 }]),
  );
});

test("fails open to an empty list on a non-2xx response", async () => {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
  await render();
  expect(container!.querySelector('[data-testid="totals"]')!.textContent).toBe("[]");
});

test("fails open to an empty list on a network error, without throwing", async () => {
  globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline"));
  await render();
  expect(container!.querySelector('[data-testid="totals"]')!.textContent).toBe("[]");
});

test("drops a malformed entry rather than crashing the chart", async () => {
  globalThis.fetch = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        totals: [{ date: "2026-09-01", totalCents: 100 }, { date: 5, totalCents: "oops" }],
      }),
      { status: 200 },
    ),
  );
  await render();
  expect(container!.querySelector('[data-testid="totals"]')!.textContent).toBe(
    JSON.stringify([{ date: "2026-09-01", totalCents: 100 }]),
  );
});

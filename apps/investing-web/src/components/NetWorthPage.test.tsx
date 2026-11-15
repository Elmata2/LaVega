// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";

/* The net worth page shows WHERE the newest shared Personal total came from
 * when the agent path recorded it with a citation (#300, WS5.5). The sibling
 * resource test covers decoding; this one covers the visible line. */
const { useDashboard, usePersonalNetWorthTotals } = vi.hoisted(() => ({
  useDashboard: vi.fn(),
  usePersonalNetWorthTotals: vi.fn(),
}));

vi.mock("../lib/dashboardResource.js", () => ({ useDashboard }));
vi.mock("../lib/personalNetWorthResource.js", () => ({ usePersonalNetWorthTotals }));

const { NetWorthPage } = await import("./NetWorthPage.js");

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
afterEach(() => document.body.replaceChildren());

const EMPTY_PORTFOLIO = {
  "1M": [],
  "6M": [],
  "1Y": [],
  YTD: [],
  All: [],
};

const dashboardState = {
  status: "ready" as const,
  data: { portfolio: EMPTY_PORTFOLIO, presentationCurrency: "EUR" },
};

async function renderPage(): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<NetWorthPage />);
  });
  return container;
}

test("a citation on the newest shared total is shown as a structured source line", async () => {
  useDashboard.mockReturnValue(dashboardState);
  usePersonalNetWorthTotals.mockReturnValue([
    {
      date: "2026-09-30",
      totalCents: 12_345_600,
      provenance: {
        source: "Trading 212 account statement",
        grade: "A",
        date: "2026-09-30",
        documentId: "statement-09",
      },
    },
  ]);
  const container = await renderPage();
  const line = container.querySelector('[data-testid="personal-total-provenance"]');
  expect(line?.textContent).toBe(
    "Personal total source: Trading 212 account statement · grade A · 2026-09-30 · statement-09",
  );
});

test("no citation means no source line — the browser share flow cites nothing", async () => {
  useDashboard.mockReturnValue(dashboardState);
  usePersonalNetWorthTotals.mockReturnValue([{ date: "2026-09-30", totalCents: 12_345_600 }]);
  const container = await renderPage();
  expect(container.querySelector('[data-testid="personal-total-provenance"]')).toBeNull();
  expect(container.textContent).not.toContain("Personal total source");
});

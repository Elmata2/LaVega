// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test } from "vitest";
import { PositionPriceChart } from "./PositionPriceChart";

test("exposes position price history and marker details accessibly", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => { root.render(<PositionPriceChart symbol="AAPL" currency="USD" points={[{ tenantId: "local", symbol: "AAPL", date: "2026-01-05", close: 100, currency: "USD", markers: [{ kind: "buy", eventDate: "2026-01-05", label: "Koop 2" }] }]} />); });
  expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).toContain("AAPL");
  expect(container.textContent).toContain("Koop");
  expect(container.textContent).toContain("Koop 2");
  root.unmount();
});

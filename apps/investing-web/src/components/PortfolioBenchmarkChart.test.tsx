// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { PortfolioBenchmarkChart, pointsForWindow } from "./PortfolioBenchmarkChart";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;
afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const points = [
  {
    date: "2026-01-01",
    positionsValue: 100,
    cashValue: null,
    value: 100,
    unpriced: [],
    forwardFilled: [],
    cashUnknown: [],
  },
  {
    date: "2026-01-02",
    positionsValue: 110,
    cashValue: null,
    value: 110,
    unpriced: [],
    forwardFilled: [],
    cashUnknown: [],
  },
];
const benchmarks = [
  {
    symbol: "^AEX",
    name: "AEX",
    exchange: "Amsterdam",
    currency: "EUR",
    points: [
      { date: "2026-01-01", value: 900 },
      { date: "2026-01-02", value: 909 },
    ],
  },
  {
    symbol: "^GDAXI",
    name: "DAX",
    exchange: "Frankfurt",
    currency: "EUR",
    points: [
      { date: "2026-01-01", value: 20_000 },
      { date: "2026-01-02", value: 20_100 },
    ],
  },
];
const longPoints = Array.from({ length: 10 }, (_, index) => ({
  date: `2026-01-${String(index + 1).padStart(2, "0")}`,
  positionsValue: 100 + index * 10,
  cashValue: 0,
  value: 100 + index * 10,
  unpriced: index === 4 ? ["MISSING"] : [],
  forwardFilled: [],
  cashUnknown: [],
}));

function mockSelectionFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "PUT"
        ? new Response(JSON.stringify({ tenantId: "local", symbols: ["^GDAXI"] }))
        : new Response(JSON.stringify({ tenantId: "local", symbols: ["^AEX", "^GDAXI"] })),
    ),
  );
}

function changeInput(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function pointerEvent(type: string, clientX: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, button: 0 });
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
}

test("renders indexed mode, accessible legend, and reflows colors after removal", async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
    init?.method === "PUT"
      ? new Response(JSON.stringify({ tenantId: "local", symbols: ["^GDAXI"] }))
      : new Response(JSON.stringify({ tenantId: "local", symbols: ["^AEX", "^GDAXI"] })),
  );
  vi.stubGlobal("fetch", fetchMock);
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => {
    root.render(<PortfolioBenchmarkChart data={{ "1M": points }} benchmarks={benchmarks} />);
    await Promise.resolve();
  });
  expect(container.textContent).toContain("Geïndexeerd rendement");
  expect(container.textContent).toContain("> +999%");
  expect(container.querySelector('button[aria-pressed="true"]')).not.toBeNull();
  const daxDotBefore = Array.from(container.querySelectorAll("span"))
    .find((node) => node.textContent?.includes("DAX"))
    ?.querySelector<HTMLElement>("span")?.style.backgroundColor;
  await act(async () => {
    container.querySelector<HTMLButtonElement>('button[aria-label="^AEX verwijderen"]')?.click();
    await Promise.resolve();
  });
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/investing/benchmarks",
    expect.objectContaining({ method: "PUT" }),
  );
  const daxDotAfter = Array.from(container.querySelectorAll("span"))
    .find((node) => node.textContent?.includes("DAX"))
    ?.querySelector<HTMLElement>("span")?.style.backgroundColor;
  expect(daxDotAfter).not.toBe(daxDotBefore);
  await act(async () => root.unmount());
});

test("uses one custom window for typed dates and clears it with Escape", async () => {
  mockSelectionFetch();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <PortfolioBenchmarkChart
        data={{ "1M": longPoints, All: longPoints }}
        benchmarks={benchmarks}
      />,
    );
    await Promise.resolve();
  });
  const from = container.querySelector<HTMLInputElement>('input[aria-label="Van datum"]')!;
  const to = container.querySelector<HTMLInputElement>('input[aria-label="Tot datum"]')!;
  await act(async () => {
    changeInput(from, "2026-01-08");
    changeInput(to, "2026-01-03");
  });
  await act(async () => {
    container
      .querySelector<HTMLFormElement>('form[aria-label="Datumbereik kiezen"]')!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(container.querySelector('button[aria-label="Zoom wissen"]')?.textContent).toContain(
    "3 jan",
  );
  const chart = container.querySelector<HTMLElement>('[role="img"]')!;
  await act(async () => {
    chart.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(container.querySelector('button[aria-label="Zoom wissen"]')).toBeNull();
  await act(async () => root.unmount());
});

test("supports keyboard crosshair and announces exact unknown values", async () => {
  mockSelectionFetch();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <PortfolioBenchmarkChart
        data={{ "1M": longPoints, All: longPoints }}
        benchmarks={benchmarks}
      />,
    );
    await Promise.resolve();
  });
  const chart = container.querySelector<HTMLElement>('[role="img"]')!;
  expect(chart.getAttribute("tabindex")).toBe("0");
  await act(async () => {
    chart.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
  });
  expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain("1 jan");
  for (let index = 0; index < 4; index += 1)
    await act(async () => {
      chart.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
  expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain("MISSING");
  expect(container.querySelector('ul[aria-label="Exacte grafiekwaarden"]')?.textContent).toContain(
    "AEX TWR",
  );
  await act(async () => root.unmount());
});

test("wheel and pointer drag write custom zoom without brush", async () => {
  mockSelectionFetch();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <PortfolioBenchmarkChart
        data={{ "1M": longPoints, All: longPoints }}
        benchmarks={benchmarks}
      />,
    );
    await Promise.resolve();
  });
  const chart = container.querySelector<HTMLElement>('[role="img"]')!;
  Object.defineProperty(chart, "clientWidth", { configurable: true, value: 400 });
  chart.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 400,
    bottom: 320,
    width: 400,
    height: 320,
    toJSON: () => ({}),
  });
  const wheel = new WheelEvent("wheel", {
    bubbles: true,
    cancelable: true,
    clientX: 200,
    deltaY: -100,
  });
  await act(async () => {
    chart.dispatchEvent(wheel);
  });
  expect(wheel.defaultPrevented).toBe(true);
  expect(container.querySelector('button[aria-label="Zoom wissen"]')).not.toBeNull();
  expect(container.querySelector(".recharts-brush")).toBeNull();
  const wheelWindow = container.querySelector('button[aria-label="Zoom wissen"]')?.textContent;
  await act(async () => {
    chart.dispatchEvent(pointerEvent("pointerdown", 80));
  });
  await act(async () => {
    chart.dispatchEvent(pointerEvent("pointermove", 300));
  });
  await act(async () => {
    chart.dispatchEvent(pointerEvent("pointerup", 300));
  });
  expect(container.querySelector('button[aria-label="Zoom wissen"]')?.textContent).not.toBe(
    wheelWindow,
  );
  await act(async () => root.unmount());
});

test("window helper preserves original requested start", () => {
  expect(
    pointsForWindow(
      { All: longPoints },
      { kind: "custom", from: "2026-01-03", to: "2026-01-05", baseRange: "1M" },
    ).map(({ date }) => date),
  ).toEqual(["2026-01-03", "2026-01-04", "2026-01-05"]);
});

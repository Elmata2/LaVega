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

function pointerEvent(type: string, clientX: number, pointerId = 1) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, button: 0 });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  return event;
}

async function renderZoomableChart() {
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
  const dispatch = async (event: Event) => {
    await act(async () => {
      chart.dispatchEvent(event);
    });
  };
  const zoomPill = () => container.querySelector('button[aria-label="Clear zoom"]');
  return { root, dispatch, zoomPill };
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
  expect(container.textContent).toContain("Indexed return");
  expect(container.textContent).toContain("> +999%");
  expect(container.querySelector('button[aria-pressed="true"]')).not.toBeNull();
  const daxDotBefore = Array.from(container.querySelectorAll("span"))
    .find((node) => node.textContent?.includes("DAX"))
    ?.querySelector<HTMLElement>("span")?.style.backgroundColor;
  await act(async () => {
    container.querySelector<HTMLButtonElement>('button[aria-label="^AEX remove"]')?.click();
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
  const from = container.querySelector<HTMLInputElement>('input[aria-label="From date"]')!;
  const to = container.querySelector<HTMLInputElement>('input[aria-label="To date"]')!;
  await act(async () => {
    changeInput(from, "2026-01-08");
    changeInput(to, "2026-01-03");
  });
  await act(async () => {
    container
      .querySelector<HTMLFormElement>('form[aria-label="Choose date range"]')!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(container.querySelector('button[aria-label="Clear zoom"]')?.textContent).toContain(
    "3 Jan",
  );
  const chart = container.querySelector<HTMLElement>('[role="img"]')!;
  await act(async () => {
    chart.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(container.querySelector('button[aria-label="Clear zoom"]')).toBeNull();
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
  expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain("1 Jan");
  for (let index = 0; index < 4; index += 1)
    await act(async () => {
      chart.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
  expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain("MISSING");
  expect(container.querySelector('ul[aria-label="Exact chart values"]')?.textContent).toContain(
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
  expect(container.querySelector('button[aria-label="Clear zoom"]')).not.toBeNull();
  expect(container.querySelector(".recharts-brush")).toBeNull();
  const wheelWindow = container.querySelector('button[aria-label="Clear zoom"]')?.textContent;
  await act(async () => {
    chart.dispatchEvent(pointerEvent("pointerdown", 80));
  });
  await act(async () => {
    chart.dispatchEvent(pointerEvent("pointermove", 300));
  });
  await act(async () => {
    chart.dispatchEvent(pointerEvent("pointerup", 300));
  });
  expect(container.querySelector('button[aria-label="Clear zoom"]')?.textContent).not.toBe(
    wheelWindow,
  );
  await act(async () => root.unmount());
});

test("axis label box sizes to the widest label instead of wrapping under the title", async () => {
  mockSelectionFetch();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<PortfolioBenchmarkChart data={{ "1M": points }} benchmarks={benchmarks} />);
    await Promise.resolve();
  });
  const labels = Array.from(container.querySelectorAll(".axis-label"));
  expect(labels).toHaveLength(2);
  for (const label of labels) {
    expect(label.classList.contains("absolute")).toBe(false);
    expect(label.classList.contains("whitespace-nowrap")).toBe(true);
    expect(label.classList.contains("col-start-1")).toBe(true);
    expect(label.classList.contains("row-start-1")).toBe(true);
  }
  expect(labels[0]!.parentElement!.classList.contains("grid")).toBe(true);
  await act(async () => root.unmount());
});

test("comparison card says no price history for a benchmark with zero points", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "PUT"
        ? new Response(JSON.stringify({ tenantId: "local", symbols: ["NEWETF"] }))
        : new Response(JSON.stringify({ tenantId: "local", symbols: ["NEWETF"] })),
    ),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <PortfolioBenchmarkChart
        data={{ "1M": points }}
        benchmarks={[{ symbol: "NEWETF", name: "New ETF", exchange: "NYSE Arca", currency: "EUR", points: [] }]}
      />,
    );
    await Promise.resolve();
  });
  const heading = Array.from(container.querySelectorAll("p")).find((node) =>
    node.textContent?.startsWith("vs. New ETF"),
  )!;
  const card = heading.closest("div")!;
  expect(card.textContent).toContain("No price history for NEWETF.");
  expect(card.textContent).not.toContain("Unknown");
  await act(async () => root.unmount());
});

test("comparison card surfaces the currency-mismatch reason for a foreign-currency benchmark", async () => {
  const usdBenchmark = {
    symbol: "SPY",
    name: "SPDR S&P 500",
    exchange: "NYSE Arca",
    currency: "USD",
    points: [
      { date: "2026-01-01", value: 470 },
      { date: "2026-01-02", value: 475 },
    ],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "PUT"
        ? new Response(JSON.stringify({ tenantId: "local", symbols: ["SPY"] }))
        : new Response(JSON.stringify({ tenantId: "local", symbols: ["SPY"] })),
    ),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<PortfolioBenchmarkChart data={{ "1M": points }} benchmarks={[usdBenchmark]} />);
    await Promise.resolve();
  });
  const heading = Array.from(container.querySelectorAll("p")).find((node) =>
    node.textContent?.startsWith("vs. SPDR S&P 500"),
  )!;
  const card = heading.closest("div")!;
  expect(card.textContent).toContain(
    "Beta and alpha need a EUR-quoted benchmark; SPY is quoted in USD.",
  );
  await act(async () => root.unmount());
});

test("comparison card omits the currency-mismatch reason when currencies match", async () => {
  mockSelectionFetch();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<PortfolioBenchmarkChart data={{ "1M": points }} benchmarks={benchmarks} />);
    await Promise.resolve();
  });
  expect(container.textContent).not.toContain("Beta and alpha need a");
  await act(async () => root.unmount());
});

test("search results mark an instrument whose currency differs from the portfolio's currency", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/benchmarks/search"))
        return new Response(
          JSON.stringify({
            results: [
              { symbol: "SPY", name: "SPDR S&P 500", exchange: "NYSE Arca", currency: "USD" },
            ],
          }),
        );
      return new Response(JSON.stringify({ tenantId: "local", symbols: [] }));
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<PortfolioBenchmarkChart data={{ "1M": points }} />);
    await Promise.resolve();
  });
  await act(async () => {
    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "+ Compare")!
      .click();
  });
  const input = container.querySelector<HTMLInputElement>('input[role="combobox"]')!;
  await act(async () => {
    changeInput(input, "SPY");
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 260));
  });
  const resultButton = container.querySelector<HTMLButtonElement>(
    '#benchmark-results button',
  )!;
  expect(resultButton.textContent).toContain(
    "Beta and alpha need a EUR-quoted benchmark; SPY is quoted in USD.",
  );
  expect(resultButton.disabled).toBe(false);
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

test("a second pointer cannot overwrite the first pointer's drag", async () => {
  const { root, dispatch, zoomPill } = await renderZoomableChart();
  await dispatch(pointerEvent("pointerdown", 80, 1));
  await dispatch(pointerEvent("pointerdown", 300, 2));
  await dispatch(pointerEvent("pointerup", 300, 2));
  expect(zoomPill()).toBeNull();
  await dispatch(pointerEvent("pointermove", 300, 1));
  await dispatch(pointerEvent("pointerup", 300, 1));
  expect(zoomPill()?.textContent).toContain("1 Jan");
  await act(async () => root.unmount());
});

test.each(["pointercancel", "lostpointercapture"])(
  "%s ends the drag without zooming",
  async (type) => {
    const { root, dispatch, zoomPill } = await renderZoomableChart();
    await dispatch(pointerEvent("pointerdown", 80));
    await dispatch(pointerEvent("pointermove", 300));
    await dispatch(pointerEvent(type, 300));
    await dispatch(pointerEvent("pointerup", 300));
    expect(zoomPill()).toBeNull();
    await act(async () => root.unmount());
  },
);

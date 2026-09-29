// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import {
  PerformanceTooltip,
  PortfolioBenchmarkChart,
  pointsForWindow,
} from "./PortfolioBenchmarkChart";

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

test("stale chart tooltip point does not crash when a benchmark is selected", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <PerformanceTooltip
        active
        payload={[{ payload: points[0] as never }]}
        mode="indexed"
        benchmarks={benchmarks}
        currency="EUR"
      />,
    );
  });
  expect(container.textContent).toContain("vs. AEX");
  expect(container.textContent).toContain("Unknown");
  await act(async () => root.unmount());
});

test("XIRR row shows percent-for-percent, not a pp spread", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const point = {
    ...points[0],
    portfolioReturn: 0.118,
    portfolioXirr: 0.118,
    benchmarkReturns: { "^AEX": 0.294 },
    benchmarkXirr: { "^AEX": 0.294 },
  };
  await act(async () => {
    root.render(
      <PerformanceTooltip
        active
        payload={[{ payload: point as never }]}
        mode="indexed"
        benchmarks={[benchmarks[0]!]}
        currency="EUR"
      />,
    );
  });
  expect(container.textContent).toContain("XIRR p.j. Portfolio +11.8% · AEX +29.4%");
  expect(container.textContent).not.toContain("pp");
  await act(async () => root.unmount());
});

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
  await act(async () => {
    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Custom")!
      .click();
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

test("Custom tab reveals date inputs and a preset tab hides them again", async () => {
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
  expect(container.querySelector('input[aria-label="From date"]')).toBeNull();
  const customButton = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Custom",
  )!;
  await act(async () => {
    customButton.click();
  });
  expect(container.querySelector('input[aria-label="From date"]')).not.toBeNull();
  expect(container.querySelector('input[aria-label="To date"]')).not.toBeNull();
  expect(container.querySelector('button[type="submit"]')?.textContent).toBe("Apply");
  expect(customButton.getAttribute("aria-pressed")).toBe("true");
  const oneMonthButton = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "1 month",
  )!;
  await act(async () => {
    oneMonthButton.click();
  });
  expect(container.querySelector('input[aria-label="From date"]')).toBeNull();
  expect(container.querySelector('button[type="submit"]')).toBeNull();
  expect(customButton.getAttribute("aria-pressed")).toBe("false");
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

test("a wheel zoom marks the Custom tab pressed, and a preset click un-presses it and hides the inputs", async () => {
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
  const customButton = () =>
    Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Custom",
    )!;
  expect(customButton().getAttribute("aria-pressed")).toBe("false");
  await act(async () => {
    chart.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 200, deltaY: -100 }),
    );
  });
  expect(customButton().getAttribute("aria-pressed")).toBe("true");
  expect(container.querySelector('input[aria-label="From date"]')).not.toBeNull();
  const oneMonthButton = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "1 month",
  )!;
  await act(async () => {
    oneMonthButton.click();
  });
  expect(customButton().getAttribute("aria-pressed")).toBe("false");
  expect(container.querySelector('input[aria-label="From date"]')).toBeNull();
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
        benchmarks={[
          { symbol: "NEWETF", name: "New ETF", exchange: "NYSE Arca", currency: "EUR", points: [] },
        ]}
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

test("comparison card makes no beta/alpha currency claim about an unconverted series", async () => {
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
  /* The dashboard relabels every series to the presentation currency, so a
   * foreign-currency series is not a state it can produce. What must never
   * appear is the old claim that beta and alpha are unavailable: they are
   * computed from the converted series. */
  expect(card.textContent).not.toContain("Beta and alpha need a");
  await act(async () => root.unmount());
});

test("comparison card marks a converted benchmark and shows the conversion notice", async () => {
  const convertedBenchmark = {
    symbol: "SPY",
    name: "SPDR S&P 500",
    exchange: "NYSE Arca",
    currency: "EUR",
    converted: true,
    points: [
      { date: "2026-01-01", value: 427 },
      { date: "2026-01-02", value: 432 },
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
    root.render(
      <PortfolioBenchmarkChart data={{ "1M": points }} benchmarks={[convertedBenchmark]} />,
    );
    await Promise.resolve();
  });
  const heading = Array.from(container.querySelectorAll("p")).find((node) =>
    node.textContent?.startsWith("vs. SPDR S&P 500 (converted)"),
  )!;
  expect(heading).toBeTruthy();
  const card = heading.closest("div")!;
  expect(card.textContent).toContain("(converted)");
  expect(card.textContent).toContain(
    "SPDR S&P 500 is converted to EUR using each day's ECB rate; its return will not match the SPY figure quoted in its own currency.",
  );
  expect(card.textContent).not.toContain("Beta and alpha need a");
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
  const resultButton = container.querySelector<HTMLButtonElement>("#benchmark-results button")!;
  expect(resultButton.textContent).toContain("Converted to EUR at each day's ECB rate.");
  expect(resultButton.textContent).not.toContain("Beta and alpha need a");
  expect(resultButton.disabled).toBe(false);
  await act(async () => root.unmount());
});

test("a failed search clears the previous search's results instead of leaving them clickable", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("q=GSPC"))
        return new Response(
          JSON.stringify({
            results: [{ symbol: "^GSPC", name: "S&P 500", exchange: "SNP", currency: "USD" }],
          }),
        );
      if (url.includes("/benchmarks/search")) return new Response(null, { status: 428 });
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
    changeInput(input, "GSPC");
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 260));
  });
  expect(container.querySelector("#benchmark-results")!.textContent).toContain("S&P 500");

  await act(async () => {
    changeInput(input, "DAX");
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 260));
  });
  expect(container.querySelector('[role="status"]')!.textContent).toBe("Search unavailable");
  expect(container.querySelector("#benchmark-results")!.textContent).not.toContain("S&P 500");
  await act(async () => root.unmount());
});

const risingPoints = [50, 60, 70, 80, 90, 100, 150, 180, 220, 300].map((value, index) => ({
  date: `2026-01-${String(index + 1).padStart(2, "0")}`,
  positionsValue: value,
  cashValue: 0,
  value,
  unpriced: [],
  forwardFilled: [],
  cashUnknown: [],
}));
const flatBenchmark = {
  symbol: "^BENCH",
  name: "Bench",
  exchange: "Test",
  currency: "EUR",
  points: risingPoints.map((point) => ({ date: point.date, value: 1000 })),
};

test("headline return is anchored on the selected window's start, not full history", async () => {
  mockSelectionFetch();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) =>
      init?.method === "PUT"
        ? new Response(JSON.stringify({ tenantId: "local", symbols: ["^BENCH"] }))
        : new Response(JSON.stringify({ tenantId: "local", symbols: ["^BENCH"] })),
    ),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <PortfolioBenchmarkChart
        data={{ "1M": risingPoints, All: risingPoints }}
        benchmarks={[flatBenchmark]}
      />,
    );
    await Promise.resolve();
  });
  await act(async () => {
    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Custom")!
      .click();
  });
  const from = container.querySelector<HTMLInputElement>('input[aria-label="From date"]')!;
  const to = container.querySelector<HTMLInputElement>('input[aria-label="To date"]')!;
  await act(async () => {
    changeInput(from, "2026-01-06");
    changeInput(to, "2026-01-10");
  });
  await act(async () => {
    container
      .querySelector<HTMLFormElement>('form[aria-label="Choose date range"]')!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  // Window start (day 6, value 100) to window end (day 10, value 300): +200%.
  // A regression that fed `buildIndexedSeries` the full series (day 1, value
  // 50) instead of the windowed points would report +500% here instead.
  const windowedReturn = 300 / 100 - 1;
  const fullHistoryReturn = 300 / 50 - 1;
  expect(windowedReturn).toBe(2);
  expect(fullHistoryReturn).toBe(5);
  const summary = container.querySelector('[aria-label="Return on selected date"]')!;
  expect(summary.textContent).toContain("Portfolio +200.0%");
  expect(summary.textContent).not.toContain("500.0%");
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

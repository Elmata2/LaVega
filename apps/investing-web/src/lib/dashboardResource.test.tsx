// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { emptyInvestingDashboard, type InvestingDashboardData } from "@lavega/core";
import {
  forgetDashboards,
  setDashboardOwner,
  useDashboard,
  type DashboardState,
} from "./dashboardResource";
import { DASHBOARD_REFRESH_EVENT } from "./priceSync";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(() => {
  vi.restoreAllMocks();
  forgetDashboards();
});

function dashboardWithVersion(dataVersion: number): InvestingDashboardData {
  return { ...emptyInvestingDashboard(), dataVersion };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function mount(symbol: string | undefined, states: DashboardState[]) {
  function Probe({ querySymbol }: { querySymbol: string | undefined }) {
    const state = useDashboard(querySymbol);
    states.push(state);
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  return { root, Probe };
}

test("resolving refresh requests in reverse order keeps the newest data displayed", async () => {
  const first = deferred<Response>();
  const second = deferred<Response>();
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      calls.push("call");
      return calls.length === 1 ? first.promise : second.promise;
    }),
  );
  const states: DashboardState[] = [];
  const { root, Probe } = mount(undefined, states);
  await act(async () => {
    root.render(<Probe querySymbol={undefined} />);
    await Promise.resolve();
  });
  await act(async () => {
    window.dispatchEvent(new Event(DASHBOARD_REFRESH_EVENT));
    await Promise.resolve();
  });
  expect(calls).toHaveLength(2);
  await act(async () => {
    second.resolve(new Response(JSON.stringify(dashboardWithVersion(2))));
    await Promise.resolve();
    await Promise.resolve();
  });
  await act(async () => {
    first.resolve(new Response(JSON.stringify(dashboardWithVersion(1))));
    await Promise.resolve();
    await Promise.resolve();
  });
  const finalState = states.at(-1)!;
  expect(finalState.status).toBe("ready");
  expect(finalState.status === "ready" && finalState.data.dataVersion).toBe(2);
  root.unmount();
});

async function showOnce(symbol: string | undefined, data: InvestingDashboardData) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(data))),
  );
  const states: DashboardState[] = [];
  const { root, Probe } = mount(symbol, states);
  await act(async () => {
    root.render(<Probe querySymbol={symbol} />);
    await Promise.resolve();
    await Promise.resolve();
  });
  root.unmount();
  return states;
}

test("a page opened again shows its last dashboard at once while it refreshes", async () => {
  setDashboardOwner("user-a");
  await showOnce(undefined, dashboardWithVersion(1));

  const pending = deferred<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => pending.promise),
  );
  const states: DashboardState[] = [];
  const { root, Probe } = mount(undefined, states);
  await act(async () => {
    root.render(<Probe querySymbol={undefined} />);
    await Promise.resolve();
  });
  expect(states.every((state) => state.status === "ready")).toBe(true);
  expect(states[0]?.status === "ready" && states[0].data.dataVersion).toBe(1);
  await act(async () => {
    pending.resolve(new Response(JSON.stringify(dashboardWithVersion(2))));
    await Promise.resolve();
    await Promise.resolve();
  });
  const finalState = states.at(-1)!;
  expect(finalState.status === "ready" && finalState.data.dataVersion).toBe(2);
  root.unmount();
});

test("a reload restores only the signed-in user's own overview", async () => {
  setDashboardOwner("user-a");
  await showOnce(undefined, dashboardWithVersion(7));

  setDashboardOwner("user-b");
  const otherUser = await showOnce(undefined, dashboardWithVersion(1));
  expect(otherUser[0]?.status).toBe("loading");

  setDashboardOwner("user-a");
  const sameUser = await showOnce(undefined, dashboardWithVersion(8));
  expect(sameUser[0]?.status === "ready" && sameUser[0].data.dataVersion).toBe(7);
});

test("signing out leaves no portfolio data in storage", async () => {
  setDashboardOwner("user-a");
  await showOnce(undefined, dashboardWithVersion(1));
  expect(Object.keys(localStorage)).not.toHaveLength(0);

  forgetDashboards();

  expect(Object.keys(localStorage)).toHaveLength(0);
  setDashboardOwner("user-a");
  expect((await showOnce(undefined, dashboardWithVersion(2)))[0]?.status).toBe("loading");
});

test("switching query identity shows loading, not stale data under a mismatched symbol", async () => {
  const aaa = deferred<Response>();
  const bbb = deferred<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) =>
      String(input).includes("BBB") ? bbb.promise : aaa.promise,
    ),
  );
  const states: DashboardState[] = [];
  const { root, Probe } = mount("AAA", states);
  await act(async () => {
    root.render(<Probe querySymbol="AAA" />);
    await Promise.resolve();
  });
  await act(async () => {
    aaa.resolve(new Response(JSON.stringify(dashboardWithVersion(1))));
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(states.at(-1)!.status).toBe("ready");
  await act(async () => {
    root.render(<Probe querySymbol="BBB" />);
    await Promise.resolve();
  });
  expect(states.at(-1)!.status).toBe("loading");
  await act(async () => {
    bbb.resolve(new Response(JSON.stringify(dashboardWithVersion(2))));
    await Promise.resolve();
    await Promise.resolve();
  });
  const finalState = states.at(-1)!;
  expect(finalState.status).toBe("ready");
  expect(finalState.status === "ready" && finalState.data.dataVersion).toBe(2);
  root.unmount();
});

test("a refresh failure after a valid response keeps the data and reports the error", async () => {
  const first = deferred<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => first.promise),
  );
  const states: DashboardState[] = [];
  const { root, Probe } = mount(undefined, states);
  await act(async () => {
    root.render(<Probe querySymbol={undefined} />);
    await Promise.resolve();
  });
  await act(async () => {
    first.resolve(new Response(JSON.stringify(dashboardWithVersion(1))));
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(states.at(-1)!.status).toBe("ready");

  const second = deferred<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => second.promise),
  );
  await act(async () => {
    window.dispatchEvent(new Event(DASHBOARD_REFRESH_EVENT));
    second.resolve(new Response("", { status: 503 }));
    await Promise.resolve();
    await Promise.resolve();
  });
  const finalState = states.at(-1)!;
  expect(finalState.status).toBe("ready");
  expect(finalState.status === "ready" && finalState.data.dataVersion).toBe(1);
  expect(finalState.status === "ready" && finalState.refreshError).toBeTruthy();
  root.unmount();
});

test("a symbol refresh failure keeps symbol data visible", async () => {
  const first = deferred<Response>();
  const second = deferred<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => (vi.mocked(fetch).mock.calls.length === 1 ? first.promise : second.promise)),
  );
  const states: DashboardState[] = [];
  const { root, Probe } = mount("AAA", states);
  await act(async () => {
    root.render(<Probe querySymbol="AAA" />);
    await Promise.resolve();
  });
  await act(async () => {
    first.resolve(new Response(JSON.stringify(dashboardWithVersion(1))));
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(states.at(-1)!.status).toBe("ready");

  await act(async () => {
    window.dispatchEvent(new Event(DASHBOARD_REFRESH_EVENT));
    second.resolve(new Response("", { status: 503 }));
    await Promise.resolve();
    await Promise.resolve();
  });
  const finalState = states.at(-1)!;
  expect(finalState.status).toBe("ready");
  expect(finalState.status === "ready" && finalState.data.dataVersion).toBe(1);
  expect(finalState.status === "ready" && finalState.refreshError).toBeTruthy();
  root.unmount();
});

test("a payload missing a required field is rejected instead of crashing the page", async () => {
  const { benchmarks: _benchmarks, ...withoutBenchmarks } = dashboardWithVersion(1);
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(withoutBenchmarks)))),
  );
  const states: DashboardState[] = [];
  const { root, Probe } = mount(undefined, states);
  await act(async () => {
    root.render(<Probe querySymbol={undefined} />);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(states.at(-1)!.status).toBe("error");
  root.unmount();
});

test("unmounting aborts the request in flight so a late resolution cannot update state", async () => {
  const pending = deferred<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => pending.promise),
  );
  const states: DashboardState[] = [];
  const { root, Probe } = mount(undefined, states);
  await act(async () => {
    root.render(<Probe querySymbol={undefined} />);
    await Promise.resolve();
  });
  const countBeforeUnmount = states.length;
  await act(async () => {
    root.unmount();
  });
  await act(async () => {
    pending.resolve(new Response(JSON.stringify(dashboardWithVersion(1))));
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(states).toHaveLength(countBeforeUnmount);
});

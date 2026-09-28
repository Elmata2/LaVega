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

/** Drains every already-queued microtask via a macrotask boundary, instead
 *  of guessing how many `await Promise.resolve()` chains a given async
 *  continuation needs. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function ControlProbe() {
  const layout = useInvestingLayout();
  return (
    <div>
      <span data-testid="status">{layout.status}</span>
      <span data-testid="modules">{layout.modules.join(",")}</span>
      <span data-testid="widgets">{layout.widgets.join(",")}</span>
      <span data-testid="save-error">{layout.saveError ?? ""}</span>
      <button
        type="button"
        data-testid="toggle-agents"
        onClick={() => layout.setModules({ agents: false })}
      >
        toggle agents
      </button>
      <button
        type="button"
        data-testid="toggle-sectors"
        onClick={() => layout.setWidgets({ sectors: false })}
      >
        toggle sectors
      </button>
    </div>
  );
}

type QueuedPut = { body: unknown; resolve: (response: Response) => void; settled: boolean };

/** Stubs `fetch` so the initial GET resolves immediately with `server`, and
 *  every PUT parks its resolver so the test decides when and how it answers.
 *  `store.saved` is the last body the fake server accepted. */
function stubQueuedPuts(server: unknown = { modules: {}, widgets: {} }) {
  const puts: QueuedPut[] = [];
  const store = { saved: server };
  vi.stubGlobal(
    "fetch",
    vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        const body: unknown = JSON.parse(String(init.body));
        return new Promise<Response>((resolve) => {
          const put: QueuedPut = {
            body,
            settled: false,
            resolve: (response) => {
              put.settled = true;
              if (response.ok) store.saved = body;
              resolve(response);
            },
          };
          puts.push(put);
        });
      }
      return Promise.resolve(new Response(JSON.stringify(server)));
    }),
  );
  const outstanding = () => puts.filter((put) => !put.settled);
  return { puts, store, outstanding };
}

const ok = () => new Response(null, { status: 204 });
const fail = () => new Response(null, { status: 500 });

function text(container: HTMLElement, id: string) {
  return container.querySelector(`[data-testid="${id}"]`)?.textContent;
}

function click(container: HTMLElement, id: string) {
  container.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)?.click();
}

async function step(fn: () => void) {
  await act(async () => {
    fn();
    await flush();
  });
}

async function mountReady() {
  const { container, root } = render();
  await step(() => root.render(<ControlProbe />));
  return { container, root };
}

test("resolves registry defaults immediately, before the fetch settles", async () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
  const { container, root } = render();
  act(() => root.render(<Probe />));
  expect(text(container, "status")).toBe("loading");
  expect(text(container, "modules")).toBe("overview,positions,net-worth,agents");
  act(() => root.unmount());
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
  await step(() => root.render(<Probe />));
  expect(text(container, "status")).toBe("ready");
  expect(text(container, "modules")).toBe("overview,positions,net-worth");
  expect(text(container, "widgets")).toBe("performance,allocation,kpis,risk,agent");
  act(() => root.unmount());
});

test("a failed or unauthorized fetch keeps the registry defaults instead of erroring", async () => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response("", { status: 401 }))));
  const { container, root } = render();
  await step(() => root.render(<Probe />));
  expect(text(container, "modules")).toBe("overview,positions,net-worth,agents");
  act(() => root.unmount());
});

test("a module toggle made before the initial fetch resolves survives that fetch", async () => {
  let resolveGet: (value: Response) => void = () => {};
  vi.stubGlobal(
    "fetch",
    vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") return Promise.resolve(ok());
      return new Promise<Response>((resolve) => {
        resolveGet = resolve;
      });
    }),
  );
  const { container, root } = render();
  act(() => root.render(<ControlProbe />));

  await step(() => click(container, "toggle-agents"));
  expect(text(container, "modules")).toBe("overview,positions,net-worth");

  await step(() => resolveGet(new Response(JSON.stringify({ modules: {}, widgets: {} }))));
  expect(text(container, "status")).toBe("ready");
  expect(text(container, "modules")).toBe("overview,positions,net-worth");
  act(() => root.unmount());
});

test("a toggle made before the initial fetch resolves is saved on top of the server's layout", async () => {
  let resolveGet: (value: Response) => void = () => {};
  const bodies: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        bodies.push(JSON.parse(String(init.body)));
        return Promise.resolve(ok());
      }
      return new Promise<Response>((resolve) => {
        resolveGet = resolve;
      });
    }),
  );
  const { container, root } = render();
  act(() => root.render(<ControlProbe />));

  await step(() => click(container, "toggle-agents"));
  await step(() =>
    resolveGet(new Response(JSON.stringify({ modules: {}, widgets: { sectors: false } }))),
  );

  expect(bodies).toEqual([{ modules: { agents: false }, widgets: { sectors: false } }]);
  expect(text(container, "widgets")).toBe("performance,allocation,kpis,risk,agent");
  act(() => root.unmount());
});

test("a failed save reverts to the last confirmed layout and surfaces an error", async () => {
  const { puts } = stubQueuedPuts();
  const { container, root } = await mountReady();

  await step(() => click(container, "toggle-agents"));
  expect(text(container, "modules")).toBe("overview,positions,net-worth");
  await step(() => puts[0]!.resolve(fail()));

  expect(text(container, "save-error")).toBe("Couldn't save — try again.");
  expect(text(container, "modules")).toBe("overview,positions,net-worth,agents");
  act(() => root.unmount());
});

test("a burst of toggles sends one PUT at a time, the second carrying every edit", async () => {
  const { puts } = stubQueuedPuts();
  const { container, root } = await mountReady();

  await step(() => click(container, "toggle-agents"));
  await step(() => click(container, "toggle-sectors"));
  expect(puts).toHaveLength(1);
  expect(puts[0]!.body).toEqual({ modules: { agents: false }, widgets: {} });

  await step(() => puts[0]!.resolve(ok()));
  expect(puts).toHaveLength(2);
  expect(puts[1]!.body).toEqual({ modules: { agents: false }, widgets: { sectors: false } });

  await step(() => puts[1]!.resolve(ok()));
  expect(puts).toHaveLength(2);
  expect(text(container, "save-error")).toBe("");
  act(() => root.unmount());
});

test("when the in-flight save fails, the queued edit is still sent and its success clears the error", async () => {
  const { puts } = stubQueuedPuts();
  const { container, root } = await mountReady();

  await step(() => click(container, "toggle-agents"));
  await step(() => click(container, "toggle-sectors"));
  await step(() => puts[0]!.resolve(fail()));
  expect(puts).toHaveLength(2);
  expect(puts[1]!.body).toEqual({ modules: { agents: false }, widgets: { sectors: false } });

  await step(() => puts[1]!.resolve(ok()));
  expect(text(container, "save-error")).toBe("");
  expect(text(container, "modules")).toBe("overview,positions,net-worth");
  expect(text(container, "widgets")).toBe("performance,allocation,kpis,risk,agent");
  act(() => root.unmount());
});

test("when the first save lands and the queued one fails, the layout reverts to the first save", async () => {
  const { puts, store } = stubQueuedPuts();
  const { container, root } = await mountReady();

  await step(() => click(container, "toggle-agents"));
  await step(() => click(container, "toggle-sectors"));
  await step(() => puts[0]!.resolve(ok()));
  await step(() => puts[1]!.resolve(fail()));

  expect(store.saved).toEqual({ modules: { agents: false }, widgets: {} });
  expect(text(container, "save-error")).toBe("Couldn't save — try again.");
  expect(text(container, "modules")).toBe("overview,positions,net-worth");
  expect(text(container, "widgets")).toBe("performance,allocation,kpis,risk,sectors,agent");
  act(() => root.unmount());
});

test("once saves settle, the layout on screen is the layout the server holds", async () => {
  const { store, outstanding } = stubQueuedPuts();
  const { container, root } = await mountReady();

  await step(() => click(container, "toggle-agents"));
  await step(() => click(container, "toggle-sectors"));
  // The newest outstanding save fails first, then the oldest succeeds.
  await step(() => outstanding().at(-1)!.resolve(fail()));
  await step(() => outstanding()[0]!.resolve(ok()));
  expect(outstanding()).toHaveLength(0);

  const saved = store.saved as {
    modules: Record<string, boolean>;
    widgets: Record<string, boolean>;
  };
  expect(text(container, "modules")!.split(",").includes("agents")).toBe(
    saved.modules.agents !== false,
  );
  expect(text(container, "widgets")!.split(",").includes("sectors")).toBe(
    saved.widgets.sectors !== false,
  );
  act(() => root.unmount());
});

test("unmounting mid-save still sends the queued edit and never updates the unmounted hook", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const { puts } = stubQueuedPuts();
  const { container, root } = await mountReady();

  await step(() => click(container, "toggle-agents"));
  await step(() => click(container, "toggle-sectors"));
  act(() => root.unmount());

  await step(() => puts[0]!.resolve(ok()));
  expect(puts).toHaveLength(2);
  await step(() => puts[1]!.resolve(fail()));
  expect(errors).not.toHaveBeenCalled();
});

const LOAD_ERROR = "Couldn't load your settings — changes aren't saved yet.";

/** GETs answer from `gets` in order (a missing entry hangs until aborted);
 *  PUT bodies are recorded and answered 204. */
function stubGets(gets: Array<() => Promise<Response>>) {
  const bodies: unknown[] = [];
  let getCount = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        bodies.push(JSON.parse(String(init.body)));
        return Promise.resolve(ok());
      }
      const answer = gets[getCount++];
      if (answer) return answer();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError")),
        );
      });
    }),
  );
  return { bodies, getCount: () => getCount };
}

test("a hanging initial fetch times out, shows a load error and saves nothing", async () => {
  vi.useFakeTimers();
  try {
    const { bodies } = stubGets([]);
    const { container, root } = render();
    act(() => root.render(<ControlProbe />));
    await act(async () => {
      click(container, "toggle-agents");
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(text(container, "save-error")).toBe("");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_000);
    });
    expect(text(container, "save-error")).toBe(LOAD_ERROR);
    expect(text(container, "modules")).toBe("overview,positions,net-worth");
    expect(bodies).toEqual([]);
    act(() => root.unmount());
  } finally {
    vi.useRealTimers();
  }
});

test("after a failed initial fetch, a toggle retries the fetch instead of saving over the server", async () => {
  let resolveRetry: (value: Response) => void = () => {};
  const { bodies, getCount } = stubGets([
    () => Promise.resolve(new Response("", { status: 500 })),
    () =>
      new Promise<Response>((resolve) => {
        resolveRetry = resolve;
      }),
  ]);
  const { container, root } = await mountReady();
  expect(text(container, "save-error")).toBe(LOAD_ERROR);

  await step(() => click(container, "toggle-agents"));
  expect(getCount()).toBe(2);
  expect(bodies).toEqual([]);
  expect(text(container, "modules")).toBe("overview,positions,net-worth");

  await step(() =>
    resolveRetry(new Response(JSON.stringify({ modules: {}, widgets: { sectors: false } }))),
  );
  expect(bodies).toEqual([{ modules: { agents: false }, widgets: { sectors: false } }]);
  expect(text(container, "save-error")).toBe("");
  expect(text(container, "widgets")).toBe("performance,allocation,kpis,risk,agent");
  act(() => root.unmount());
});

test("an empty 200 is a real load, so a toggle saves straight away", async () => {
  const { bodies, getCount } = stubGets([
    () => Promise.resolve(new Response(JSON.stringify({ modules: {}, widgets: {} }))),
  ]);
  const { container, root } = await mountReady();
  await step(() => click(container, "toggle-agents"));
  expect(getCount()).toBe(1);
  expect(bodies).toEqual([{ modules: { agents: false }, widgets: {} }]);
  expect(text(container, "save-error")).toBe("");
  act(() => root.unmount());
});

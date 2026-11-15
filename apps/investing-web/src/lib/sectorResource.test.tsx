// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { useSectors, type SectorReadData, type SectorState } from "./sectorResource";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(() => {
  vi.restoreAllMocks();
});

const data: SectorReadData = {
  sectors: [{ sector: "Technology", weight: 1 }],
  sectorCoverage: { provider: 1, inferred: 0, correction: 0, unknown: 0 },
  revision: 3,
};

type Sample = { state: SectorState; refresh: () => void };

function mount(samples: Sample[]) {
  function Probe({ enabled, reloadKey }: { enabled: boolean; reloadKey: string }) {
    const { state, refresh } = useSectors(enabled, reloadKey);
    samples.push({ state, refresh });
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  return { root, Probe };
}

test("reads the sector endpoint and resolves the read", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(data), { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  const samples: Sample[] = [];
  const { root, Probe } = mount(samples);
  await act(async () => root.render(<Probe enabled={true} reloadKey="1" />));
  expect(fetcher).toHaveBeenCalledWith("/api/investing/sectors", {
    signal: expect.any(AbortSignal),
  });
  expect(samples.at(-1)?.state).toEqual({ status: "ready", data });
  root.unmount();
});

test("disabled never reads; enabling starts one read", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(data), { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  const samples: Sample[] = [];
  const { root, Probe } = mount(samples);
  await act(async () => root.render(<Probe enabled={false} reloadKey="1" />));
  expect(fetcher).not.toHaveBeenCalled();
  expect(samples.at(-1)?.state).toEqual({ status: "loading" });
  await act(async () => root.render(<Probe enabled={true} reloadKey="1" />));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(samples.at(-1)?.state).toEqual({ status: "ready", data });
  root.unmount();
});

test("a new dashboard version reads the sectors again", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(data), { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  const samples: Sample[] = [];
  const { root, Probe } = mount(samples);
  await act(async () => root.render(<Probe enabled={true} reloadKey="1" />));
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => root.render(<Probe enabled={true} reloadKey="2" />));
  expect(fetcher).toHaveBeenCalledTimes(2);
  root.unmount();
});

test("refresh reads the sectors again with the same identity", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(data), { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  const samples: Sample[] = [];
  const { root, Probe } = mount(samples);
  await act(async () => root.render(<Probe enabled={true} reloadKey="1" />));
  const settled = samples.at(-1)!.refresh;
  await act(async () => {
    samples.at(-1)!.refresh();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(samples.at(-1)!.refresh).toBe(settled);
  expect(fetcher).toHaveBeenCalledTimes(2);
  root.unmount();
});

test("a payload missing the coverage breakdown reads as an invalid format", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ sectors: [], revision: 0 }), { status: 200 })),
  );
  const samples: Sample[] = [];
  const { root, Probe } = mount(samples);
  await act(async () => root.render(<Probe enabled={true} reloadKey="1" />));
  expect(samples.at(-1)?.state).toEqual({
    status: "error",
    message: "Sectors have an invalid format.",
  });
  root.unmount();
});

test("a failed read reports the status", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("boom", { status: 503 })),
  );
  const samples: Sample[] = [];
  const { root, Probe } = mount(samples);
  await act(async () => root.render(<Probe enabled={true} reloadKey="1" />));
  expect(samples.at(-1)?.state).toEqual({ status: "error", message: "Failed to load sectors: 503" });
  root.unmount();
});

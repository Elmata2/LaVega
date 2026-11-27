import { describe, expect, it, vi } from "vitest";
import { runTravelTermsPoll } from "./travelTermsPoll.js";

describe("runTravelTermsPoll", () => {
  it("stops polling and skips onTerms when aborted mid-flight", async () => {
    const controller = new AbortController();
    let resolveFetch!: (v: { terms: Array<{ provider: string; fxFeePct?: number }>; pending: string[] }) => void;
    const fetchTerms = vi.fn(
      () =>
        new Promise<{ terms: Array<{ provider: string; fxFeePct?: number }>; pending: string[] }>(
          (resolve) => {
            resolveFetch = resolve;
          },
        ),
    );
    const onTerms = vi.fn(async () => {});
    const onPending = vi.fn();
    const onGiveUp = vi.fn();

    const p = runTravelTermsPoll({
      signal: controller.signal,
      isStale: () => false,
      pollMs: 1,
      ceilingMs: 5000,
      fetchTerms,
      onTerms,
      onPending,
      onGiveUp,
    });

    await vi.waitFor(() => expect(fetchTerms).toHaveBeenCalledTimes(1));
    controller.abort();
    resolveFetch({ terms: [{ provider: "ING", fxFeePct: 1.4 }], pending: [] });
    await p;

    expect(onTerms).not.toHaveBeenCalled();
    expect(onPending).not.toHaveBeenCalled();
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it("stops immediately when a newer generation supersedes the poll", async () => {
    const controller = new AbortController();
    let generation = 1;
    const fetchTerms = vi.fn(async () => {
      generation = 2;
      return { terms: [{ provider: "Rabobank", fxFeePct: 1.4 }], pending: ["Wise"] };
    });
    const onTerms = vi.fn(async () => {});
    const onPending = vi.fn();
    const onGiveUp = vi.fn();

    await runTravelTermsPoll({
      signal: controller.signal,
      isStale: () => generation !== 1,
      pollMs: 1,
      ceilingMs: 5000,
      fetchTerms,
      onTerms,
      onPending,
      onGiveUp,
    });

    expect(fetchTerms).toHaveBeenCalledTimes(1);
    expect(onTerms).not.toHaveBeenCalled();
    expect(onPending).not.toHaveBeenCalled();
    expect(onGiveUp).not.toHaveBeenCalled();
  });

  it("transitions to give-up when ceiling expires without draining pending", async () => {
    const controller = new AbortController();
    let clock = 0;
    const fetchTerms = vi.fn(async () => {
      clock += 60;
      return { terms: [], pending: ["Bunq"] };
    });
    const onTerms = vi.fn(async () => {});
    const onPending = vi.fn();
    const onGiveUp = vi.fn();

    await runTravelTermsPoll({
      signal: controller.signal,
      isStale: () => false,
      pollMs: 1,
      ceilingMs: 50,
      now: () => clock,
      fetchTerms,
      onTerms,
      onPending,
      onGiveUp,
    });

    expect(onPending).toHaveBeenCalledWith(["Bunq"]);
    expect(onGiveUp).toHaveBeenCalledTimes(1);
  });
});

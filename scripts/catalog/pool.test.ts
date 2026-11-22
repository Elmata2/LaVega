import { describe, expect, it } from "vitest";
import { runPool, stopReason } from "./pool.js";

const tick = (ms = 1) => new Promise<void>((r) => setTimeout(r, ms));

describe("runPool", () => {
  it("never more than limit run at once", async () => {
    let running = 0;
    let peak = 0;
    await runPool(
      Array.from({ length: 12 }, (_, i) => i),
      3,
      async () => {
        running++;
        peak = Math.max(peak, running);
        await tick(2);
        running--;
      },
    );
    expect(peak).toBe(3);
  });

  it("items start in order", async () => {
    const started: number[] = [];
    await runPool([0, 1, 2, 3, 4, 5], 3, async (item, index) => {
      expect(index).toBe(item);
      started.push(item);
      await tick(item % 2 ? 1 : 4);
    });
    expect(started).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("all items run", async () => {
    const seen = new Set<number>();
    await runPool([1, 2, 3, 4, 5, 6, 7], 4, async (item) => {
      await tick();
      seen.add(item);
    });
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("a throwing worker stops new starts and rejects with its error", async () => {
    const started: number[] = [];
    const settled: number[] = [];
    const boom = new Error("boom");
    await expect(
      runPool([0, 1, 2, 3, 4, 5, 6, 7], 2, async (item) => {
        started.push(item);
        await tick(item === 1 ? 2 : 6);
        if (item === 1) throw boom;
        settled.push(item);
      }),
    ).rejects.toBe(boom);
    expect(started).toEqual([0, 1]);
    expect(settled).toEqual([0]);
  });

  it("limit 1 is sequential", async () => {
    const log: string[] = [];
    await runPool([0, 1, 2], 1, async (item) => {
      log.push(`start ${item}`);
      await tick(2);
      log.push(`end ${item}`);
    });
    expect(log).toEqual(["start 0", "end 0", "start 1", "end 1", "start 2", "end 2"]);
  });

  it("empty list resolves", async () => {
    await expect(runPool([], 4, async () => {})).resolves.toBeUndefined();
  });
});

describe("runPool shouldStart", () => {
  it("shouldStart false stops new starts and resolves", async () => {
    const started: number[] = [];
    await runPool(
      [0, 1, 2, 3, 4, 5, 6, 7],
      2,
      async (item) => {
        started.push(item);
        await tick(2);
      },
      () => started.length < 3,
    );
    expect(started).toEqual([0, 1, 2]);
  });

  it("items already running finish", async () => {
    const finished: number[] = [];
    let stop = false;
    await runPool(
      [0, 1, 2, 3],
      2,
      async (item) => {
        if (item === 0) {
          await tick(1);
          stop = true;
        }
        await tick(5);
        finished.push(item);
      },
      () => !stop,
    );
    expect(finished.sort()).toEqual([0, 1]);
  });
});

describe("stopReason", () => {
  it("is null below both limits", () => {
    expect(stopReason(1, 5, 10, 150)).toBeNull();
  });
  it("names the cost ceiling at or above it", () => {
    expect(stopReason(5, 5, 10, 150)).toBe("cost ceiling");
  });
  it("names the time limit at or past it", () => {
    expect(stopReason(1, 5, 150, 150)).toBe("time limit");
  });
  it("a deadline of 0 and no ceiling disable their checks", () => {
    expect(stopReason(99, null, 9999, 0)).toBeNull();
  });
  it("the cost ceiling wins when both are reached", () => {
    expect(stopReason(6, 5, 200, 150)).toBe("cost ceiling");
  });
});

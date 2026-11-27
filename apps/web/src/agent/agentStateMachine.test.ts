import { describe, expect, it, vi } from "vitest";
import { createFeedStore } from "./feedStore.js";
import { createMirrorSync, MirrorRefused } from "./mirror.js";
import type { AgentApi } from "../api.js";
import type { AgentMirror } from "@lavega/core";

describe("feedStore and mirror state machine guards", () => {
  it("clears inflight when listFeed rejects so subsequent calls recover", async () => {
    const listFeed = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce({ kind: "ok", events: [], next: null });
    const store = createFeedStore({ listFeed } as unknown as AgentApi);

    await expect(store.firstPage()).rejects.toThrow("network");
    const res = await store.firstPage();
    expect(res).toEqual({ kind: "ok", events: [], next: null });
    expect(listFeed).toHaveBeenCalledTimes(2);
  });

  it("ignores stale in-flight MirrorRefused after cancel()", async () => {
    let rejectPut!: (err: unknown) => void;
    const onRefused = vi.fn();
    const sync = createMirrorSync(
      {
        put: () =>
          new Promise<void>((_res, rej) => {
            rejectPut = rej;
          }),
      },
      () => true,
      { debounceMs: 0, onRefused },
    );
    const mirror: AgentMirror = { rules: [], dueDates: [], cardOffer: null };
    sync.push(mirror);
    await new Promise((r) => setTimeout(r, 10));
    sync.cancel();
    rejectPut(new MirrorRefused());
    await new Promise((r) => setTimeout(r, 10));
    expect(onRefused).not.toHaveBeenCalled();
  });
});

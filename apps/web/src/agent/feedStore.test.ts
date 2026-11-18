import { expect, test, vi } from "vitest";
import type { AgentApi, AgentFeedLoad } from "../api.js";
import { createFeedStore } from "./feedStore.js";

const ok: AgentFeedLoad = { kind: "ok", events: [], next: null };
const apiWith = (listFeed: AgentApi["listFeed"]) => ({ listFeed }) as unknown as AgentApi;

test("concurrent readers share one request for the first page of the feed channel", async () => {
  const listFeed = vi.fn(async () => ok);
  const store = createFeedStore(apiWith(listFeed));
  await Promise.all([store.firstPage(), store.firstPage()]);
  expect(listFeed).toHaveBeenCalledTimes(1);
  expect(listFeed).toHaveBeenCalledWith({ channel: "feed", limit: 20 });
});

test("a fresh result is reused; a forced read or an invalidate fetches again", async () => {
  const listFeed = vi.fn(async () => ok);
  const store = createFeedStore(apiWith(listFeed));
  await store.firstPage();
  await store.firstPage();
  expect(listFeed).toHaveBeenCalledTimes(1);
  await store.firstPage({ force: true });
  expect(listFeed).toHaveBeenCalledTimes(2);
  store.invalidate();
  await store.firstPage();
  expect(listFeed).toHaveBeenCalledTimes(3);
});

test("a failure is never cached", async () => {
  const listFeed = vi
    .fn<AgentApi["listFeed"]>()
    .mockResolvedValueOnce({ kind: "error" })
    .mockResolvedValueOnce(ok);
  const store = createFeedStore(apiWith(listFeed));
  expect((await store.firstPage()).kind).toBe("error");
  expect((await store.firstPage()).kind).toBe("ok");
  expect(listFeed).toHaveBeenCalledTimes(2);
});

test("a result goes stale after the freshness window", async () => {
  vi.useFakeTimers();
  try {
    const listFeed = vi.fn(async () => ok);
    const store = createFeedStore(apiWith(listFeed), 1000);
    await store.firstPage();
    vi.advanceTimersByTime(1500);
    await store.firstPage();
    expect(listFeed).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

test("invalidate during a request: the old answer is not kept and the next read refetches", async () => {
  let release!: (r: AgentFeedLoad) => void;
  const listFeed = vi
    .fn<AgentApi["listFeed"]>()
    .mockImplementationOnce(() => new Promise<AgentFeedLoad>((res) => (release = res)))
    .mockResolvedValue(ok);
  const store = createFeedStore(apiWith(listFeed));
  const first = store.firstPage();
  store.invalidate();
  release({ kind: "ok", events: [], next: null });
  await first;
  await store.firstPage();
  expect(listFeed).toHaveBeenCalledTimes(2);
});

test("invalidate tells subscribers, and a stopped subscriber hears nothing", async () => {
  const store = createFeedStore(apiWith(vi.fn(async () => ok)));
  const heard = vi.fn();
  const stop = store.subscribe(heard);
  store.invalidate();
  expect(heard).toHaveBeenCalledTimes(1);
  stop();
  store.invalidate();
  expect(heard).toHaveBeenCalledTimes(1);
});

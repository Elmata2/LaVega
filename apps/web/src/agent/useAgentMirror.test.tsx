// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AgentMirror } from "@lavega/core";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useAgentMirror } from "./useAgentMirror.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Props = Parameters<typeof useAgentMirror>[0];
let root: Root;
let host: HTMLDivElement;
let last: ReturnType<typeof useAgentMirror>;

function Probe(props: Props) {
  const result = useAgentMirror(props);
  useEffect(() => {
    last = result;
  });
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

const base = (over: Partial<Props>): Props => ({
  accountId: "u1",
  ready: true,
  rules: [{ id: "r1", match: "ah", category: "Boodschappen" }],
  flows: [],
  plan: null,
  locale: "nl",
  debounceMs: 100,
  ...over,
});
const render = (props: Props) => act(async () => root.render(<Probe {...props} />));
const settle = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

test("an enabled user's server copy is refreshed on load, with no edit", async () => {
  const put = vi.fn(async (_m: AgentMirror) => undefined);
  await render(base({ api: { put }, lookup: async () => true }));
  await settle(300);
  expect(put).toHaveBeenCalledTimes(1);
  expect(put.mock.calls[0]?.[0].rules).toHaveLength(1);
});

test("a user who has not opted in sends nothing", async () => {
  const put = vi.fn(async () => undefined);
  await render(base({ api: { put }, lookup: async () => false }));
  await settle(500);
  expect(put).not.toHaveBeenCalled();
});

test("signing out drops the state and a queued push; the next account starts off", async () => {
  const put = vi.fn(async () => undefined);
  const lookup = vi.fn(async (): Promise<boolean> => true);
  await render(base({ api: { put }, lookup }));
  await settle(300);
  expect(put).toHaveBeenCalledTimes(1);

  // A new edit is queued, then the user signs out before it fires.
  await render(base({ api: { put }, lookup, rules: [] }));
  await render(base({ api: { put }, lookup, accountId: null }));
  expect(last.enabled).toBe(false);
  await settle(500);
  expect(put).toHaveBeenCalledTimes(1);

  // Another account signs in on the same page: off until its own lookup says on.
  lookup.mockResolvedValueOnce(false);
  await render(base({ api: { put }, lookup, accountId: "u2" }));
  await settle(500);
  expect(last.enabled).toBe(false);
  expect(put).toHaveBeenCalledTimes(1);
});

test("a 409 from the server turns the local state off", async () => {
  const { MirrorRefused } = await import("./mirror.js");
  const put = vi.fn(async () => {
    throw new MirrorRefused();
  });
  await render(base({ api: { put }, lookup: async () => true }));
  await settle(300);
  expect(put).toHaveBeenCalledTimes(1);
  expect(last.enabled).toBe(false);
});

// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import useIdleLock from "./useIdleLock";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

function mount(enabled: boolean, lockNow: () => void, idleMs: number) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  function Host() {
    useIdleLock(enabled, lockNow, idleMs);
    return null;
  }
  act(() => {
    root?.render(<Host />);
  });
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
});

test("locks after idleMs of silence", () => {
  const lock = vi.fn();
  mount(true, lock, 1000);
  act(() => vi.advanceTimersByTime(999));
  expect(lock).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(lock).toHaveBeenCalledTimes(1);
});

test("activity resets the idle timer", () => {
  const lock = vi.fn();
  mount(true, lock, 1000);
  act(() => vi.advanceTimersByTime(700));
  act(() => window.dispatchEvent(new KeyboardEvent("keydown")));
  act(() => vi.advanceTimersByTime(700));
  expect(lock).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(300));
  expect(lock).toHaveBeenCalledTimes(1);
});

test("disabled never locks", () => {
  const lock = vi.fn();
  mount(false, lock, 1000);
  act(() => vi.advanceTimersByTime(10_000));
  expect(lock).not.toHaveBeenCalled();
});

test("hidden past the threshold locks on the visibilitychange back to visible", () => {
  const lock = vi.fn();
  mount(true, lock, 1000);
  setVisibility("hidden");
  act(() => vi.advanceTimersByTime(1500));
  expect(lock).not.toHaveBeenCalled();
  setVisibility("visible");
  expect(lock).toHaveBeenCalledTimes(1);
});

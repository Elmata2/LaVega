// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { useMediaQuery } from "./useMediaQuery";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
const original = window.matchMedia;

function Probe({ fallback }: { fallback?: boolean }) {
  const on = useMediaQuery("(min-width: 1024px)", fallback);
  return <p>{on ? "wide" : "narrow"}</p>;
}
function mount(node: React.ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
  window.matchMedia = original;
});

test("reads the initial match and follows change events", () => {
  let listener: (() => void) | null = null;
  const mql = {
    matches: false,
    addEventListener: (_: string, fn: () => void) => (listener = fn),
    removeEventListener: () => (listener = null),
  };
  window.matchMedia = (() => mql) as unknown as typeof window.matchMedia;
  mount(<Probe />);
  expect(host!.textContent).toBe("narrow");
  mql.matches = true;
  act(() => listener!());
  expect(host!.textContent).toBe("wide");
  mql.matches = false;
  act(() => listener!());
  expect(host!.textContent).toBe("narrow");
});

test("removes its listener on unmount", () => {
  let listener: (() => void) | null = null;
  window.matchMedia = (() => ({
    matches: true,
    addEventListener: (_: string, fn: () => void) => (listener = fn),
    removeEventListener: () => (listener = null),
  })) as unknown as typeof window.matchMedia;
  mount(<Probe />);
  expect(listener).not.toBeNull();
  act(() => root!.unmount());
  root = null;
  expect(listener).toBeNull();
});

test("survives a missing matchMedia and uses the fallback", () => {
  (window as unknown as { matchMedia?: unknown }).matchMedia = undefined;
  mount(<Probe />);
  expect(host!.textContent).toBe("wide");
  act(() => root!.unmount());
  host!.remove();
  mount(<Probe fallback={false} />);
  expect(host!.textContent).toBe("narrow");
});

// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import Root from "./Root";
import { useAuthState } from "./authClient.js";
import { takePendingEbParams } from "./appRoutes.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* Neither component has anything to say about the session gate; stubbed the
 * same way Landing.signin.test.tsx stubs CardSpiral. */
vi.mock("./App", () => ({ default: () => <div data-testid="app-shell" /> }));
vi.mock("./views/Landing", () => ({
  default: ({ onEnter }: { onEnter: () => void }) => (
    <div data-testid="landing">
      <button type="button" onClick={onEnter}>
        enter
      </button>
    </div>
  ),
}));

vi.mock("./authClient.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./authClient.js")>();
  return { ...actual, useAuthState: vi.fn() };
});

let container: HTMLElement | null = null;
let root: ReactRoot | null = null;

beforeEach(() => {
  vi.mocked(useAuthState).mockReset();
  window.history.replaceState({}, "", "/");
  takePendingEbParams(); // drain any leftover handoff from a previous test
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Root />));
  return container;
}

test("loading on /app renders neither the landing page nor the vault", () => {
  window.history.replaceState({}, "", "/app");
  vi.mocked(useAuthState).mockReturnValue({ state: { kind: "loading" }, refresh: vi.fn() });
  const el = render();
  expect(el.querySelector('[data-testid="app-shell"]')).toBeNull();
  expect(el.querySelector('[data-testid="landing"]')).toBeNull();
});

test("signed-in on /app mounts the vault", () => {
  window.history.replaceState({}, "", "/app");
  vi.mocked(useAuthState).mockReturnValue({
    state: { kind: "signed-in", email: "x@y.nl" },
    refresh: vi.fn(),
  });
  const el = render();
  expect(el.querySelector('[data-testid="app-shell"]')).not.toBeNull();
  expect(el.querySelector('[data-testid="landing"]')).toBeNull();
});

test("unconfigured (self-hosted, no accounts at all) on /app still mounts the vault", () => {
  window.history.replaceState({}, "", "/app");
  vi.mocked(useAuthState).mockReturnValue({ state: { kind: "unconfigured" }, refresh: vi.fn() });
  const el = render();
  expect(el.querySelector('[data-testid="app-shell"]')).not.toBeNull();
  expect(el.querySelector('[data-testid="landing"]')).toBeNull();
});

test("signed-out on /app renders the landing page instead of the vault", () => {
  window.history.replaceState({}, "", "/app");
  vi.mocked(useAuthState).mockReturnValue({ state: { kind: "signed-out" }, refresh: vi.fn() });
  const el = render();
  expect(el.querySelector('[data-testid="app-shell"]')).toBeNull();
  expect(el.querySelector('[data-testid="landing"]')).not.toBeNull();
});

test("legacy #app entry path with no session renders the landing page, not the vault", () => {
  window.history.replaceState({}, "", "/#app");
  vi.mocked(useAuthState).mockReturnValue({ state: { kind: "signed-out" }, refresh: vi.fn() });
  const el = render();
  expect(el.querySelector('[data-testid="app-shell"]')).toBeNull();
  expect(el.querySelector('[data-testid="landing"]')).not.toBeNull();
});

test("legacy #app entry path with a session mounts the vault", () => {
  window.history.replaceState({}, "", "/#app");
  vi.mocked(useAuthState).mockReturnValue({
    state: { kind: "signed-in", email: "x@y.nl" },
    refresh: vi.fn(),
  });
  const el = render();
  expect(el.querySelector('[data-testid="app-shell"]')).not.toBeNull();
});

test("?eb= params captured off a gated, signed-out /app load are not destroyed — still there for App once signed in", () => {
  window.history.replaceState({}, "", "/app?eb=abc123");
  vi.mocked(useAuthState).mockReturnValue({ state: { kind: "signed-out" }, refresh: vi.fn() });
  render();
  expect(window.location.search).toBe(""); // normalizeAppLocation still strips it off the URL
  expect(takePendingEbParams()).toEqual({ session: "abc123", error: null });
});

// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import Root from "./Root";
import { rememberTheme } from "./lib/theme";
import { useAuthState } from "./authClient.js";
import { resetAuthLinkFailure, takePendingEbParams } from "./appRoutes.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* Neither component has anything to say about the session gate, so both are stubbed. */
vi.mock("./App", () => ({ default: () => <div data-testid="app-shell" /> }));
vi.mock("./views/Landing", () => ({
  default: ({ onEnter, linkError }: { onEnter: () => void; linkError?: boolean }) => (
    <div data-testid="landing" data-link-error={linkError ? "yes" : "no"}>
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
  resetAuthLinkFailure();
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
    state: { kind: "signed-in", id: "u1", email: "x@y.nl" },
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
    state: { kind: "signed-in", id: "u1", email: "x@y.nl" },
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

test("a failed verification link on a signed-out /app load tells the landing page", () => {
  window.history.replaceState({}, "", "/app?error=invalid_token");
  vi.mocked(useAuthState).mockReturnValue({ state: { kind: "signed-out" }, refresh: vi.fn() });
  const el = render();
  expect(window.location.search).toBe("");
  expect(el.querySelector('[data-testid="landing"]')?.getAttribute("data-link-error")).toBe("yes");
});

test("landing forces midnight while mounted and restores the stored theme on unmount", () => {
  const html = document.documentElement;
  window.localStorage.setItem("lavega.theme", "mono");
  html.dataset.theme = "mono";
  window.history.replaceState({}, "", "/");
  vi.mocked(useAuthState).mockReturnValue({ state: { kind: "signed-out" }, refresh: vi.fn() });
  render();
  expect(html.hasAttribute("data-theme")).toBe(false);
  act(() => root!.unmount());
  root = null;
  expect(html.dataset.theme).toBe("mono");
  window.localStorage.clear();
  delete html.dataset.theme;
});

test("a legacy #app entry that normalises into /app gets the stored theme (init skipped it on /)", () => {
  window.localStorage.setItem("lavega.theme", "mono");
  delete document.documentElement.dataset.theme;
  window.history.replaceState({}, "", "/#app");
  vi.mocked(useAuthState).mockReturnValue({
    state: { kind: "signed-in", id: "u1", email: "x@y.nl" },
    refresh: vi.fn(),
  });
  render();
  expect(document.documentElement.dataset.theme).toBe("mono");
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

test("signed-out /app with mono already applied by the init script is corrected to midnight", () => {
  window.localStorage.setItem("lavega.theme", "mono");
  document.documentElement.dataset.theme = "mono";
  window.history.replaceState({}, "", "/app");
  vi.mocked(useAuthState).mockReturnValue({ state: { kind: "signed-out" }, refresh: vi.fn() });
  render();
  expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  window.localStorage.clear();
});

test("blocked storage: the in-memory choice survives leaving and re-entering the app", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  rememberTheme("mono");
  window.history.replaceState({}, "", "/");
  vi.mocked(useAuthState).mockReturnValue({
    state: { kind: "signed-in", id: "u1", email: "x@y.nl" },
    refresh: vi.fn(),
  });
  render();
  expect(document.documentElement.hasAttribute("data-theme")).toBe(false); // landing
  act(() => {
    window.history.pushState({}, "", "/app");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(document.documentElement.dataset.theme).toBe("mono");
  rememberTheme(null);
  vi.restoreAllMocks();
  delete document.documentElement.dataset.theme;
});

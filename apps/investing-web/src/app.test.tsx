// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.restoreAllMocks());

test("overview shell fetches and displays investing server health", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, service: "investing-server" }))));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<MemoryRouter><App /></MemoryRouter>);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.textContent).toContain("investing-server: healthy");
  expect(fetch).toHaveBeenCalledWith("/health");
  root.unmount();
});

test("positions route renders its empty state", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, service: "investing-server" }))));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<MemoryRouter initialEntries={["/positions"]}><App /></MemoryRouter>);
  });

  expect(container.textContent).toContain("No positions loaded");
  expect(container.querySelector('nav[aria-label="Main navigation"]')).not.toBeNull();
  root.unmount();
});

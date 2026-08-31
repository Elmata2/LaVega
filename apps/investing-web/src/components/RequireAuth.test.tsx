// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { RequireAuth } from "./RequireAuth";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => { vi.restoreAllMocks(); });

async function render(status: number, body: unknown, initialEntries = ["/"]) {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status }))));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route element={<RequireAuth />}>
          <Route path="/" element={<p>Beveiligde inhoud</p>} />
        </Route>
        <Route path="/sign-in" element={<p>Inloggen</p>} />
      </Routes>
    </MemoryRouter>);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  });
  const result = container.textContent ?? "";
  root.unmount();
  return result;
}

test("renders protected content when auth is not configured", async () => {
  expect(await render(503, { problems: ["Authentication is not configured"] })).toContain("Beveiligde inhoud");
});

test("renders protected content when a session exists", async () => {
  expect(await render(200, { session: { id: "s1" }, user: { id: "u1", email: "jort@example.com" } })).toContain("Beveiligde inhoud");
});

test("redirects to sign-in when auth is configured but no session exists", async () => {
  expect(await render(200, null)).toContain("Inloggen");
});

// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { AccountSection } from "./Profile";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

async function render(signOutStatus: number) {
  const fetchMock = vi.fn((url: string) =>
    Promise.resolve(
      String(url).includes("/sign-out")
        ? new Response(null, { status: signOutStatus })
        : new Response(JSON.stringify({ user: { id: "u1", email: "o@example.com" } })),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={["/profile"]}>
        <Routes>
          <Route path="/profile" element={<AccountSection />} />
          <Route path="/sign-in" element={<p>Sign in page</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  const button = [...container.querySelectorAll("button")].find(
    (b) => b.textContent === "Sign out",
  ) as HTMLButtonElement;
  return { button, el: container };
}

test("a successful sign-out goes to the sign-in page", async () => {
  const { button, el } = await render(200);
  await act(async () => button.click());
  expect(el.textContent).toContain("Sign in page");
});

test("a failing sign-out shows an error, stays on the page and re-enables the button", async () => {
  const { button, el } = await render(500);
  await act(async () => button.click());
  expect(el.textContent).not.toContain("Sign in page");
  expect(el.querySelector('[role="alert"]')?.textContent).toBe(
    "Signing out didn't work. Please try again later.",
  );
  expect(button.disabled).toBe(false);
});

// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { AuthForm } from "./AuthForm";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => { vi.restoreAllMocks(); });

function type(input: Element, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

test("defaults to sign-up and posts name, email and password", async () => {
  const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ user: { id: "u1" } }), { status: 200 })));
  vi.stubGlobal("fetch", fetchMock);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter><AuthForm /></MemoryRouter>); });

  act(() => {
    type(container.querySelector('input[name="name"]')!, "Jort");
    type(container.querySelector('input[name="email"]')!, "jort@example.com");
    type(container.querySelector('input[name="password"]')!, "correct horse battery staple");
  });
  await act(async () => {
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve(); await Promise.resolve();
  });

  expect(fetchMock).toHaveBeenCalledWith("/api/auth/sign-up/email", expect.objectContaining({
    body: JSON.stringify({ name: "Jort", email: "jort@example.com", password: "correct horse battery staple" }),
  }));
  root.unmount();
});

test("switches to sign-in and posts only email and password", async () => {
  const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ user: { id: "u1" } }), { status: 200 })));
  vi.stubGlobal("fetch", fetchMock);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter><AuthForm /></MemoryRouter>); });

  await act(async () => { (container.querySelector('button[data-action="switch-mode"]') as HTMLButtonElement).click(); });
  expect(container.querySelector('input[name="name"]')).toBeNull();

  act(() => {
    type(container.querySelector('input[name="email"]')!, "jort@example.com");
    type(container.querySelector('input[name="password"]')!, "correct horse battery staple");
  });
  await act(async () => {
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve(); await Promise.resolve();
  });

  expect(fetchMock).toHaveBeenCalledWith("/api/auth/sign-in/email", expect.objectContaining({
    body: JSON.stringify({ email: "jort@example.com", password: "correct horse battery staple" }),
  }));
  root.unmount();
});

test("shows the server's error message on failure", async () => {
  vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ message: "E-mailadres al in gebruik" }), { status: 422 }))));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter><AuthForm /></MemoryRouter>); });

  act(() => {
    type(container.querySelector('input[name="name"]')!, "Jort");
    type(container.querySelector('input[name="email"]')!, "jort@example.com");
    type(container.querySelector('input[name="password"]')!, "x");
  });
  await act(async () => {
    container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve(); await Promise.resolve();
  });

  expect(container.textContent).toContain("E-mailadres al in gebruik");
  root.unmount();
});

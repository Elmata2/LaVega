// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import {
  AuthForm,
  CheckEmailPage,
  EmailConfirmedPage,
  ForgotPasswordPage,
  ResetPasswordPage,
} from "./AuthForm";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

async function render(initialEntry = "/sign-up") {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/sign-up" element={<AuthForm mode="sign-up" />} />
          <Route path="/sign-in" element={<AuthForm mode="sign-in" />} />
          <Route path="/check-email" element={<CheckEmailPage />} />
          <Route path="/email-confirmed" element={<EmailConfirmedPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/" element={<p>Dashboard</p>} />
        </Routes>
      </MemoryRouter>,
    );
  });
  return { container, root };
}

function type(container: Element, name: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function submit(container: Element) {
  await act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

test("signup uses shadcn form and opens check-email screen after successful unverified signup", async () => {
  const fetchMock = vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify({ token: null }), { status: 200 })),
  );
  vi.stubGlobal("fetch", fetchMock);
  const { container, root } = await render();
  type(container, "name", "Jort");
  type(container, "email", "jort@example.com");
  type(container, "password", "correct horse battery staple");
  type(container, "confirm-password", "correct horse battery staple");
  await submit(container);
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/auth/sign-up/email",
    expect.objectContaining({
      body: expect.stringContaining('"email":"jort@example.com"'),
    }),
  );
  expect(container.textContent).toContain("Check your email");
  expect(container.textContent).toContain("If this address is new to LaVega");
  expect(container.textContent).toContain("jort@example.com");
  await act(async () => {
    root.unmount();
  });
});

test("signup rejects mismatched passwords before request", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const { container, root } = await render();
  type(container, "name", "Jort");
  type(container, "email", "jort@example.com");
  type(container, "password", "correct horse battery staple");
  type(container, "confirm-password", "other password");
  await submit(container);
  expect(container.textContent).toContain("Passwords do not match.");
  expect(fetchMock).not.toHaveBeenCalled();
  await act(async () => {
    root.unmount();
  });
});

test("signup links to signin and signin posts credentials", async () => {
  const fetchMock = vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify({ user: { id: "u1" } }), { status: 200 })),
  );
  vi.stubGlobal("fetch", fetchMock);
  const { container, root } = await render();
  await act(async () => {
    container.querySelector<HTMLAnchorElement>('a[href="/sign-in"]')!.click();
  });
  expect(container.querySelector('input[name="name"]')).toBeNull();
  type(container, "email", "jort@example.com");
  type(container, "password", "correct horse battery staple");
  await submit(container);
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/auth/sign-in/email",
    expect.objectContaining({
      body: JSON.stringify({ email: "jort@example.com", password: "correct horse battery staple" }),
    }),
  );
  expect(container.textContent).toContain("Dashboard");
  await act(async () => {
    root.unmount();
  });
});

test("check-email requests another link and handles an expired callback", async () => {
  const fetchMock = vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify({ status: true }), { status: 200 })),
  );
  vi.stubGlobal("fetch", fetchMock);
  const { container, root } = await render("/check-email");
  await act(async () => {
    type(container, "email", "jort@example.com");
  });
  await submit(container);
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/auth/send-verification-email",
    expect.objectContaining({
      body: expect.stringContaining('"email":"jort@example.com"'),
    }),
  );
  expect(container.textContent).toContain("new email is on its way");
  await act(async () => {
    root.unmount();
  });

  const failed = await render("/email-confirmed?error=TOKEN_EXPIRED");
  expect(failed.container.textContent).toContain("Confirmation link did not work");
  expect(failed.container.querySelector('a[href="/check-email"]')).not.toBeNull();
  await act(async () => {
    failed.root.unmount();
  });
});

test("forgot password sends generic recovery notice", async () => {
  const fetchMock = vi.fn(() =>
    Promise.resolve(new Response(JSON.stringify({ status: true }), { status: 200 })),
  );
  vi.stubGlobal("fetch", fetchMock);
  const { container, root } = await render("/forgot-password");
  await act(async () => {
    type(container, "email", "jort@example.com");
  });
  await submit(container);
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/auth/request-password-reset",
    expect.objectContaining({
      body: expect.stringContaining('"email":"jort@example.com"'),
    }),
  );
  expect(container.textContent).toContain("If an account uses that address");
  await act(async () => {
    root.unmount();
  });
});

test("expired password reset link offers a fresh request", async () => {
  const { container, root } = await render("/reset-password?error=INVALID_TOKEN");
  expect(container.textContent).toContain("invalid or expired");
  expect(container.querySelector('a[href="/forgot-password"]')).not.toBeNull();
  await act(async () => {
    root.unmount();
  });
});

test("confirmed email opens dashboard when Better Auth created a session", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ user: { id: "u1", email: "jort@example.com" } }), {
          status: 200,
        }),
      ),
    ),
  );
  const { container, root } = await render("/email-confirmed");
  expect(container.textContent).toContain("Dashboard");
  await act(async () => {
    root.unmount();
  });
});

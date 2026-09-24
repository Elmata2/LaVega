/* Thin client for better-auth's mounted routes (apps/server/src/index.ts
 * proxies "/api/auth/*" to apps/server/src/auth.ts). No @better-auth/react
 * dependency: this app already talks to its backend with raw fetch
 * everywhere else, and the surface it needs here is three endpoints. */

import { forgetDashboards } from "./dashboardResource";

export type AuthUser = { id: string; email: string; name?: string | null };

export type SessionState =
  | { status: "unconfigured" } // DATABASE_URL / BETTER_AUTH_SECRET unset — local/self-hosted dev, no auth gate
  | { status: "anonymous" }
  | { status: "authenticated"; user: AuthUser };

export type AuthResult =
  | { ok: true; pendingVerification?: boolean }
  | { ok: false; message: string };

export function verificationCallbackUrl(): string {
  const base = import.meta.env.BASE_URL || "/";
  return new URL(base, window.location.origin).href;
}

async function readMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  return body?.message ?? fallback;
}

export async function getSession(): Promise<SessionState> {
  const response = await fetch("/api/auth/get-session", {
    headers: { accept: "application/json" },
  });
  if (response.status === 503) return { status: "unconfigured" };
  const body = (await response.json().catch(() => null)) as { user: AuthUser } | null;
  return body?.user ? { status: "authenticated", user: body.user } : { status: "anonymous" };
}

export async function signUp(input: {
  name: string;
  email: string;
  password: string;
  callbackURL?: string;
}): Promise<AuthResult> {
  const response = await fetch("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...input,
      callbackURL: input.callbackURL ?? verificationCallbackUrl(),
    }),
  });
  const body = (await response.json().catch(() => null)) as {
    token?: string | null;
    message?: string;
  } | null;
  if (!response.ok) return { ok: false, message: body?.message ?? "Failed to create account." };
  if (body?.token === null) return { ok: true, pendingVerification: true };
  return { ok: true };
}

export async function signIn(input: { email: string; password: string }): Promise<AuthResult> {
  const response = await fetch("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) return { ok: false, message: await readMessage(response, "Sign-in failed.") };
  return { ok: true };
}

export async function signOut(): Promise<void> {
  // Portfolio data kept for a fast reload must not outlive the session on a shared device.
  forgetDashboards();
  await fetch("/api/auth/sign-out", { method: "POST" });
}

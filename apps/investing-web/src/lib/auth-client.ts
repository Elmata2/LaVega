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
  return new URL(`${base.replace(/\/$/, "")}/email-confirmed`, window.location.origin).href;
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

export async function resendVerificationEmail(email: string): Promise<AuthResult> {
  const response = await fetch("/api/auth/send-verification-email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, callbackURL: verificationCallbackUrl() }),
  });
  if (!response.ok) {
    return {
      ok: false,
      message: await readMessage(response, "Could not send confirmation email."),
    };
  }
  return { ok: true };
}

export function passwordResetCallbackUrl(): string {
  const base = import.meta.env.BASE_URL || "/";
  return new URL(`${base.replace(/\/$/, "")}/reset-password`, window.location.origin).href;
}

export async function requestPasswordReset(email: string): Promise<AuthResult> {
  const response = await fetch("/api/auth/request-password-reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, redirectTo: passwordResetCallbackUrl() }),
  });
  if (!response.ok)
    return { ok: false, message: await readMessage(response, "Could not request password reset.") };
  return { ok: true };
}

export async function resetPassword(token: string, newPassword: string): Promise<AuthResult> {
  const response = await fetch("/api/auth/reset-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token, newPassword }),
  });
  if (!response.ok)
    return {
      ok: false,
      message: await readMessage(response, "Could not reset password. Request a new link."),
    };
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

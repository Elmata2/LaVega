import { useCallback, useEffect, useState } from "react";
import { APP_BASE } from "./appRoutes.js";

/* Thin client for better-auth's mounted routes on a configured LaVega server
 * (see apps/investing-web/src/lib/auth-client.ts for the sibling app's take on
 * the same three endpoints). apps/web has no react-router-dom and no
 * @better-auth/react dependency, so this stays a standalone file: no new
 * deps, three fetches, one hook. */

export type AuthState =
  | { kind: "loading" } // the first /api/auth/get-session answer has not arrived yet
  | { kind: "unconfigured" } // /api/auth/get-session answered 503: no auth on this deployment (local dev)
  | { kind: "signed-out" }
  | { kind: "signed-in"; id: string; email: string };

/** Why a sign-in did not happen — a KIND and not a sentence.
 *
 *  These two used to be Dutch string constants thrown as `Error`s, and the
 *  sign-in form printed `err.message` verbatim. That put Dutch on the very
 *  first screen an English reader ever sees, on the one screen where being
 *  understood matters most. The sentence belongs to `copy/shell`; what this
 *  module knows is which of the two things went wrong.
 *
 *  Deliberately NOT the server's own text: better-auth answers 401 with
 *  "invalid credentials", and echoing an upstream error string into the UI is
 *  how an implementation detail becomes user-facing copy. */
export type SignInFailure = "wrong-credentials" | "unverified" | "rate-limited" | "unreachable";

export type SignInResult = { ok: true; state: AuthState } | { ok: false; kind: SignInFailure };

/** Why a sign-up did not happen, as a kind for the same reason as `SignInFailure`. */
export type SignUpFailure = "weak-password" | "rate-limited" | "unreachable";

export type SignUpInput = { name: string; email: string; password: string; callbackURL: string };

export type SignUpResult = { ok: true } | { ok: false; kind: SignUpFailure };

/** Where better-auth sends the browser after the emailed link is followed. The
 *  server auto-signs the user in on verification, so landing on the app is enough. */
export function verificationCallbackUrl(): string {
  return `${window.location.origin}${APP_BASE}`;
}

export async function getSession(): Promise<AuthState> {
  try {
    const response = await fetch("/api/auth/get-session", {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (response.status === 503) return { kind: "unconfigured" };
    const body = (await response.json().catch(() => null)) as {
      user?: { id?: string; email?: string };
    } | null;
    return body?.user?.id && body.user.email
      ? { kind: "signed-in", id: body.user.id, email: body.user.email }
      : { kind: "signed-out" };
  } catch {
    return { kind: "signed-out" };
  }
}

export async function signIn(email: string, password: string): Promise<SignInResult> {
  let response: Response;
  try {
    response = await fetch("/api/auth/sign-in/email", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return { ok: false, kind: "unreachable" };
  }
  /* 403 is better-auth's EMAIL_NOT_VERIFIED. With sendOnSignIn on, that same
   * request has already mailed a fresh confirmation link. */
  if (!response.ok)
    return {
      ok: false,
      kind:
        response.status === 401
          ? "wrong-credentials"
          : response.status === 403
            ? "unverified"
            : response.status === 429
              ? "rate-limited"
              : "unreachable",
    };
  const body = (await response.json().catch(() => null)) as {
    user?: { id?: string; email?: string };
  } | null;
  if (!body?.user?.id || !body.user.email) return { ok: false, kind: "unreachable" };
  return { ok: true, state: { kind: "signed-in", id: body.user.id, email: body.user.email } };
}

export async function signUp(input: SignUpInput): Promise<SignUpResult> {
  let response: Response;
  try {
    response = await fetch("/api/auth/sign-up/email", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    return { ok: false, kind: "unreachable" };
  }
  /* A duplicate email is deliberately indistinguishable from a new one: with
   * requireEmailVerification on, better-auth answers both with the same 200
   * (sign-up.mjs, buildGenericDuplicateResponse), so there is no "exists" kind. */
  if (response.ok) return { ok: true };
  if (response.status === 429) return { ok: false, kind: "rate-limited" };
  const body = (await response.json().catch(() => null)) as { code?: string } | null;
  if (body?.code === "PASSWORD_TOO_SHORT" || body?.code === "PASSWORD_TOO_LONG")
    return { ok: false, kind: "weak-password" };
  return { ok: false, kind: "unreachable" };
}

/** Where the emailed reset link lands. better-auth appends `?token=` or `?error=`. */
export const RESET_PASSWORD_PATH = "/reset-password";

export type MailResult = { ok: true } | { ok: false; kind: "rate-limited" | "unreachable" };

async function postAuth(path: string, body: unknown): Promise<Response | null> {
  try {
    return await fetch(`/api/auth/${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return null;
  }
}

function mailResult(response: Response | null): MailResult {
  if (response?.ok) return { ok: true };
  return { ok: false, kind: response?.status === 429 ? "rate-limited" : "unreachable" };
}

/** Sends a new confirmation link. better-auth answers the same for an unknown
 *  or already-confirmed address, so this reveals nothing about who has an account. */
export async function resendVerification(email: string): Promise<MailResult> {
  return mailResult(
    await postAuth("send-verification-email", { email, callbackURL: verificationCallbackUrl() }),
  );
}

/** Same answer whether or not the address has an account. */
export async function requestPasswordReset(email: string): Promise<MailResult> {
  return mailResult(
    await postAuth("request-password-reset", {
      email,
      redirectTo: `${window.location.origin}${RESET_PASSWORD_PATH}`,
    }),
  );
}

export type ResetPasswordFailure = "invalid-link" | "weak-password" | "unreachable";

export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<{ ok: true } | { ok: false; kind: ResetPasswordFailure }> {
  const response = await postAuth("reset-password", { token, newPassword });
  if (response?.ok) return { ok: true };
  if (!response) return { ok: false, kind: "unreachable" };
  const body = (await response.json().catch(() => null)) as { code?: string } | null;
  if (body?.code === "PASSWORD_TOO_SHORT" || body?.code === "PASSWORD_TOO_LONG")
    return { ok: false, kind: "weak-password" };
  if (body?.code === "INVALID_TOKEN") return { ok: false, kind: "invalid-link" };
  return { ok: false, kind: "unreachable" };
}

export async function signOut(): Promise<void> {
  await fetch("/api/auth/sign-out", { method: "POST", credentials: "same-origin" });
}

export function useAuthState(): { state: AuthState; refresh: () => void } {
  const [state, setState] = useState<AuthState>({ kind: "loading" });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let current = true;
    void getSession().then((next) => {
      if (current) setState(next);
    });
    return () => {
      current = false;
    };
  }, [tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { state, refresh };
}

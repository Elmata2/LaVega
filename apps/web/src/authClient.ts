import { useCallback, useEffect, useState } from "react";

/* Thin client for better-auth's mounted routes on a configured LaVega server
 * (see apps/investing-web/src/lib/auth-client.ts for the sibling app's take on
 * the same three endpoints). apps/web has no react-router-dom and no
 * @better-auth/react dependency, so this stays a standalone file: no new
 * deps, three fetches, one hook. */

export type AuthState =
  | { kind: "loading" } // the first /api/auth/get-session answer has not arrived yet
  | { kind: "unconfigured" } // /api/auth/get-session answered 503: no auth on this deployment (local dev)
  | { kind: "signed-out" }
  | { kind: "signed-in"; email: string };

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
export type SignInFailure = "wrong-credentials" | "unreachable";

export type SignInResult = { ok: true; state: AuthState } | { ok: false; kind: SignInFailure };

export async function getSession(): Promise<AuthState> {
  try {
    const response = await fetch("/api/auth/get-session", {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (response.status === 503) return { kind: "unconfigured" };
    const body = (await response.json().catch(() => null)) as { user?: { email: string } } | null;
    return body?.user ? { kind: "signed-in", email: body.user.email } : { kind: "signed-out" };
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
  if (!response.ok)
    return { ok: false, kind: response.status === 401 ? "wrong-credentials" : "unreachable" };
  const body = (await response.json().catch(() => null)) as { user?: { email: string } } | null;
  return { ok: true, state: { kind: "signed-in", email: body?.user?.email ?? email } };
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

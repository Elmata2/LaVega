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

const WRONG_CREDENTIALS = "Onjuist e-mailadres of wachtwoord.";
const SERVER_UNREACHABLE = "Inloggen lukte niet. Probeer het later opnieuw.";

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

export async function signIn(email: string, password: string): Promise<AuthState> {
  let response: Response;
  try {
    response = await fetch("/api/auth/sign-in/email", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch {
    throw new Error(SERVER_UNREACHABLE);
  }
  if (!response.ok)
    throw new Error(response.status === 401 ? WRONG_CREDENTIALS : SERVER_UNREACHABLE);
  const body = (await response.json().catch(() => null)) as { user?: { email: string } } | null;
  return { kind: "signed-in", email: body?.user?.email ?? email };
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

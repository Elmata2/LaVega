/* Thin client for better-auth's mounted routes (apps/server/src/index.ts
 * proxies "/api/auth/*" to apps/server/src/auth.ts). No @better-auth/react
 * dependency: this app already talks to its backend with raw fetch
 * everywhere else, and the surface it needs here is three endpoints. */

export type AuthUser = { id: string; email: string; name?: string | null };

export type SessionState =
  | { status: "unconfigured" } // DATABASE_URL / BETTER_AUTH_SECRET unset — local/self-hosted dev, no auth gate
  | { status: "anonymous" }
  | { status: "authenticated"; user: AuthUser };

export type AuthResult = { ok: true } | { ok: false; message: string };

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
}): Promise<AuthResult> {
  const response = await fetch("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok)
    return { ok: false, message: await readMessage(response, "Account aanmaken mislukt.") };
  return { ok: true };
}

export async function signIn(input: { email: string; password: string }): Promise<AuthResult> {
  const response = await fetch("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) return { ok: false, message: await readMessage(response, "Inloggen mislukt.") };
  return { ok: true };
}

export async function signOut(): Promise<void> {
  await fetch("/api/auth/sign-out", { method: "POST" });
}

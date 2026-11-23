/** Shared low-level fetch helpers for better-auth's mounted `/api/auth/*` routes. */

export async function fetchAuthSession(): Promise<Response | null> {
  try {
    return await fetch("/api/auth/get-session", {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
  } catch {
    return null;
  }
}

export async function postAuthJson(path: string, body: unknown): Promise<Response | null> {
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

export async function readAuthJson<T>(response: Response): Promise<T | null> {
  return (await response.json().catch(() => null)) as T | null;
}

/** Rejects with `"sign-out-failed"` when the session may still be valid (network
 *  error or non-2xx), so callers stay on the page instead of navigating away. */
export async function postSignOut(): Promise<void> {
  // The auth server answers 415 to a POST without a JSON content type.
  const response = await postAuthJson("sign-out", {});
  if (!response?.ok) throw new Error("sign-out-failed");
}

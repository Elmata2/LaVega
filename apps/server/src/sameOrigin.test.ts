import { Hono } from "hono";
import { expect, test } from "vitest";
import { isAllowedOrigin, sameOriginGuard } from "./sameOrigin.js";

/* M4 (security review 2026-10-17): every state-changing call here is a
 * cookie-authenticated request with no CSRF token, so `sameSite:"lax"` was the
 * only thing standing between an attacker page and a state change — and Lax
 * still sends the cookie on a top-level GET. `GET /api/n8n/queue` drained and
 * DESTROYED the caller's invoice queue. */

function appWith(trusted: string[] = []) {
  const app = new Hono();
  app.use("*", sameOriginGuard(trusted));
  app.post("/thing", (c) => c.text("mutated"));
  app.all("/thing", (c) => c.text(`${c.req.method} passed`));
  return app;
}

test("a cross-site Sec-Fetch-Site is refused on a state-changing request", async () => {
  const res = await appWith().request("/thing", {
    method: "POST",
    headers: { "sec-fetch-site": "cross-site" },
  });
  expect(res.status).toBe(403);
  expect((await res.json()).code).toBe("cross-site-request");
});

test("a foreign Origin is refused even without Sec-Fetch-Site", async () => {
  const res = await appWith().request("/thing", {
    method: "POST",
    headers: { origin: "https://evil.example" },
  });
  expect(res.status).toBe(403);
});

test("the request's own origin is allowed", async () => {
  const res = await appWith().request("http://localhost/thing", {
    method: "POST",
    headers: { origin: "http://localhost" },
  });
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("mutated");
});

test("a trusted origin is allowed (the deployment's own public hostname)", async () => {
  const res = await appWith(["https://lavega.dev"]).request("http://internal/thing", {
    method: "POST",
    headers: { origin: "https://lavega.dev" },
  });
  expect(res.status).toBe(200);
});

test("a loopback origin is allowed — pnpm dev's Vite on :5173 calls :8787", async () => {
  const res = await appWith().request("http://localhost:8787/thing", {
    method: "POST",
    headers: { origin: "http://localhost:5173" },
  });
  expect(res.status).toBe(200);
});

test("the effective origin is rebuilt from the proxy headers a TLS host forwards", () => {
  // Behind the proxy the function sees http://<internal>; the browser sent an
  // https Origin. Comparing raw would refuse a correct same-origin POST.
  expect(
    isAllowedOrigin("https://lavega.dev", "https://lavega.dev", new Set(["https://lavega.dev"])),
  ).toBe(true);
});

test("a safe method is never judged, so a cross-site link cannot be a state change", async () => {
  const res = await appWith().request("/thing", {
    method: "GET",
    headers: { "sec-fetch-site": "cross-site", origin: "https://evil.example" },
  });
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("GET passed");
});

test("a request with neither header — a non-browser client — is not a CSRF vector", async () => {
  const res = await appWith().request("/thing", { method: "POST" });
  expect(res.status).toBe(200);
});

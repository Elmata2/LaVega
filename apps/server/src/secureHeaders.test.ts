import { expect, test } from "vitest";
import { app, isHttpsRequest } from "./index.js";

/* HSTS is only emitted for an https request (security review 2026-10-17, A6):
 * over plaintext a browser ignores it at best, and the unconditional
 * `includeSubDomains` pinned the whole registrable domain the first time any
 * response came back over https. Behind a proxy the scheme arrives in
 * `x-forwarded-proto`. */
test("an https response carries HSTS with includeSubDomains", async () => {
  const res = await app.request("/health", { headers: { "x-forwarded-proto": "https" } });
  expect(res.headers.get("strict-transport-security")).toMatch(/max-age=\d{7,}/);
  expect(res.headers.get("strict-transport-security")).toContain("includeSubDomains");
});

test("a plaintext request gets no HSTS header", async () => {
  const res = await app.request("/health", { headers: { "x-forwarded-proto": "http" } });
  expect(res.headers.get("strict-transport-security")).toBeNull();
});

test("isHttpsRequest trusts the forwarded scheme, then the request URL", () => {
  expect(isHttpsRequest("https", "http://internal/health")).toBe(true);
  expect(isHttpsRequest("https, http", "http://internal/health")).toBe(true);
  expect(isHttpsRequest("http", "https://lavega.dev/health")).toBe(false);
  expect(isHttpsRequest(undefined, "https://lavega.dev/health")).toBe(true);
  expect(isHttpsRequest(undefined, "http://localhost:8787/health")).toBe(false);
});

test("the response carries a restrictive Permissions-Policy", async () => {
  const policy = (await app.request("/health")).headers.get("permissions-policy") ?? "";
  expect(policy).toContain("camera=()");
  expect(policy).toContain("microphone=()");
  expect(policy).toContain("geolocation=()");
});

test("responses refuse MIME sniffing", async () => {
  const res = await app.request("/health");
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
});

test("the app cannot be framed, so the vault unlock screen cannot be clickjacked", async () => {
  const res = await app.request("/health");
  expect(res.headers.get("x-frame-options")).toBe("DENY");
  expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
});

test("no referrer leaves the page, so a session_id in the URL cannot leak downstream", async () => {
  const res = await app.request("/health");
  expect(res.headers.get("referrer-policy")).toBe("no-referrer");
});

test("the CSP pins script execution to this origin", async () => {
  const csp = (await app.request("/health")).headers.get("content-security-policy") ?? "";
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).toContain("base-uri 'self'");
});

test("the CSP still allows the origins the app genuinely calls", async () => {
  const csp = (await app.request("/health")).headers.get("content-security-policy") ?? "";
  // The n8n features call a URL the user configures, so connect-src cannot be pinned to 'self' without breaking
  // shipped features. Inline STYLE attributes are what React renders.
  expect(csp).toMatch(/connect-src [^;]*https:/);
  expect(csp).toMatch(/style-src [^;]*'unsafe-inline'/);
});

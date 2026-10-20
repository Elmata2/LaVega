import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { app } from "./index.js";

/* The CDN answers the static shell without ever reaching this server, so its
 * copy of the policy is a second source of truth. Two policies that drift are
 * worse than one: the browser enforces both and the narrower one decides. Read
 * the real array out of the build script and hold it against the live header. */
const vercelBuild = readFileSync(
  new URL("../../../scripts/vercel-build.mjs", import.meta.url),
  "utf8",
);

function cdnPermissionsPolicy(): string | null {
  const block = vercelBuild.match(/"Permissions-Policy":\s*\[([\s\S]*?)\]\.join\(", "\)/);
  if (!block) return null;
  return [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]).join(", ");
}

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

test("with no forwarded scheme, an https request URL still gets HSTS", async () => {
  const res = await app.request("https://lavega.dev/health");
  expect(res.headers.get("strict-transport-security")).toMatch(/max-age=\d{7,}/);
});

test("a proxy chain's first x-forwarded-proto entry decides: https, http gets HSTS", async () => {
  const res = await app.request("http://internal/health", {
    headers: { "x-forwarded-proto": "https, http" },
  });
  expect(res.headers.get("strict-transport-security")).toMatch(/max-age=\d{7,}/);
});

test("the response carries a restrictive Permissions-Policy", async () => {
  const policy = (await app.request("/health")).headers.get("permissions-policy") ?? "";
  expect(policy).toContain("camera=()");
  expect(policy).toContain("microphone=()");
  expect(policy).toContain("geolocation=()");
});

test("the CDN's Permissions-Policy is byte-for-byte the server's", async () => {
  const served = (await app.request("/health")).headers.get("permissions-policy");
  expect(served).not.toBeNull();
  expect(cdnPermissionsPolicy()).toBe(served);
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

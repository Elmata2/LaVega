import { expect, test } from "vitest";
import { app } from "./index.js";

test("responses carry HSTS, so a downgraded first hop cannot read the session cookie", async () => {
  const res = await app.request("/health");
  expect(res.headers.get("strict-transport-security")).toMatch(/max-age=\d{7,}/);
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
  // The waitlist posts to script.google.com and the n8n features call a URL the
  // user configures, so connect-src cannot be pinned to 'self' without breaking
  // shipped features. Inline STYLE attributes are what React renders.
  expect(csp).toMatch(/connect-src [^;]*https:/);
  expect(csp).toMatch(/style-src [^;]*'unsafe-inline'/);
});

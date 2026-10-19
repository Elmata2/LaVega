import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { CSP_FALLBACK_META } from "./csp.js";

/* The <meta> fallback must not be narrower than the header the CDN sets, or a
 * page that carries both would refuse a connection the header allows. The
 * drift-prone directives are read back out of scripts/vercel-build.mjs, which is
 * where the header is defined. */
const vercelBuild = readFileSync(
  fileURLToPath(new URL("../../../scripts/vercel-build.mjs", import.meta.url)),
  "utf8",
);

describe("CSP_FALLBACK_META", () => {
  test("mirrors the CDN header's script-src and connect-src", () => {
    expect(vercelBuild).toContain(`"script-src 'self' https://*.posthog.com"`);
    expect(vercelBuild).toContain(`"connect-src 'self' https:"`);
    expect(CSP_FALLBACK_META).toContain("script-src 'self' https://*.posthog.com");
    expect(CSP_FALLBACK_META).toContain("connect-src 'self' https:");
  });

  test("has a default-src and never allows unsafe-eval", () => {
    expect(CSP_FALLBACK_META).toMatch(/(^|; )default-src 'self'/);
    expect(CSP_FALLBACK_META).not.toContain("unsafe-eval");
  });

  test("omits frame-ancestors, which a meta policy cannot enforce", () => {
    expect(CSP_FALLBACK_META).not.toContain("frame-ancestors");
  });
});

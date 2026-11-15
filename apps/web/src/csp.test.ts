import { describe, expect, test } from "vitest";
import { CSP_FALLBACK_META } from "./csp.js";

describe("CSP_FALLBACK_META", () => {
  test("has a default-src and never allows unsafe-eval", () => {
    expect(CSP_FALLBACK_META).toMatch(/(^|; )default-src 'self'/);
    expect(CSP_FALLBACK_META).not.toContain("unsafe-eval");
  });

  test("omits frame-ancestors, which a meta policy cannot enforce", () => {
    expect(CSP_FALLBACK_META).not.toContain("frame-ancestors");
  });
});

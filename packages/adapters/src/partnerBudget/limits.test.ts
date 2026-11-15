import { expect, test } from "vitest";
import { PARTNER_LIMITS, accountScopeId, partnerKey, tableIntervalMs } from "./limits.js";

test("the table holds exactly the eight keys of the budget", () => {
  expect(Object.keys(PARTNER_LIMITS).sort()).toEqual([
    "ibkr:flex",
    "openfigi:mapping",
    "trading212:account-summary",
    "trading212:history-dividends",
    "trading212:history-orders",
    "trading212:history-transactions",
    "trading212:positions",
    "yahoo:any",
  ]);
});

test("a scope id is 16 hex characters of the SHA-256 and never the credential", async () => {
  const secret = "api-key-1234567890-do-not-store";
  const scope = await accountScopeId(secret);
  expect(scope).toMatch(/^[0-9a-f]{16}$/);
  expect(scope).not.toContain(secret);
  // SHA-256("abc") = ba7816bf8f01cfea...
  expect(await accountScopeId("abc")).toBe("ba7816bf8f01cfea");
  expect(await accountScopeId(secret)).toBe(scope);
  expect(await accountScopeId(`${secret}x`)).not.toBe(scope);
});

test("shared keys carry the literal scope and account keys a hashed one", async () => {
  expect(partnerKey("yahoo:any")).toEqual({ partner: "yahoo", endpoint: "any", scopeId: "shared" });
  expect(partnerKey("openfigi:mapping").scopeId).toBe("shared");
  const scope = await accountScopeId("token");
  expect(partnerKey("trading212:history-orders", scope)).toEqual({
    partner: "trading212",
    endpoint: "history-orders",
    scopeId: scope,
  });
  expect(partnerKey("ibkr:flex", scope).scopeId).toMatch(/^[0-9a-f]{16}$/);
});

test("the builder refuses a raw credential as a scope id", () => {
  expect(() =>
    partnerKey(
      "trading212:positions",
      "my-raw-api-key" as Parameters<typeof partnerKey>[1] & string,
    ),
  ).toThrow(/account scope id/);
  expect(() => partnerKey("trading212:positions", "ABCDEF0123456789" as never)).toThrow();
});

test("the builder rejects every name outside the table at typecheck", () => {
  // @ts-expect-error not one of the eight keys
  expect(() => partnerKey("yahoo:chart")).toThrow();
  // @ts-expect-error an account key needs a scope id
  expect(() => partnerKey("trading212:positions")).toThrow();
});

test("the table interval is the minimum spacing of each key", () => {
  expect(tableIntervalMs(partnerKey("yahoo:any"))).toBe(300);
  expect(tableIntervalMs(partnerKey("openfigi:mapping"))).toBe(2_500);
  expect(
    tableIntervalMs({ partner: "yahoo", endpoint: "chart", scopeId: "shared" }),
  ).toBeUndefined();
  expect(
    tableIntervalMs({ partner: "toString", endpoint: "x", scopeId: "shared" }),
  ).toBeUndefined();
});

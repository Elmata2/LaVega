import { describe, expect, test } from "vitest";
import { shellCopy } from "./copy/shell.js";
import type { BankRefreshFailureReason } from "./shellNotice.js";

describe("bank refresh failure notices (nl/en)", () => {
  const reasons: BankRefreshFailureReason[] = ["rate-limited", "bank-down", "unknown"];

  test("each reason produces distinct, non-empty copy in both nl and en without raw 'unreachable'", () => {
    for (const locale of ["nl", "en"] as const) {
      const copy = shellCopy[locale];
      const rendered = reasons.map((reason) =>
        copy.notice({ kind: "bank-refresh-failed", aspsp: "ING", reason }),
      );
      for (const text of rendered) {
        expect(text).toContain("ING");
        expect(text.toLowerCase()).not.toContain("unreachable");
      }
      expect(new Set(rendered).size).toBe(reasons.length);
    }
  });

  test("nl copy tells the user what to do (wait for rate-limited/bank-down, reconnect option for unknown)", () => {
    const nl = shellCopy.nl;
    expect(
      nl.notice({ kind: "bank-refresh-failed", aspsp: "ING", reason: "rate-limited" }),
    ).toMatch(/wacht|later/i);
    expect(nl.notice({ kind: "bank-refresh-failed", aspsp: "ING", reason: "bank-down" })).toMatch(
      /wacht|later/i,
    );
    expect(nl.notice({ kind: "bank-refresh-failed", aspsp: "ING", reason: "unknown" })).toMatch(
      /koppel.*opnieuw/i,
    );
  });

  test("en copy tells the user what to do (wait for rate-limited/bank-down, reconnect option for unknown)", () => {
    const en = shellCopy.en;
    expect(
      en.notice({ kind: "bank-refresh-failed", aspsp: "ING", reason: "rate-limited" }),
    ).toMatch(/wait|later/i);
    expect(en.notice({ kind: "bank-refresh-failed", aspsp: "ING", reason: "bank-down" })).toMatch(
      /wait|later/i,
    );
    expect(en.notice({ kind: "bank-refresh-failed", aspsp: "ING", reason: "unknown" })).toMatch(
      /reconnect/i,
    );
  });

  test("expired consent copy remains intact in both locales", () => {
    expect(shellCopy.nl.notice({ kind: "bank-consent-expired", aspsp: "ING" })).toMatch(
      /ING.*verlopen.*koppel/i,
    );
    expect(shellCopy.en.notice({ kind: "bank-consent-expired", aspsp: "ING" })).toMatch(
      /ING.*expired.*reconnect/i,
    );
  });
});

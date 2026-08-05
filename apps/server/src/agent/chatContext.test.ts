import { expect, test } from "vitest";
import { sanitizeChatContext, sanitizeMessages } from "./chatContext.js";

test("sanitizeChatContext keeps only the tab's allowlisted keys", () => {
  const out = sanitizeChatContext("facturen", { invoices: [{ counterparty: "X" }], txs: [1,2,3], balance: 999 });
  expect(out).toEqual({ invoices: [{ counterparty: "X" }] });
  expect((out as Record<string, unknown>).txs).toBeUndefined();
});
test("unknown tab yields empty context", () => {
  expect(sanitizeChatContext("hackerz", { secrets: 1 })).toEqual({});
});
test("valuta allows only rate + holdings (no personal amounts)", () => {
  const out = sanitizeChatContext("valuta", { rate: { base: "EUR" }, holdings: ["USD"], invoices: [1] });
  expect(out).toEqual({ rate: { base: "EUR" }, holdings: ["USD"] });
});
test("oversize context throws", () => {
  expect(() => sanitizeChatContext("facturen", { invoices: "A".repeat(70_000) })).toThrow();
});
test("sanitizeMessages drops junk roles + caps count", () => {
  const msgs = sanitizeMessages([{ role: "user", content: "hi" }, { role: "system", content: "x" }, { role: "assistant", content: 5 }]);
  expect(msgs).toEqual([{ role: "user", content: "hi" }]);
  const many = sanitizeMessages(Array.from({ length: 30 }, () => ({ role: "user", content: "q" })));
  expect(many.length).toBe(20);
});
test("sanitizeMessages drops empty/whitespace-only content messages", () => {
  const msgs = sanitizeMessages([
    { role: "user", content: "hi" },
    { role: "assistant", content: "   " },
    { role: "user", content: "again" },
  ]);
  expect(msgs).toEqual([{ role: "user", content: "hi" }, { role: "user", content: "again" }]);
});
test("sanitizeMessages trims a leading assistant so history starts with user", () => {
  const msgs = sanitizeMessages([
    { role: "assistant", content: "eerder antwoord" },
    { role: "user", content: "nieuwe vraag" },
    { role: "assistant", content: "antwoord" },
  ]);
  expect(msgs).toEqual([{ role: "user", content: "nieuwe vraag" }, { role: "assistant", content: "antwoord" }]);
});
test("sanitizeMessages trims the leading assistant left by the tail slice", () => {
  // 22 alternating msgs: slice(-20) starts at index 2, an assistant turn.
  const raw = Array.from({ length: 22 }, (_, i) => ({
    role: i % 2 === 0 ? "assistant" : "user",
    content: `m${i}`,
  }));
  const msgs = sanitizeMessages(raw);
  expect(msgs.length).toBeLessThanOrEqual(20);
  expect(msgs[0].role).toBe("user");
});

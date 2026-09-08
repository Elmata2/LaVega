import { expect, test } from "vitest";
import { sanitizeChatContext, sanitizeMessages } from "./chatContext.js";

test("sanitizeChatContext keeps only the tab's allowlisted keys", () => {
  const out = sanitizeChatContext("facturen", {
    invoices: [{ counterparty: "X" }],
    txs: [1, 2, 3],
    balance: 999,
  });
  expect(out).toEqual({ invoices: [{ counterparty: "X" }] });
  expect((out as Record<string, unknown>).txs).toBeUndefined();
});
test("unknown tab yields empty context", () => {
  expect(sanitizeChatContext("hackerz", { secrets: 1 })).toEqual({});
});
test("valuta allows only rate + holdings (no personal amounts)", () => {
  const out = sanitizeChatContext("valuta", {
    rate: { base: "EUR" },
    holdings: ["USD"],
    invoices: [1],
  });
  expect(out).toEqual({ rate: { base: "EUR" }, holdings: ["USD"] });
});
test("belasting may say WHICH country and HOW the sheet is mapped, never the sheet itself", () => {
  const out = sanitizeChatContext("belasting", {
    country: "DE",
    rules: { vat: { label: "USt" }, caveats: ["Dauerfristverlängerung niet meegerekend"] },
    prepayments: [{ label: "Nachzahlung 2026", dueDate: "2027-03-10", status: "expected" }],
    sheet: { mapping: { revenue: "Omzet excl. btw" }, problems: [] },
    // everything the tab does not own stays out, whatever the client sends
    rows: [{ revenue: 1_000_000 }],
    accounts: [{ iban: "NL91ABNA0417164300" }],
    txs: [1, 2, 3],
  });
  expect(Object.keys(out).sort()).toEqual(["country", "prepayments", "rules", "sheet"]);
});

test("punten may carry which balances are stale and the question to ask, nothing else", () => {
  const out = sanitizeChatContext("punten", {
    balances: [
      { program: "American Express Membership Rewards", points: 240_000, updatedAt: "2026-01-10" },
    ],
    tracking: [
      {
        label: "American Express Membership Rewards",
        state: "overdue",
        daysOverdue: 113,
        question:
          "Hoeveel punten staan er nu bij American Express Membership Rewards? Stuur alleen het getal.",
      },
    ],
    accounts: [{ iban: "NL91ABNA0417164300" }],
    txs: [1, 2, 3],
  });
  expect(Object.keys(out).sort()).toEqual(["balances", "tracking"]);
  // The question core builds is value-free, so the ask itself carries no number.
  expect(JSON.stringify((out as Record<string, unknown>).tracking)).not.toContain("240");
});

test("oversize context throws", () => {
  expect(() => sanitizeChatContext("facturen", { invoices: "A".repeat(70_000) })).toThrow();
});
test("sanitizeMessages drops junk roles + caps count", () => {
  const msgs = sanitizeMessages([
    { role: "user", content: "hi" },
    { role: "system", content: "x" },
    { role: "assistant", content: 5 },
  ]);
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
  expect(msgs).toEqual([
    { role: "user", content: "hi" },
    { role: "user", content: "again" },
  ]);
});
test("sanitizeMessages trims a leading assistant so history starts with user", () => {
  const msgs = sanitizeMessages([
    { role: "assistant", content: "eerder antwoord" },
    { role: "user", content: "nieuwe vraag" },
    { role: "assistant", content: "antwoord" },
  ]);
  expect(msgs).toEqual([
    { role: "user", content: "nieuwe vraag" },
    { role: "assistant", content: "antwoord" },
  ]);
});
test("sanitizeMessages scrubs personal values from message content (M5)", () => {
  // A message typed straight into the chat box carries none of `sanitizeChatContext`'s
  // key allowlisting — it is the raw text a person typed, so it is the one
  // place a value-scrub has to run on the server regardless of what the
  // browser already did.
  const msgs = sanitizeMessages([
    {
      role: "user",
      content: "mijn iban is NL91 ABNA 0417 1643 00, bel me op 06 12345678",
    },
  ]);
  expect(msgs).toEqual([{ role: "user", content: "mijn iban is [IBAN], bel me op [TEL]" }]);
});

test("sanitizeMessages scrubs BEFORE truncating, so an IBAN straddling the 8000-char cap can't survive as a fragment", () => {
  // MAX_MSG_CHARS is 8000 and not exported; padding puts the IBAN's raw digits
  // across that exact boundary. Truncating first would cut the IBAN mid-match,
  // leaving a fragment the regex no longer recognises as one.
  const padding = "x".repeat(7_990);
  const msgs = sanitizeMessages([
    { role: "user", content: `${padding} NL91 ABNA 0417 1643 00 na de grens` },
  ]);
  expect(msgs[0].content).not.toMatch(/NL91|ABNA|0417|1643/);
  expect(msgs[0].content).toContain("[IBAN]");
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

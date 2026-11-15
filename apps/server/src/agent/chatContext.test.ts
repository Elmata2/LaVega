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

test("sanitizeChatContext scrubs values INSIDE an allowed key, not just the key names", () => {
  // The allowlist is key names only, so `forecast`'s single allowed key waved
  // through whatever sat under it — and what sits under it is
  // `drivers[].label`, the raw counterparty of a bank row. The browser builder
  // scrubs first; this proves the server does not depend on that.
  const out = sanitizeChatContext("forecast", {
    summary: {
      openingCents: 500_000,
      drivers: [{ label: "NL17INGB0539576085 SPOTIFY AB Stockholm", sign: -1, perWeekCents: -276 }],
    },
  });
  const json = JSON.stringify(out);
  expect(json).not.toContain("NL17INGB0539576085");
  expect(json).toContain("[IBAN]");
  expect(json).toContain("SPOTIFY");
  // Numbers are left exactly as they are: they are what the tab is for.
  expect((out.summary as Record<string, unknown>).openingCents).toBe(500_000);
});

test("sanitizeChatContext scrubs an email or a phone number wherever it is nested", () => {
  const out = sanitizeChatContext("punten", {
    balances: [{ program: "Amex MR", points: 240_000, note: "login a@b.com, bel 06 12345678" }],
  });
  const json = JSON.stringify(out);
  expect(json).not.toContain("a@b.com");
  expect(json).not.toContain("12345678");
  expect(json).toContain("[EMAIL]");
  expect(json).toContain("[TEL]");
});

// --- profile summary (privacy path) ---
import { CHAT_TABS } from "./chatContext.js";

const goodProfile = {
  priorities: ["save-more", "cards-points"],
  cutTargets: ["eating-out", "subscriptions"],
  checkInCadence: "weekly",
  confidence: 3,
  household: "together",
  moneySharing: "mixed",
  incomeRegularity: "varies",
  spendMix: ["groceries"],
  cardRepayment: "full",
  pointsGoal: "flights",
};

test("server keeps a valid profile on every tab, including one not in ALLOW", () => {
  for (const tab of [...CHAT_TABS, "hackerz"]) {
    expect(sanitizeChatContext(tab, { profile: goodProfile }).profile).toEqual(goodProfile);
  }
});

test("server drops unknown profile keys and non-enum values", () => {
  const out = sanitizeChatContext("overview", {
    profile: {
      ...goodProfile,
      birthYear: 1987,
      statedBanks: ["ing"],
      household: "NL91ABNA0417164300",
      confidence: 9,
      pointsGoal: { x: 1 },
      spendMix: ["groceries", "bogus", 7],
    },
  });
  expect(out.profile).toEqual({
    ...goodProfile,
    household: null,
    confidence: null,
    pointsGoal: null,
    spendMix: ["groceries"],
  });
  expect(JSON.stringify(out)).not.toMatch(/birthYear|statedBanks|1987/);
});

test("a free-text value in priorities is dropped on the server", () => {
  const out = sanitizeChatContext("forecast", {
    profile: { priorities: ["save-more", "ik wil sparen voor NL91ABNA0417164300", "mijn partner heet Jan"] },
  });
  expect((out.profile as { priorities: string[] }).priorities).toEqual(["save-more"]);
});

test("a non-object profile is omitted", () => {
  expect(sanitizeChatContext("overview", { profile: "free text" })).toEqual({});
  expect(sanitizeChatContext("overview", { profile: null })).toEqual({});
});

test("enum strings survive the value scrub unchanged", () => {
  const out = sanitizeChatContext("overview", { profile: goodProfile });
  expect(out.profile).toEqual(goodProfile);
});

// --- fix round 1 ---
test("prototype-named tabs return a clean result, not a throw", () => {
  for (const tab of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
    expect(() => sanitizeChatContext(tab, { profile: goodProfile })).not.toThrow();
    expect(sanitizeChatContext(tab, { profile: goodProfile, x: 1 })).toEqual({
      profile: goodProfile,
    });
  }
});

test("every enum literal survives the server scrub byte-identical", () => {
  const all = {
    priorities: [
      "spend-less",
      "save-more",
      "pay-off-debt",
      "cards-points",
      "subscriptions",
      "children",
      "start-investing",
    ],
    cutTargets: ["groceries", "travel", "online", "fuel", "eating-out", "other", "subscriptions"],
    checkInCadence: "when-it-matters",
    confidence: 4,
    household: "alone",
    moneySharing: "separate",
    incomeRegularity: "fixed",
    spendMix: ["groceries", "travel", "online", "fuel", "eating-out", "other"],
    cardRepayment: "sometimes",
    pointsGoal: "no-preference",
  };
  const out = sanitizeChatContext("overview", { profile: all });
  expect(JSON.stringify(out.profile)).toBe(JSON.stringify(all));
  for (const c of ["daily", "weekly"])
    expect(sanitizeChatContext("overview", { profile: { checkInCadence: c } }).profile).toMatchObject({
      checkInCadence: c,
    });
  for (const v of ["rarely", "full"])
    expect(sanitizeChatContext("overview", { profile: { cardRepayment: v } }).profile).toMatchObject({
      cardRepayment: v,
    });
});

test("an empty or fully invalid profile is omitted", () => {
  expect(sanitizeChatContext("overview", { profile: {} })).toEqual({});
  expect(sanitizeChatContext("overview", { profile: { priorities: ["x"], confidence: 9 } })).toEqual({});
});

test.each([
  ["proto keys", JSON.parse('{"__proto__":{"a":1},"constructor":{"b":2},"priorities":["save-more"]}')],
  ["huge array", { priorities: Array.from({ length: 100_000 }, (_, i) => (i % 2 ? "save-more" : `x${i}`)) }],
  ["string confidence", { confidence: "3", priorities: ["save-more"] }],
  ["NaN confidence", { confidence: NaN, priorities: ["save-more"] }],
  ["confidence 9", { confidence: 9, priorities: ["save-more"] }],
  ["mixed case", { priorities: ["Save-More", "SAVE-MORE", "save-more"], household: "Alone" }],
  ["nested arrays", { priorities: [["save-more"], [[["save-more"]]], "save-more"] }],
])("hostile profile neutralised: %s", (_n, profile) => {
  const out = sanitizeChatContext("overview", { profile });
  const p = out.profile as Record<string, unknown> | undefined;
  expect(Object.keys(p ?? {}).every((k) => k !== "__proto__" && k !== "constructor")).toBe(true);
  expect(Object.getPrototypeOf(p ?? {})).toBe(Object.prototype);
  expect(JSON.stringify(out)).not.toMatch(/Save|SAVE|"3"|x\d|\[\[/);
  if (p) {
    expect(p.priorities).toEqual(["save-more"]);
    expect(p.confidence ?? null).toBeNull();
    expect(p.household ?? null).toBeNull();
    expect(Object.keys(p).sort()).toEqual(
      ["priorities","cutTargets","checkInCadence","confidence","household","moneySharing","incomeRegularity","spendMix","cardRepayment","pointsGoal"].sort(),
    );
  }
});

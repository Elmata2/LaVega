import { describe, expect, test } from "vitest";
import { classifySetupMail, normalizeInboundMail } from "./normalizeInboundMail.js";
import {
  EXPECTED_CODE,
  EXTRA_LOCALE_FIXTURES,
  FIXTURE_IS_REAL,
  GMAIL_CONFIRMATION_PAYLOAD,
} from "./__fixtures__/gmailConfirmation.test.fixture.js";
import { INBOUND_PLAIN_TEXT } from "./__fixtures__/inboundPayload.js";

const FIXTURE_LABEL = FIXTURE_IS_REAL ? "REAL capture" : "SYNTHETIC fixture (shape UNVERIFIED)";

/* The Gmail confirmation tests read the fixture, never a string typed here.
 * The shape of the SYNTHETIC one is a guess; the release task refuses to ship
 * while it is the only one. Set REQUIRE_REAL_GMAIL_FIXTURE=1 to enforce. */
test.skipIf(process.env.REQUIRE_REAL_GMAIL_FIXTURE !== "1")(
  "the Gmail fixture is a real capture, not the SYNTHETIC stand-in (skipped without REQUIRE_REAL_GMAIL_FIXTURE=1; gmail-forwarding-confirmation.SYNTHETIC.json is driving the tests)",
  () => {
    expect(FIXTURE_IS_REAL).toBe(true);
  },
);

describe(`Gmail confirmation, ${FIXTURE_LABEL}`, () => {
  test("a Gmail forwarding confirmation is recognised and yields only its code", () => {
    const m = normalizeInboundMail(GMAIL_CONFIRMATION_PAYLOAD);
    expect(m.setup).toEqual({ kind: "forwarding-confirmation", code: EXPECTED_CODE });
    // Routed away from Claude: the If-node sends ok:false to "Melding: zelf ophalen".
    expect(m.ok).toBe(false);
    expect(m.reason).toBe("");
  });

  test("the signal carries the code and nothing from the body, least of all a link", () => {
    const m = normalizeInboundMail(GMAIL_CONFIRMATION_PAYLOAD);
    expect(Object.keys(m.setup!).sort()).toEqual(["code", "kind"]);
    expect(JSON.stringify(m.setup)).not.toMatch(/https?:/);
  });

  test("a lookalike from another sender is NOT a confirmation and still reaches the model", () => {
    for (const from of [
      "forwarding-noreply@google.com.evil.example",
      "forwarding-noreply@gmail.com",
      "Google <forwarding-noreply@g00gle.com>",
      "evil@example.com",
    ]) {
      const m = normalizeInboundMail({ ...GMAIL_CONFIRMATION_PAYLOAD, from });
      expect(m.setup, from).toBeNull();
    }
  });

  for (const f of EXTRA_LOCALE_FIXTURES) {
    test(`second-locale fixture (${f.locale}) is recognised with its code`, () => {
      expect(normalizeInboundMail(f.payload).setup).toEqual({
        kind: "forwarding-confirmation",
        code: f.expectedCode,
      });
    });
  }
});

test("a display-name From still matches when the address is Google's", () => {
  expect(
    classifySetupMail({
      from: "Gmail Team <Forwarding-NoReply@Google.com>",
      subject: "(#42) x",
      text: "Confirmation code: 42",
    }),
  ).toEqual({ kind: "forwarding-confirmation", code: "42" });
});

test("a code with letters, or longer than 20 digits, is rejected", () => {
  const base = { from: "forwarding-noreply@google.com", subject: "hello" };
  expect(classifySetupMail({ ...base, text: "Confirmation code: 12ab34" })).toBeNull();
  expect(classifySetupMail({ ...base, text: "Confirmation code: " + "1".repeat(21) })).toBeNull();
  expect(
    classifySetupMail({ ...base, text: "Confirmation code: " + "1".repeat(20) })?.code,
  ).toHaveLength(20);
  expect(classifySetupMail({ ...base, text: "no label and no digits at all" })).toBeNull();
});

test("two different codes in one mail are ambiguous and rejected, never guessed", () => {
  expect(
    classifySetupMail({
      from: "forwarding-noreply@google.com",
      subject: "(#111111) Gmail Forwarding Confirmation",
      text: "Confirmation code: 222222",
    }),
  ).toBeNull();
});

test("the Dutch Gmail wording is recognised (UNVERIFIED wording, written from memory)", () => {
  expect(
    classifySetupMail({
      from: "forwarding-noreply@google.com",
      subject: "Bevestiging voor doorsturen in Gmail",
      text: "Bevestigingscode: 987654321\n\nKlik op de link om te bevestigen.",
    }),
  ).toEqual({ kind: "forwarding-confirmation", code: "987654321" });
});

test("a mail whose subject is LaVega test factuur <code> is a setup-test, code lowercased", () => {
  const m = normalizeInboundMail({ ...INBOUND_PLAIN_TEXT, subject: "LaVega test factuur K3X9" });
  expect(m.setup).toEqual({ kind: "setup-test", code: "k3x9" });
  expect(m.ok).toBe(false);
  expect(m.reason).toBe("");
});

test("the subject still classifies with 'factuur ' absent", () => {
  expect(classifySetupMail({ from: "x@y.nl", subject: "LaVega test K3X9", text: "" })).toEqual({
    kind: "setup-test",
    code: "k3x9",
  });
});

test("forward prefixes do not hide a test subject", () => {
  for (const subject of [
    "Fwd: LaVega test factuur ab12",
    "FW: LaVega test ab12",
    "Re: Fwd: lavega test factuur ab12",
  ]) {
    expect(classifySetupMail({ from: "me@example.com", subject, text: "" }), subject).toEqual({
      kind: "setup-test",
      code: "ab12",
    });
  }
});

test("a test code must be exactly four [a-z0-9] characters", () => {
  for (const subject of [
    "LaVega test factuur ab1",
    "LaVega test factuur ab123",
    "LaVega test factuur ab-1",
    "LaVega testab12",
  ]) {
    expect(classifySetupMail({ from: "x@y.nl", subject, text: "" }), subject).toBeNull();
  }
});

test("an ordinary invoice that mentions a test in its body still goes to the model", () => {
  const m = normalizeInboundMail({
    ...INBOUND_PLAIN_TEXT,
    subject: "Factuur HN-2026-4412",
    text: INBOUND_PLAIN_TEXT.text + "\n\nDit is geen LaVega test ab12, maar een echte factuur.",
  });
  expect(m.setup).toBeNull();
  expect(m.ok).toBe(true);
});

test("an ordinary invoice keeps setup null and its old behaviour", () => {
  const m = normalizeInboundMail(INBOUND_PLAIN_TEXT);
  expect(m.setup).toBeNull();
  expect(m.ok).toBe(true);
});

test("an empty payload has no setup signal and does not throw", () => {
  expect(normalizeInboundMail({}).setup).toBeNull();
});

test("a spoofed display name around Google's address does not classify", () => {
  expect(
    classifySetupMail({
      from: '"forwarding-noreply@google.com" <evil@x.com>',
      subject: "(#42) x",
      text: "Confirmation code: 42",
    }),
  ).toBeNull();
});

test("a pathological body of label plus 100k spaces finishes fast and does not classify", () => {
  const text = "confirmation code" + " ".repeat(100_000) + "!";
  const start = performance.now();
  const m = normalizeInboundMail({
    ...GMAIL_CONFIRMATION_PAYLOAD,
    subject: "hello",
    text,
    html: "",
  });
  expect(performance.now() - start).toBeLessThan(50);
  expect(m.setup).toBeNull();
});

test("regex-only ReDoS: confirmation code + 100k spaces + ! finishes fast without the text cap", () => {
  const text = "confirmation code" + " ".repeat(100_000) + "!";
  const t0 = performance.now();
  const r = classifySetupMail({
    from: "forwarding-noreply@google.com",
    subject: "Gmail Forwarding Confirmation",
    text,
  });
  expect(performance.now() - t0).toBeLessThan(200);
  expect(r).toBeNull();
});

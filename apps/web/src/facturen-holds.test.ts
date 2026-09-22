import { expect, test } from "vitest";
import { holdSentence } from "./views/Facturen";
import { AUTO_BOOK_CEILING_CENTS, type AutoBookHold, type InvoiceGap } from "./n8n.js";
import { adminCopy } from "./copy/admin.js";
import type { Locale } from "./locale.js";

/* THE WIRE BETWEEN THE ENGINE AND THE SENTENCE.
 *
 * The decision used to build its own Dutch sentence, so one test covered both
 * the verdict and the words. Splitting them put a switch in between that
 * nothing watched: a review proved that swapping senderForwarded and
 * senderFailed inside it passed the entire suite. That swap is the forwarding
 * rule regression this copy exists to prevent, shipping green.
 *
 * So every kind is pinned here to a fragment that appears in ITS sentence and
 * in no other, in both languages. */

const CHECKS = { spf: "softfail", dkim: "pass", dmarc: "fail" };

const UNIQUE: Array<[AutoBookHold, Record<Locale, string>]> = [
  [
    { kind: "sender-forwarded", checks: CHECKS },
    { nl: "niet bij een nagemaakte afzender", en: "not to a faked sender" },
  ],
  [
    { kind: "sender-failed", checks: CHECKS },
    { nl: "óf een nagemaakte afzender", en: "or a faked sender" },
  ],
  [
    { kind: "sender-unchecked" },
    { nl: "geen afzendercontrole gedaan", en: "No sender check was run" },
  ],
  [{ kind: "entity-ambiguous" }, { nl: "meer dan één onderneming", en: "more than one company" }],
  [
    { kind: "incomplete", gap: "currency" },
    { nl: "gokt geen euro's", en: "does not assume euros" },
  ],
  [
    { kind: "over-ceiling", ceilingCents: AUTO_BOOK_CEILING_CENTS },
    { nl: "€ 10.000", en: "€10,000" },
  ],
];

test.each(UNIQUE)("%o renders its own sentence and no other", (hold, expected) => {
  for (const locale of ["nl", "en"] as const) {
    const c = adminCopy[locale].facturen;
    expect(holdSentence(c, hold)).toContain(expected[locale]);
    for (const [other, otherExpected] of UNIQUE) {
      if (other.kind === hold.kind) continue;
      expect(holdSentence(c, hold)).not.toContain(otherExpected[locale]);
    }
  }
});

/* Every gap must reach its OWN sentence. Telling the owner to fill in a
 *  counterparty when the currency is missing sends him to the wrong field. */
test.each(["counterparty", "issue-date", "due-date", "amount", "currency", "vat"] as const)(
  "the %s gap reaches its own sentence",
  (gap: InvoiceGap) => {
    for (const locale of ["nl", "en"] as const) {
      const c = adminCopy[locale].facturen;
      const sentence = holdSentence(c, { kind: "incomplete", gap });
      expect(sentence).toContain(c.queue.holds.gaps[gap]);
      for (const other of [
        "counterparty",
        "issue-date",
        "due-date",
        "amount",
        "currency",
        "vat",
      ] as const) {
        if (other === gap) continue;
        expect(sentence).not.toContain(c.queue.holds.gaps[other]);
      }
    }
  },
);

/* THE CEILING IS A MONEY DECISION, NOT A CONSTANT.
 *
 * Above this, nothing books itself without the owner seeing it. The old suite
 * pinned the value because it asserted on the generated sentence; the new one
 * compared the constant against itself and would have let a one-token edit
 * raise the unattended exposure tenfold. */
test("the auto-book ceiling is EUR 10.000 and says so in both languages", () => {
  expect(AUTO_BOOK_CEILING_CENTS).toBe(1_000_000);
  expect(
    holdSentence(adminCopy.nl.facturen, {
      kind: "over-ceiling",
      ceilingCents: AUTO_BOOK_CEILING_CENTS,
    }),
  ).toContain("€ 10.000");
  expect(
    holdSentence(adminCopy.en.facturen, {
      kind: "over-ceiling",
      ceilingCents: AUTO_BOOK_CEILING_CENTS,
    }),
  ).toContain("€10,000");
});

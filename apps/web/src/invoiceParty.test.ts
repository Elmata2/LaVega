import { expect, test } from "vitest";
import { resolveInvoiceParties } from "./invoiceParty.js";

/* THE BUG THIS FILE EXISTS FOR, measured 17 Sep 2026 against the real API.
 *
 * mistral-small AND mistral-medium, given the extraction prompt and two
 * invoices, both answered `direction: "out"` every time and named the ISSUER as
 * counterparty every time:
 *
 *   he bills a client (money IN)  → "out", counterparty = his own BV
 *   KPN bills him    (money OUT)  → "out", counterparty = KPN
 *
 * The second is right by accident. The first books his revenue as a cost,
 * because Facturen renders `direction === "in" ? amount : -amount`.
 *
 * Both cases below are those two invoices. If this file ever goes green while
 * the sales case resolves to "purchase", the regression is back. */

const OWN = {
  ibans: ["NL91 ABNA 0417 1643 00"],
  entityNames: ["Steunenberg Holding"],
};

test("an invoice he SENT is money in, and the counterparty is his client", () => {
  const r = resolveInvoiceParties(
    { seller: "Steunenberg Holding B.V.", buyer: "Penshee B.V." },
    OWN,
  );
  expect(r.kind).toBe("sales");
  expect(r.counterparty).toBe("Penshee B.V.");
  /* Never his own name. That is what the model returned here, and it is the
   * most visible half of the bug. */
  expect(r.counterparty).not.toContain("Steunenberg");
});

test("an invoice he RECEIVED is money out, and the counterparty is the supplier", () => {
  const r = resolveInvoiceParties({ seller: "KPN B.V.", buyer: "Steunenberg Holding B.V." }, OWN);
  expect(r.kind).toBe("purchase");
  expect(r.counterparty).toBe("KPN B.V.");
});

/* The IBAN is checked before any name, because it is the only unambiguous
 * field on the page. Here the seller's printed name matches nothing he has —
 * a trading name, a rebrand, a translation — and the account still settles it. */
test("the payee IBAN settles it even when no name matches", () => {
  const r = resolveInvoiceParties(
    { seller: "Elmata Trading", buyer: "Penshee B.V.", payeeIban: "NL91ABNA0417164300" },
    OWN,
  );
  expect(r.kind).toBe("sales");
  expect(r.counterparty).toBe("Penshee B.V.");
  expect(r.because).toBe("payee-iban");
});

test("IBAN matching ignores the spacing invoices print them with", () => {
  for (const printed of ["NL91ABNA0417164300", "NL91 ABNA 0417 1643 00", "nl91abna0417164300"])
    expect(
      resolveInvoiceParties({ seller: "X", buyer: "Y", payeeIban: printed }, OWN).kind,
      printed,
    ).toBe("sales");
});

test("a payee IBAN that is NOT his does not make it a sale", () => {
  const r = resolveInvoiceParties(
    { seller: "KPN B.V.", buyer: "Steunenberg Holding B.V.", payeeIban: "NL02INGB0123456789" },
    OWN,
  );
  expect(r.kind).toBe("purchase");
});

test("a legal-form suffix on one side only still matches", () => {
  expect(
    resolveInvoiceParties({ seller: "Steunenberg Holding B.V.", buyer: "Klant" }, OWN).kind,
  ).toBe("sales");
  expect(resolveInvoiceParties({ seller: "Klant", buyer: "Steunenberg Holding" }, OWN).kind).toBe(
    "purchase",
  );
});

/* THE ANSWER THAT IS ALLOWED TO BE "I DON'T KNOW".
 *
 * Nothing on the document matches anything he has. The old code defaulted to
 * "out" here, which is exactly how a sales invoice became a cost. */
test("no match leaves the direction unset rather than guessing", () => {
  const r = resolveInvoiceParties({ seller: "Acme GmbH", buyer: "Globex Ltd" }, OWN);
  expect(r.kind).toBe("unknown");
  expect(r.because).toBe("no-match");
  /* And NO counterparty. Prefilling the seller looked helpful until his own
   * outgoing invoice made the seller himself — the form then offered his own
   * name as the other party. Facturen fills this once he picks a direction. */
  expect(r.counterparty).toBe("");
});

/* An invoice between two of his OWN entities. Picking a side here would turn an
 * internal transfer into revenue, which is the single worst outcome on this
 * screen — it inflates turnover and it inflates the VAT set-aside. */
test("an invoice between two of his own entities resolves to unknown, not to a sale", () => {
  const r = resolveInvoiceParties(
    { seller: "Steunenberg Holding B.V.", buyer: "Steunenberg Werk B.V." },
    { ibans: [], entityNames: ["Steunenberg Holding", "Steunenberg Werk"] },
  );
  expect(r.kind).toBe("unknown");
});

/* A SHORT LABEL MUST NOT MATCH BY CONTAINMENT.
 *
 * "BV1" is a real entity label in this repo's fixtures. Normalised it becomes
 * "bv1"; without a length floor, substring matching would fire on any company
 * name containing it, and a false match here does not look like a bug — it
 * books the invoice the wrong way round. */
test("a three-character entity label does not match by substring", () => {
  const own = { ibans: [], entityNames: ["BV1"] };
  expect(resolveInvoiceParties({ seller: "ABV1000 Systems", buyer: "Klant" }, own).kind).toBe(
    "unknown",
  );
  /* It still matches itself exactly. */
  expect(resolveInvoiceParties({ seller: "BV1", buyer: "Klant" }, own).kind).toBe("sales");
});

/* THE REGRESSION THE FIRST VERSION SHIPPED WITH, found in review.
 *
 * `entity` is free text the owner types at onboarding, so "Holding" or "Werk"
 * is a realistic label — and under the original four-character floor, "holding"
 * matched by substring into "Van der Berg Holding B.V.", a company he has never
 * heard of. The screen then showed a confident direction and counterparty for
 * an invoice between two strangers, instead of asking him.
 *
 * This is the wrong-column failure the whole file exists to prevent, so it gets
 * pinned in both directions rather than left to the implementation comment. */
test("a one-word entity label never matches a stranger by substring", () => {
  const own = { ibans: [], entityNames: ["Holding"] };
  expect(
    resolveInvoiceParties(
      { seller: "Zonnepanelen Leverancier B.V.", buyer: "Van der Berg Holding B.V." },
      own,
    ).kind,
  ).toBe("unknown");
  /* And the mirror image: a collision on the SELLER side would book a
   * stranger's bill as his own revenue. */
  expect(
    resolveInvoiceParties(
      { seller: "Van der Berg Holding B.V.", buyer: "Zonnepanelen Leverancier B.V." },
      own,
    ).kind,
  ).toBe("unknown");
  /* The label still matches itself exactly, so a real entity called "Holding"
   * is not locked out — it just cannot match by containment. */
  expect(resolveInvoiceParties({ seller: "Holding B.V.", buyer: "Klant" }, own).kind).toBe("sales");
});

/* Two words is the threshold, and this is the case containment was added for:
 * the vault label omits the legal form the invoice prints. */
test("a two-word label still matches the same name with a legal form attached", () => {
  const own = { ibans: [], entityNames: ["Steunenberg Holding"] };
  expect(
    resolveInvoiceParties({ seller: "Steunenberg Holding B.V.", buyer: "Klant" }, own).kind,
  ).toBe("sales");
});

/* An accent typed one way in the vault and another on the invoice is not a
 * different company. Falls back to a manual pick rather than a wrong one, but
 * there is no reason to make him do that work. */
test("diacritics do not prevent a match", () => {
  const own = { ibans: [], entityNames: ["Munchen Advies"] };
  expect(resolveInvoiceParties({ seller: "München Advies B.V.", buyer: "Klant" }, own).kind).toBe(
    "sales",
  );
});

test("an owner with nothing recorded yet always gets unknown, never a guess", () => {
  const r = resolveInvoiceParties(
    { seller: "KPN B.V.", buyer: "Steunenberg Holding B.V." },
    { ibans: [], entityNames: [] },
  );
  expect(r.kind).toBe("unknown");
});

test("empty printed names never match an empty entity label", () => {
  const r = resolveInvoiceParties({ seller: "", buyer: "" }, { ibans: [], entityNames: [""] });
  expect(r.kind).toBe("unknown");
});

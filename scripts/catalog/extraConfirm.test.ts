import { describe, expect, it } from "vitest";
import type { ConfirmOutcome } from "./catalogConfirm.js";
import { sameDocument } from "./catalogConfirm.js";
import { judgeField } from "@lavega/core";
import { parseFigureReply } from "./catalogFigure.js";
import {
  decideExtra,
  decideMissing,
  decideOpen,
  decideZeroFee,
  isHeldZeroFee,
  judgeDocument,
  judgeMissingDocument,
  firstFigureNeedsName,
  issuerKey,
  MIN_ABSENCE_DOC_CHARS,
  otherIssuerProducts,
  recordUrls,
  siblingsOnRecord,
  stopBeforeRead,
  wantsOpenQuestion,
} from "./extraConfirm.js";

const long = (extra = "") => `${"Algemene tekst over betalen en sparen. ".repeat(40)}${extra}`;

const base = {
  label: "points",
  field: "pointsPerEuro" as const,
  value: 0,
  product: "ING Creditcard More",
  issuer: "ING Bank N.V.",
  maxChars: 200_000,
};

describe("stopBeforeRead", () => {
  it("model off is not checked", () => {
    expect(
      stopBeforeRead({ label: "fee", useAgent: false, sourceUrl: "https://a.nl" }),
    ).toMatchObject({
      fetched: false,
    });
  });
  it("a hand-entered source is not asked", () => {
    expect(
      stopBeforeRead({ label: "fee", useAgent: true, sourceUrl: "user:eigenaar" })?.reason,
    ).toContain("no source");
  });
  it("a web source with the model on proceeds", () => {
    expect(
      stopBeforeRead({ label: "fee", useAgent: true, sourceUrl: "https://a.nl/x" }),
    ).toBeNull();
  });
});

describe("judgeDocument", () => {
  it("an absence on a short document is not checked", () => {
    const r = judgeDocument({ ...base, text: "x".repeat(MIN_ABSENCE_DOC_CHARS - 1) });
    expect(r.stop).toMatchObject({ fetched: false });
    expect(r.zeroByAbsence).toBe(true);
  });
  it("an absence on a long document that does not name the product is not checked", () => {
    const r = judgeDocument({ ...base, text: long("Over de ING Creditcard Extra") });
    expect(r.stop).toMatchObject({ fetched: true, reason: "document does not name the product" });
  });
  it("an absence on a long document that names the product proceeds with zeroByAbsence", () => {
    const r = judgeDocument({ ...base, text: long("De ING Creditcard More spaart geen punten.") });
    expect(r).toEqual({ stop: null, zeroByAbsence: true });
  });
  it("a longer sibling name does not name the product", () => {
    const r = judgeDocument({
      ...base,
      product: "ING Creditcard",
      siblings: ["ING Creditcard More"],
      text: long("De ING Creditcard More spaart geen punten."),
    });
    expect(r.stop).toMatchObject({ reason: "document does not name the product" });
  });
  it("the name without the issuer prefix counts", () => {
    const r = judgeDocument({ ...base, text: long("De creditcard more is gratis.") });
    expect(r.stop).toBeNull();
  });
  it("a figure above zero needs no name and no length", () => {
    const r = judgeDocument({ ...base, value: 1, text: "kort" });
    expect(r).toEqual({ stop: null, zeroByAbsence: false });
  });
  it("a fee of zero is not an absence", () => {
    const r = judgeDocument({ ...base, field: "accountFee", label: "fee", text: "kort" });
    expect(r.zeroByAbsence).toBe(false);
    expect(r.stop).toBeNull();
  });
  it("an oversize document names its own cause", () => {
    const r = judgeDocument({
      ...base,
      value: 4,
      field: "accountFee",
      maxChars: 100,
      text: "x".repeat(300),
    });
    expect(r.stop?.reason).toMatch(/^document too large/);
    expect(r.stop?.fetched).toBe(true);
  });
});

describe("decideExtra", () => {
  const reply = (r: object) => ({ kind: "reply", reply: r }) as never;
  it("still_stated confirms by quote check", () => {
    expect(
      decideExtra({
        label: "fee",
        outcome: reply({ status: "still_stated", quote: "q" }),
        why: "",
      }),
    ).toMatchObject({
      kind: "confirmed",
      by: "quote-check",
    });
  });
  it("none_stated confirms by no programme found", () => {
    expect(
      decideExtra({ label: "points", outcome: reply({ status: "none_stated" }), why: "" }),
    ).toMatchObject({
      kind: "confirmed",
      by: "no-programme-found",
    });
  });
  it("changed, not_on_page, rejected and failed do not confirm", () => {
    for (const outcome of [
      reply({ status: "changed", quote: "q", newValue: 5 }),
      reply({ status: "not_on_page" }),
      { kind: "rejected" },
      { kind: "failed" },
    ] as never[]) {
      expect(decideExtra({ label: "fee", outcome, why: "reply rejected" }).kind).toBe(
        "not-checked",
      );
    }
    expect(
      decideExtra({
        label: "fee",
        outcome: reply({ status: "changed", quote: "q", newValue: 5 }),
        why: "",
      }),
    ).toMatchObject({ note: "fee: confirm: changed to 5 (not published)" });
  });
});

describe("decideOpen", () => {
  const changed = (newValue: number): ConfirmOutcome => ({
    kind: "reply",
    reply: { status: "changed", quote: "q", newValue },
  });
  const notOnPage: ConfirmOutcome = { kind: "reply", reply: { status: "not_on_page" } };
  const stored = { value: 4, period: "maand" as const };
  const found = (value: number, over = {}) => ({
    value,
    period: "maand" as const,
    covered: true,
    ...over,
  });

  it("only a changed or not_on_page confirm asks the open question", () => {
    expect(wantsOpenQuestion(changed(5))).toBe(true);
    expect(wantsOpenQuestion(notOnPage)).toBe(true);
    expect(
      wantsOpenQuestion({ kind: "reply", reply: { status: "still_stated", quote: "q" } }),
    ).toBe(false);
    expect(wantsOpenQuestion({ kind: "failed" })).toBe(false);
    expect(wantsOpenQuestion({ kind: "rejected" })).toBe(false);
  });

  it("a confirm that changed a fee to 0 says a person must check it", () => {
    expect(
      decideOpen({
        label: "fee",
        field: "accountFee",
        stored,
        outcome: changed(0),
        found: null,
      }),
    ).toEqual({
      kind: "not-checked",
      note: "fee: confirm: changed to 0; a zero fee needs a person",
    });
    expect(
      decideOpen({
        label: "points",
        field: "pointsPerEuro",
        stored: { value: 2 },
        outcome: changed(0),
        found: null,
      }).note,
    ).toBe("points: confirm: changed to 0, open question found no figure");
  });

  it("no answer leaves the figure not checked", () => {
    expect(
      decideOpen({ label: "fee", field: "accountFee", stored, outcome: notOnPage, found: null }),
    ).toEqual({
      kind: "not-checked",
      note: "fee: confirm: not on page, open question found no figure",
    });
    expect(
      decideOpen({ label: "fee", field: "accountFee", stored, outcome: changed(5), found: null }),
    ).toMatchObject({ kind: "not-checked", note: expect.stringContaining("changed to 5") });
  });

  it("a read that agrees with the confirm change goes to the guard as a cross-checked change", () => {
    expect(
      decideOpen({
        label: "fee",
        field: "accountFee",
        stored,
        outcome: changed(5),
        found: found(5),
      }),
    ).toMatchObject({ kind: "read", storedCheck: "gone", confirmedBy: null });
  });

  it("a read that differs from the confirm change is unresolved", () => {
    expect(
      decideOpen({
        label: "fee",
        field: "accountFee",
        stored,
        outcome: changed(6),
        found: found(5),
      }),
    ).toMatchObject({ kind: "read", storedCheck: "unresolved" });
  });

  it("not_on_page with a different read means the stored figure is gone", () => {
    expect(
      decideOpen({
        label: "fee",
        field: "accountFee",
        stored,
        outcome: notOnPage,
        found: found(5),
      }),
    ).toMatchObject({ kind: "read", storedCheck: "gone" });
  });

  it("the same value in another period is a change", () => {
    expect(
      decideOpen({
        label: "fee",
        field: "accountFee",
        stored,
        outcome: notOnPage,
        found: found(4, { period: "jaar" }),
      }),
    ).toMatchObject({ kind: "read", storedCheck: "gone", confirmedBy: null });
  });

  it("the stored figure read again is a confirmation", () => {
    expect(
      decideOpen({
        label: "fee",
        field: "accountFee",
        stored,
        outcome: notOnPage,
        found: found(4),
      }),
    ).toMatchObject({ kind: "read", storedCheck: null, confirmedBy: "read-again" });
  });

  it("a changed confirm and an open read of the stored figure are conflicting reads", () => {
    const expected = {
      kind: "not-checked",
      note: "fee: conflicting reads: confirm said changed to 5, open read found the stored figure",
    };
    expect(
      decideOpen({
        label: "fee",
        field: "accountFee",
        stored,
        outcome: changed(5),
        found: found(4),
      }),
    ).toEqual(expected);
    expect(
      decideOpen({
        label: "fee",
        field: "accountFee",
        stored,
        outcome: changed(5),
        found: found(4, { covered: false }),
      }),
    ).toEqual(expected);
  });

  it("not_on_page then a covered read of the stored figure confirms it", () => {
    expect(
      decideOpen({
        label: "fee",
        field: "accountFee",
        stored,
        outcome: notOnPage,
        found: found(4),
      }),
    ).toMatchObject({ kind: "read", confirmedBy: "read-again", storedCheck: null });
  });

  it("not_on_page then an uncovered read of the stored figure is not checked", () => {
    expect(
      decideOpen({
        label: "fee",
        field: "accountFee",
        stored,
        outcome: notOnPage,
        found: found(4, { covered: false }),
      }),
    ).toMatchObject({ kind: "not-checked" });
  });

  it("a read without known conditions goes on without a cross-check", () => {
    expect(
      decideOpen({
        label: "fee",
        field: "accountFee",
        stored,
        outcome: notOnPage,
        found: found(5, { covered: false }),
      }),
    ).toMatchObject({ kind: "read", storedCheck: null, confirmedBy: null });
  });
});

describe("a held zero fee", () => {
  const found = (over = {}) => ({ value: 6.5, period: "maand" as const, covered: true, ...over });

  it("only an account fee of 0 is a held zero fee", () => {
    expect(isHeldZeroFee("accountFee", 0)).toBe(true);
    expect(isHeldZeroFee("accountFee", 4)).toBe(false);
    expect(isHeldZeroFee("pointsPerEuro", 0)).toBe(false);
    expect(isHeldZeroFee("cashbackPct", 0)).toBe(false);
  });

  it("a covered non-zero read is a real change for the guard", () => {
    expect(decideZeroFee({ label: "fee", found: found() })).toEqual({
      kind: "read",
      storedCheck: "gone",
      confirmedBy: null,
      note: "fee: stored 0, open question read 6.5 per maand, change left to the guard",
    });
  });

  it("no read, an uncovered read or a read without a period needs a person", () => {
    const needs = {
      kind: "not-checked",
      zeroFeeNeedsPerson: true,
      note: "fee: zero fee needs a person",
    };
    expect(decideZeroFee({ label: "fee", found: null })).toEqual(needs);
    expect(decideZeroFee({ label: "fee", found: found({ covered: false }) })).toEqual(needs);
    expect(decideZeroFee({ label: "fee", found: found({ period: undefined }) })).toEqual(needs);
  });

  it("a zero is never read back: a found 0 needs a person", () => {
    expect(decideZeroFee({ label: "fee", found: found({ value: 0 }) })).toMatchObject({
      kind: "not-checked",
      zeroFeeNeedsPerson: true,
    });
  });

  it("the guard puts 0 -> x in pending and publishes only on a second weekly read", () => {
    const d = decideZeroFee({ label: "fee", found: found() });
    if (d.kind !== "read") throw new Error("expected a read");
    const stored = {
      value: 0,
      period: "maand" as const,
      route: "agent" as const,
      sourceUrl: "https://www.ing.nl/tarieven",
      checkedAt: "2026-11-01",
      conditions: null,
      conditionsKnown: true,
    };
    const read = { ...stored, value: 6.5, checkedAt: "2026-11-24", conditions: "kaart" };
    const knownHosts = new Set(["www.ing.nl"]);
    const first = judgeField({
      field: "accountFee",
      current: stored,
      found: read,
      knownHosts,
      pending: undefined,
      today: "2026-11-24",
      storedCheck: d.storedCheck ?? undefined,
    });
    expect(first).toEqual({
      kind: "pending",
      pending: { value: 6.5, period: "maand", seenAt: "2026-11-24" },
    });
    const second = judgeField({
      field: "accountFee",
      current: stored,
      found: { ...read, checkedAt: "2026-12-01" },
      knownHosts,
      pending: first.kind === "pending" ? first.pending : undefined,
      today: "2026-12-01",
      storedCheck: d.storedCheck ?? undefined,
    });
    expect(second).toEqual({ kind: "publish", viaPending: true });
    const otherPeriod = judgeField({
      field: "accountFee",
      current: stored,
      found: { ...read, period: "jaar" },
      knownHosts,
      pending: first.kind === "pending" ? first.pending : undefined,
      today: "2026-12-01",
      storedCheck: d.storedCheck ?? undefined,
    });
    expect(otherPeriod.kind).toBe("pending");
  });
});

describe("decideMissing", () => {
  const found = { value: 6.5, period: "maand" as const, covered: true };
  it("a covered answer is a first figure", () => {
    const d = decideMissing({ label: "fee", field: "accountFee", found });
    expect(d.kind).toBe("first");
  });
  it("no answer is no figure yet", () => {
    expect(decideMissing({ label: "points", field: "pointsPerEuro", found: null })).toMatchObject({
      kind: "not-checked",
    });
  });
  it("an answer without known conditions is not published", () => {
    const d = decideMissing({
      label: "fee",
      field: "accountFee",
      found: { ...found, covered: false },
    });
    expect(d.kind).toBe("not-checked");
  });
  it("a fee without a period is not a first figure", () => {
    const d = decideMissing({
      label: "fee",
      field: "accountFee",
      found: { value: 6.5, covered: true },
    });
    expect(d.kind).toBe("not-checked");
  });
  it("a reply of 0 never reaches the decision: the parser drops it, so the fee stays no-figure-yet", () => {
    const text = "Kosten per maand: € 0,00 voor de ING Creditcard.";
    const figure = parseFigureReply(
      {
        value: 0,
        period: "maand",
        conditions: null,
        conditionsKnown: true,
        unconditionalBasis: "stated",
        quote: "Kosten per maand: € 0,00 voor de ING Creditcard",
      },
      {
        product: "ING Creditcard",
        issuer: "ING",
        field: "accountFee",
        sourceUrl: "https://x.nl",
        text,
      },
    );
    expect(figure).toBeNull();
    expect(decideMissing({ label: "fee", field: "accountFee", found: null })).toEqual({
      kind: "not-checked",
      note: "fee: no figure on file, open question found none",
    });
  });
  it("a missing figure is never filled with a zero for points or cashback by silence", () => {
    expect(decideMissing({ label: "cashback", field: "cashbackPct", found: null }).kind).toBe(
      "not-checked",
    );
  });
});

describe("record urls and siblings", () => {
  const products = {
    a: { product: "Card A", docUrl: "https://x.nl/t.pdf" },
    b: { product: "Card B", pdfUrl: "https://x.nl/t.pdf" },
    c: { product: "Card C", docUrl: "https://x.nl/other" },
    d: { product: "Card D" },
  };
  it("lists the record urls in order, without blanks", () => {
    expect(recordUrls({ docUrl: "u1", foundUrl: "u3", termsUrl: "u4", pdfUrl: "u2" })).toEqual([
      "u1",
      "u2",
      "u3",
      "u4",
    ]);
    expect(recordUrls({ docUrl: null, termsUrl: undefined })).toEqual([]);
  });
  it("siblings are the other products sharing the document", () => {
    expect(siblingsOnRecord("a", "https://x.nl/t.pdf", products)).toEqual(["Card B"]);
    expect(siblingsOnRecord("c", "https://x.nl/other", products)).toEqual([]);
  });
});

describe("judgeMissingDocument", () => {
  const input = {
    label: "fee",
    product: "ING Go",
    issuer: "ING Bank N.V.",
    siblings: ["ING More"],
    maxChars: 200_000,
  };
  it("a document that does not name the product gives no question", () => {
    const r = judgeMissingDocument({ ...input, text: long("Over ING More en ING Extra") });
    expect(r).toMatchObject({ fetched: true, reason: "document does not name the product" });
  });
  it("a document that names the product proceeds", () => {
    expect(judgeMissingDocument({ ...input, text: long("De ING Go kost iets.") })).toBeNull();
  });
  it("a document that is too large is not asked", () => {
    const r = judgeMissingDocument({ ...input, maxChars: 10, text: "De ING Go kost iets." });
    expect(r?.reason).toContain("document too large");
  });
});

describe("the same document", () => {
  it("differs only by fragment, trailing slash or host case", () => {
    expect(sameDocument("https://X.nl/t.pdf#page=2", "https://x.nl/t.pdf")).toBe(true);
    expect(sameDocument("https://x.nl/tarieven/", "https://X.nl/tarieven")).toBe(true);
    expect(sameDocument("https://x.nl/t?a=1", "https://x.nl/t?a=2")).toBe(false);
    expect(sameDocument("https://x.nl/t.pdf", "https://x.nl/other.pdf")).toBe(false);
  });
  it("siblings group by the normalised address", () => {
    const products = {
      a: { product: "Card A", docUrl: "https://x.nl/t.pdf#p1" },
      b: { product: "Card B", pdfUrl: "https://X.nl/t.pdf" },
      c: { product: "Card C", docUrl: "https://x.nl/t/" },
    };
    expect(siblingsOnRecord("a", "https://x.nl/t.pdf", products)).toEqual(["Card B"]);
    expect(siblingsOnRecord("c", "https://x.nl/t", products)).toEqual([]);
  });
});

describe("a first figure is bound to its product", () => {
  const ING = ["ING Go", "ING More", "ING Extra", "ING Max"];
  const ROW =
    "Betaalpakketten            ING Go                 ING More               ING Extra                ING Max\n\n Kosten per maand           € 4,00                 € 7,00                 € 15,99                  € 44,99";
  const amounts: Record<string, number> = {
    "ING Go": 4,
    "ING More": 7,
    "ING Extra": 15.99,
    "ING Max": 44.99,
  };
  const reply = (value: number) => ({
    value,
    period: "maand",
    conditions: "per pakket",
    conditionsKnown: true,
    quote: ROW,
  });
  const req = (product: string) => ({
    product,
    issuer: "ING Bank N.V.",
    field: "accountFee" as const,
    sourceUrl: "https://x.nl/t.pdf",
    text: ROW,
    siblings: ING.filter((n) => n !== product),
  });
  it("the real ING row gives each package its own fee as a first figure", () => {
    for (const n of ING) expect(parseFigureReply(reply(amounts[n]!), req(n))).not.toBeNull();
  });
  it("the same row is rejected for the wrong package", () => {
    expect(parseFigureReply(reply(amounts["ING More"]!), req("ING Go"))).toBeNull();
    expect(parseFigureReply(reply(amounts["ING Go"]!), req("ING Max"))).toBeNull();
  });
  it("a yearly amount must not become a monthly first fee", () => {
    const text = "De ING Go kost € 48,00 per jaar voor de rekening.";
    const r = { ...req("ING Go"), siblings: [], text };
    const body = { value: 48, conditions: "x", conditionsKnown: true, quote: text };
    expect(parseFigureReply({ ...body, period: "maand" }, r)).toBeNull();
    expect(parseFigureReply({ ...body, period: "jaar" }, r)).not.toBeNull();
  });
});

describe("the neighbour product of the same issuer", () => {
  const ABN = "ABN AMRO Bank N.V.";
  const doc =
    "Informatieblad creditcards ABN AMRO. ABN AMRO Credit Card € 2,55 per maand. ABN AMRO Gold Card € 4,25 per maand. " +
    "Alle bedragen per maand, afgeschreven van uw betaalrekening. ".repeat(5);
  const neighbour = "ABN AMRO Gold Card € 4,25 per maand";
  const req = {
    product: "ABN AMRO Credit Card",
    issuer: ABN,
    field: "accountFee" as const,
    sourceUrl: "https://www.abnamro.nl/info.pdf",
    text: doc,
    siblings: [] as string[],
    others: ["ABN AMRO Gold Card"],
  };
  const reply = {
    value: 4.25,
    period: "maand",
    conditions: "Afgeschreven van uw betaalrekening",
    conditionsKnown: true,
    quote: neighbour,
  };

  it("an open read of the neighbour row is no read, so the guard never sees a found figure", () => {
    const open = parseFigureReply(reply, req);
    expect(open).toBeNull();
    const decision = decideOpen({
      label: "fee",
      field: "accountFee",
      stored: { value: 2.55, period: "maand" },
      outcome: { kind: "reply", reply: { status: "not_on_page" } },
      found: open
        ? { value: open.value, period: open.period, covered: open.conditionsKnown }
        : null,
    });
    expect(decision.kind).toBe("not-checked");
  });

  it("the neighbour row is rejected for a first figure too", () => {
    expect(parseFigureReply(reply, { ...req, requireName: true })).toBeNull();
  });

  it("a first figure needs the product's own name when the issuer has another product that can hold it", () => {
    const own = "Kosten voor het houden van de kaart € 2,55 per maand";
    const body = { ...reply, value: 2.55, quote: own };
    const text = `${own}. ${"x ".repeat(20)}`;
    expect(parseFigureReply(body, { ...req, text })).not.toBeNull();
    expect(parseFigureReply(body, { ...req, text, requireName: true })).toBeNull();
    const named = "ABN AMRO Credit Card € 2,55 per maand";
    expect(
      parseFigureReply(
        { ...body, quote: named },
        { ...req, text: `${named}. ${"x ".repeat(20)}`, requireName: true },
      ),
    ).not.toBeNull();
  });

  const products = {
    a: { product: "ABN AMRO Credit Card", issuer: ABN, kind: "creditcard" },
    b: {
      product: "ABN AMRO Gold Card",
      issuer: "ABN AMRO Bank N.V. — Dutch DGS",
      kind: "creditcard",
    },
    c: { product: "ABN AMRO Spaarrekening", issuer: ABN, kind: "spaarrekening" },
    d: { product: "ING Creditcard", issuer: "ING Bank N.V.", kind: "creditcard" },
    e: { product: "ABN AMRO Betaalpas", issuer: ABN, kind: "betaalpas" },
  };
  it("the issuer key drops legal suffixes, brackets and trailing remarks", () => {
    expect(issuerKey("ABN AMRO Bank N.V. — Dutch DGS")).toBe(issuerKey("ABN AMRO Bank N.V."));
    expect(issuerKey("International Card Services B.V. (ICS, an ABN AMRO subsidiary)")).toBe(
      issuerKey("International Card Services (ICS)"),
    );
    expect(issuerKey("ING Bank N.V.")).not.toBe(issuerKey(ABN));
    expect(issuerKey("")).toBe("");
  });
  it("the other products are those of the same issuer, never the product itself", () => {
    expect(otherIssuerProducts("a", products).map((p) => p.product)).toEqual([
      "ABN AMRO Gold Card",
      "ABN AMRO Spaarrekening",
      "ABN AMRO Betaalpas",
    ]);
    expect(otherIssuerProducts("d", products)).toEqual([]);
    expect(
      otherIssuerProducts("a", {
        a: { product: "X", issuer: "", kind: "creditcard" },
        b: { product: "Y", issuer: "", kind: "creditcard" },
      }),
    ).toEqual([]);
  });
  it("a first figure needs its name when another product of the issuer can hold the field", () => {
    const others = otherIssuerProducts("a", products);
    expect(firstFigureNeedsName("accountFee", others)).toBe(true);
    expect(firstFigureNeedsName("pointsPerEuro", others)).toBe(true);
    expect(
      firstFigureNeedsName(
        "accountFee",
        otherIssuerProducts("a", { a: products.a, c: products.c }),
      ),
    ).toBe(false);
    expect(firstFigureNeedsName("accountFee", [])).toBe(false);
  });
});

describe("round 2: issuer key", () => {
  it("drops generic and legal suffix words", () => {
    const k = issuerKey("ABN AMRO");
    for (const s of ["ABN AMRO Bank N.V.", "ABN AMRO Bank N.V. — Dutch DGS", "ABN AMRO Bank NV"]) {
      expect(issuerKey(s), s).toBe(k);
    }
    expect(issuerKey("Wise Europe SA")).toBe(issuerKey("Wise"));
    expect(issuerKey("Revolut Bank UAB (Lithuania)")).toBe(issuerKey("Revolut"));
  });
  it("keeps separate brands apart", () => {
    const keys = [
      "ASN Bank N.V.",
      "SNS Bank (de Volksbank N.V.)",
      "RegioBank (de Volksbank N.V.)",
    ].map(issuerKey);
    expect(new Set(keys).size).toBe(3);
  });
});

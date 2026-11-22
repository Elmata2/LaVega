import { describe, expect, it } from "vitest";
import {
  buildConfirmPrompt,
  CONFIRM_TOOL,
  confirmRead,
  storedCheckOf,
  readChangedValue,
  sameDocument,
  parseConfirmReply,
  type ConfirmRequest,
} from "./catalogConfirm.js";

const TEXT = `
Tarieven buitenland
Betalen met je betaalpas buiten de eurolanden: 1,4% koersopslag over het bedrag.
Geld opnemen kost 2% van het opgenomen bedrag.
Wisselen binnen het pakket is gratis tot € 1.000 per maand.
`;

const req = (over: Partial<ConfirmRequest> = {}): ConfirmRequest => ({
  product: "ASN Bank betaalpas",
  field: "fxFeePct",
  storedValue: 1.4,
  storedConditions: "buiten de eurolanden",
  text: TEXT,
  ...over,
});

describe("parseConfirmReply", () => {
  it("still_stated with the number in a real quote is accepted", () => {
    const quote = "Betalen met je betaalpas buiten de eurolanden: 1,4% koersopslag";
    expect(parseConfirmReply({ status: "still_stated", quote }, req())).toEqual({
      status: "still_stated",
      quote,
    });
    // a dot decimal in the quote counts too
    const dot = "Wisselen: 1.4% koersopslag";
    expect(
      parseConfirmReply({ status: "still_stated", quote: dot }, req({ text: `${TEXT}\n${dot}` })),
    ).toEqual({ status: "still_stated", quote: dot });
  });

  it("still_stated whose quote is not in the text is rejected", () => {
    const quote = "Betalen buiten de eurolanden kost 1,4% koersopslag";
    expect(parseConfirmReply({ status: "still_stated", quote }, req())).toBeNull();
  });

  it("still_stated whose quote lacks the stored number is rejected", () => {
    const quote = "Geld opnemen kost 2% van het opgenomen bedrag.";
    expect(parseConfirmReply({ status: "still_stated", quote }, req())).toBeNull();
    // 11,4% must not pass for 1,4%
    const t = "Koersopslag 11,4% op alles.";
    expect(parseConfirmReply({ status: "still_stated", quote: t }, req({ text: t }))).toBeNull();
  });

  it("zero is accepted only with a zero or free wording in the quote", () => {
    const zero = req({ storedValue: 0, storedConditions: null });
    const free = "Wisselen binnen het pakket is gratis tot € 1.000 per maand.";
    expect(parseConfirmReply({ status: "still_stated", quote: free }, zero)).toEqual({
      status: "still_stated",
      quote: free,
    });
    const other = "Geld opnemen kost 2% van het opgenomen bedrag.";
    expect(parseConfirmReply({ status: "still_stated", quote: other }, zero)).toBeNull();
    const t = "Koersopslag 0,00% op betalingen.";
    expect(
      parseConfirmReply({ status: "still_stated", quote: t }, { ...zero, text: t }),
    ).not.toBeNull();
    const t2 = "Tarief 10% op alles.";
    expect(
      parseConfirmReply({ status: "still_stated", quote: t2 }, { ...zero, text: t2 }),
    ).toBeNull(); // "0%" inside "10%" is not a zero
  });

  it("zero with a free word but no topic word is rejected", () => {
    const zero = req({ storedValue: 0, storedConditions: null });
    const q = "Een tweede pasje is gratis.";
    expect(
      parseConfirmReply({ status: "still_stated", quote: q }, { ...zero, text: q }),
    ).toBeNull();
    const sav = req({ field: "interestPct", storedValue: 0, text: q });
    expect(parseConfirmReply({ status: "still_stated", quote: q }, sav)).toBeNull();
  });

  it("zero with free word and topic word is accepted", () => {
    const q = "Geen kosten voor betalen in het buitenland.";
    const zero = req({ storedValue: 0, storedConditions: null, text: q });
    expect(parseConfirmReply({ status: "still_stated", quote: q }, zero)).toEqual({
      status: "still_stated",
      quote: q,
    });
    const r = "Geen rente over saldo onder € 1.000.";
    const sav = req({ field: "interestPct", storedValue: 0, text: r });
    expect(parseConfirmReply({ status: "still_stated", quote: r }, sav)).not.toBeNull();
  });

  it("changed carries the new value and a real quote", () => {
    const quote = "Geld opnemen kost 2% van het opgenomen bedrag.";
    expect(parseConfirmReply({ status: "changed", quote, newValue: 2 }, req())).toEqual({
      status: "changed",
      quote,
      newValue: 2,
    });
    expect(
      parseConfirmReply({ status: "changed", quote: "nope nope", newValue: 2 }, req()),
    ).toBeNull();
    expect(parseConfirmReply({ status: "changed", quote }, req())).toBeNull();
    expect(parseConfirmReply({ status: "changed", quote, newValue: "2" }, req())).toBeNull();
  });

  it("not_on_page needs no quote", () => {
    expect(parseConfirmReply({ status: "not_on_page" }, req())).toEqual({ status: "not_on_page" });
  });

  it("malformed reply is null", () => {
    for (const bad of [
      null,
      undefined,
      "x",
      3,
      [],
      {},
      { status: "maybe" },
      { status: "still_stated" },
    ]) {
      expect(parseConfirmReply(bad, req())).toBeNull();
    }
    expect(parseConfirmReply({ status: "still_stated", quote: "" }, req())).toBeNull();
    expect(parseConfirmReply({ status: "still_stated", quote: 5 }, req())).toBeNull();
  });
});

describe("parseConfirmReply, strict anchoring", () => {
  const ok = (quote: string, over: Partial<ConfirmRequest> = {}) =>
    parseConfirmReply({ status: "still_stated", quote }, req({ text: quote, ...over }));

  it("1.000 euro does not confirm a stored 1", () => {
    expect(ok("Koersopslag tot € 1.000 per maand, daarna meer.", { storedValue: 1 })).toBeNull();
    expect(ok("Koersopslag tot € 2.500 per maand, daarna meer.", { storedValue: 2.5 })).toBeNull();
  });
  it("a bare number without a percent sign is rejected", () => {
    expect(ok("Koersopslag: 1,4 per transactie in rekening", {})).toBeNull();
  });
  it("a percentage without a topic word is rejected", () => {
    expect(ok("2,5% cashback op al je aankopen", { storedValue: 2.5 })).toBeNull();
  });
  it("a quote under 25 characters is rejected", () => {
    expect(ok("koers 1,4%")).toBeNull();
  });
  it("a percentage with a topic word is accepted, per field", () => {
    expect(ok("Wisselkoersopslag van 1,4 procent per betaling")).not.toBeNull();
    expect(
      ok("De rente is 1,30% per jaar over je saldo", { field: "interestPct", storedValue: 1.3 }),
    ).not.toBeNull();
  });
  it("geen wissellimiet does not confirm a zero fee", () => {
    const q = "Geen wissellimiet. Geen fair usage-kosten.";
    expect(ok(q, { storedValue: 0 })).toBeNull();
  });
  it("freelance is not a zero word", () => {
    expect(ok("Freelance valuta tarieven per transactie", { storedValue: 0 })).toBeNull();
  });
  it("10% is not zero", () => {
    expect(ok("Koersopslag buitenland is 10% van het bedrag", { storedValue: 0 })).toBeNull();
  });
  it("zero word and topic word 200 characters apart are rejected", () => {
    const q = `Geen kosten. ${"x ".repeat(100)} Valuta tarieven staan hier.`;
    expect(ok(q, { storedValue: 0 })).toBeNull();
  });
  it("a zero statement next to a topic word is accepted", () => {
    expect(ok("We rekenen geen valutawisselvergoedingen.", { storedValue: 0 })).not.toBeNull();
    expect(ok("Koersopslag: 0% bij betalen in het buitenland", { storedValue: 0 })).not.toBeNull();
  });
});

describe("storedCheckOf", () => {
  const quote = "Koersopslag 0% bij betalen buiten de eurozone";
  it("not_on_page is gone", () => {
    expect(storedCheckOf({ kind: "reply", reply: { status: "not_on_page" } }, 2, true)).toBe(
      "gone",
    );
  });
  it("changed to the found value is gone", () => {
    const reply = { status: "changed" as const, quote, newValue: 2.00001 };
    expect(storedCheckOf({ kind: "reply", reply }, 2, true)).toBe("gone");
  });
  it("changed to a third value is unresolved", () => {
    const reply = { status: "changed" as const, quote, newValue: 3 };
    expect(storedCheckOf({ kind: "reply", reply }, 2, true)).toBe("unresolved");
  });
  it("still_stated is still-stated", () => {
    const reply = { status: "still_stated" as const, quote };
    expect(storedCheckOf({ kind: "reply", reply }, 2, true)).toBe("still-stated");
  });
  it("a rejected reply is unresolved", () => {
    expect(storedCheckOf({ kind: "rejected" }, 2, true)).toBe("unresolved");
  });
  it("changed to the found value with a rejected quote is gone", () => {
    const raw = { status: "changed", quote: "not on the page at all", newValue: 2 };
    expect(storedCheckOf({ kind: "rejected", raw }, 2, true)).toBe("gone");
    expect(readChangedValue(raw)).toBe(2);
  });
  it("changed to the found value with a non-numeric newValue is unresolved", () => {
    const raw = { status: "changed", quote: "x", newValue: "2" };
    expect(storedCheckOf({ kind: "rejected", raw }, 2, true)).toBe("unresolved");
    expect(readChangedValue(raw)).toBeNull();
  });
  it("still_stated with a rejected quote stays unresolved", () => {
    const raw = { status: "still_stated", quote: "not on the page at all" };
    expect(storedCheckOf({ kind: "rejected", raw }, 2, true)).toBe("unresolved");
  });
  it("changed to a third value with a rejected quote stays unresolved", () => {
    const raw = { status: "changed", quote: "nope", newValue: 3 };
    expect(storedCheckOf({ kind: "rejected", raw }, 2, true)).toBe("unresolved");
  });
  it("a failed call is unresolved", () => {
    expect(storedCheckOf({ kind: "failed" }, 2, true)).toBe("unresolved");
    expect(storedCheckOf({ kind: "no-document" }, 2, true)).toBe("unresolved");
  });
});

describe("storedCheckOf on a different document", () => {
  const quote = "Koersopslag 0% bij betalen buiten de eurozone";
  it("not_on_page on a different document is unresolved", () => {
    expect(storedCheckOf({ kind: "reply", reply: { status: "not_on_page" } }, 2, false)).toBe(
      "unresolved",
    );
  });
  it("changed to the found value on a different document is unresolved", () => {
    const reply = { status: "changed" as const, quote, newValue: 2 };
    expect(storedCheckOf({ kind: "reply", reply }, 2, false)).toBe("unresolved");
    const raw = { status: "changed", quote: "nope", newValue: 2 };
    expect(storedCheckOf({ kind: "rejected", raw }, 2, false)).toBe("unresolved");
  });
  it("not_on_page on the stored document is gone", () => {
    expect(storedCheckOf({ kind: "reply", reply: { status: "not_on_page" } }, 2, true)).toBe(
      "gone",
    );
  });
  it("still_stated on any document is still-stated", () => {
    const reply = { status: "still_stated" as const, quote };
    expect(storedCheckOf({ kind: "reply", reply }, 2, true)).toBe("still-stated");
    expect(storedCheckOf({ kind: "reply", reply }, 2, false)).toBe("still-stated");
  });
});

describe("sameDocument", () => {
  it("equal URLs, trailing slash ignored", () => {
    expect(sameDocument("https://a.nl/tarief", "https://a.nl/tarief/")).toBe(true);
  });
  it("an archive wrapper is unwrapped", () => {
    expect(
      sameDocument(
        "https://web.archive.org/web/20250101000000id_/https://a.nl/tarief",
        "https://a.nl/tarief",
      ),
    ).toBe(true);
  });
  it("a reader proxy is unwrapped", () => {
    expect(sameDocument("https://r.jina.ai/https://a.nl/tarief", "https://a.nl/tarief/")).toBe(
      true,
    );
  });
  it("different paths are different documents", () => {
    expect(sameDocument("https://a.nl/tarief.pdf", "https://a.nl/kaart")).toBe(false);
  });
  it("same path on another host is different", () => {
    expect(sameDocument("https://a.nl/t", "https://b.nl/t")).toBe(false);
  });
});

describe("confirmRead", () => {
  it("a confirm on an archived document carries the snapshot date", () => {
    const r = confirmRead({
      storedValue: 1.4,
      url: "https://web.archive.org/web/20250101000000id_/https://a.nl/t",
      snapshotDate: "2025-01-01",
      today: "2026-11-22",
    });
    expect(r).toMatchObject({
      value: 1.4,
      route: "agent",
      checkedAt: "2025-01-01",
      conditionsKnown: false,
    });
  });
  it("a confirm on a live document carries today", () => {
    const r = confirmRead({
      storedValue: 0,
      url: "https://a.nl/t",
      snapshotDate: null,
      today: "2026-11-22",
    });
    expect(r.checkedAt).toBe("2026-11-22");
    expect(r.sourceUrl).toBe("https://a.nl/t");
  });
});

describe("buildConfirmPrompt", () => {
  it("prompt names the product, the stored value and the stored conditions", () => {
    const { system, user } = buildConfirmPrompt(req());
    const all = `${system}\n${user}`;
    expect(all).toContain("ASN Bank betaalpas");
    expect(all).toContain("1,4");
    expect(all).toContain("buiten de eurolanden");
    expect(all).toContain("not_on_page");
    expect(all).toContain(CONFIRM_TOOL.name);
    expect(user).toContain(TEXT.trim());
  });

  it("stored conditions longer than 240 characters are cut in the prompt", () => {
    const long = "woord ".repeat(80).trim();
    const { user } = buildConfirmPrompt(req({ storedConditions: long }));
    const line = user.split("\n").find((l) => l.startsWith("Stored conditions: "))!;
    const shown = line.slice("Stored conditions: ".length);
    expect(shown.length).toBeLessThanOrEqual(241);
    expect(shown.endsWith("…")).toBe(true);
    expect(shown.slice(0, -1).endsWith("woord")).toBe(true);
    const short = buildConfirmPrompt(req({ storedConditions: "kort" })).user;
    expect(short).toContain("Stored conditions: kort\n");
  });

  it("asks for one contiguous passage", () => {
    expect(buildConfirmPrompt(req()).system).toMatch(/ONE contiguous passage/);
  });

  it("states that a general document may cover the product without naming it", () => {
    const { system } = buildConfirmPrompt(req());
    expect(system).toMatch(/without naming/i);
  });
});

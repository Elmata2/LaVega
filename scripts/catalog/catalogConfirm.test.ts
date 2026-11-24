import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildConfirmPrompt,
  type Binding,
  checkFigureQuote,
  documentNamesProduct,
  CONFIRM_TOOL,
  CONFIRM_FIGURE_TOOL,
  confirmToolFor,
  isZeroByAbsence,
  confirmRead,
  snapshotDateOf,
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
  it("a fee confirm keeps the stored period", () => {
    const r = confirmRead({
      storedValue: 4,
      period: "maand",
      url: "https://a.nl/t",
      snapshotDate: null,
      today: "2026-11-22",
    });
    expect(r.period).toBe("maand");
    expect(
      "period" in
        confirmRead({
          storedValue: 4,
          url: "https://a.nl/t",
          snapshotDate: null,
          today: "2026-11-22",
        }),
    ).toBe(false);
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

describe("fee, points and cashback confirm rules", () => {
  const fee = (text: string, over: Partial<ConfirmRequest> = {}): ConfirmRequest => ({
    product: "ING Go",
    field: "accountFee",
    storedValue: 4,
    storedPeriod: "maand",
    storedConditions: null,
    text,
    ...over,
  });
  const still = (r: ConfirmRequest) =>
    parseConfirmReply({ status: "still_stated", quote: r.text }, r);

  it("a monthly fee is confirmed by an amount with a month word", () => {
    const r = fee("Betaalrekening ING Go kost € 4,00 per maand.");
    expect(still(r)).toEqual({ status: "still_stated", quote: r.text });
    expect(still(fee("Go package costs EUR 4 a month (p/m) for the account"))).not.toBeNull();
  });

  it("a monthly fee is rejected when the quote says per year", () => {
    expect(still(fee("Betaalrekening ING Go kost € 4,00 per jaar."))).toBeNull();
    expect(
      still(fee("Betaalrekening ING Go kost € 48,00 per jaar.", { storedValue: 4 })),
    ).toBeNull();
    expect(
      checkFigureQuote("accountFee", 4, "jaar", "Betaalrekening ING Go kost € 4,00 per maand."),
    ).toMatchObject({ ok: false });
  });

  it("a fee quote without a period word is rejected", () => {
    expect(still(fee("Betaalrekening ING Go kost € 4,00 voor de rekening."))).toBeNull();
  });

  it("€ 40,00 does not confirm a fee of 4", () => {
    expect(still(fee("Betaalrekening ING Go kost € 40,00 per maand."))).toBeNull();
    expect(still(fee("Betaalrekening ING Go kost € 0,40 per maand."))).toBeNull();
  });

  it("€ 4.000 does not confirm a fee of 4", () => {
    expect(still(fee("Betaalrekening ING Go kost € 4.000 per maand."))).toBeNull();
    expect(still(fee("Betaalrekening ING Go kost € 4.000,00 per maand."))).toBeNull();
  });

  it("4,- with a euro sign confirms a fee of 4", () => {
    expect(still(fee("Betaalrekening ING Go kost €4,- per maand."))).not.toBeNull();
    expect(still(fee("Betaalrekening ING Go kost 4 euro per maand."))).not.toBeNull();
    expect(still(fee("Betaalrekening ING Go kost 4,- per maand."))).toBeNull();
  });

  it("points need the number, a points word and a per-spend word", () => {
    const pts = (text: string) =>
      fee(text, { field: "pointsPerEuro", storedValue: 1, storedPeriod: undefined });
    expect(still(pts("Je spaart 1 punt per euro die je uitgeeft met de kaart."))).not.toBeNull();
    expect(still(pts("Earn 1 Miles for every euro you spend on the card."))).not.toBeNull();
    expect(still(pts("Je spaart 2 punten per euro die je uitgeeft met de kaart."))).toBeNull();
    expect(still(pts("Je spaart 1 punt bij elke aankoop met de kaart in de winkel."))).toBeNull();
  });

  it("1 punt per maand does not confirm 1 point per euro", () => {
    const r = fee("Je krijgt 1 punt per maand als je de kaart gebruikt.", {
      field: "pointsPerEuro",
      storedValue: 1,
      storedPeriod: undefined,
    });
    expect(still(r)).toBeNull();
  });

  it("cashback needs the percentage and the word cashback", () => {
    const cb = (text: string) =>
      fee(text, { field: "cashbackPct", storedValue: 2, storedPeriod: undefined });
    expect(still(cb("Je krijgt 2% cashback op alle aankopen bij partners."))).not.toBeNull();
    expect(still(cb("Je krijgt 2% van het bedrag direct geld terug op aankopen."))).not.toBeNull();
    expect(still(cb("Je krijgt 12% cashback op alle aankopen bij partners."))).toBeNull();
  });

  it("2% rente does not confirm 2% cashback", () => {
    const r = fee("Over je spaargeld ontvang je 2% rente per jaar op je rekening.", {
      field: "cashbackPct",
      storedValue: 2,
      storedPeriod: undefined,
    });
    expect(still(r)).toBeNull();
  });

  describe("zero by absence", () => {
    const zero = (over: Partial<ConfirmRequest> = {}) =>
      fee("Voor deze kaart sparen wij geen punten. De kaart kost niets extra.", {
        field: "pointsPerEuro",
        storedValue: 0,
        storedPeriod: undefined,
        zeroByAbsence: true,
        ...over,
      });

    it("none_stated is accepted only for a zero by absence", () => {
      expect(parseConfirmReply({ status: "none_stated" }, zero())).toEqual({
        status: "none_stated",
      });
      expect(
        parseConfirmReply({ status: "none_stated" }, zero({ zeroByAbsence: false })),
      ).toBeNull();
      expect(
        parseConfirmReply({ status: "none_stated" }, fee("x", { zeroByAbsence: undefined })),
      ).toBeNull();
    });

    it("still_stated is rejected for a zero by absence", () => {
      const r = zero();
      expect(parseConfirmReply({ status: "still_stated", quote: r.text }, r)).toBeNull();
    });

    it("changed with a quoted rate is accepted for a zero by absence", () => {
      const text = "Met deze kaart spaar je 1 punt per euro die je uitgeeft.";
      const r = zero({ text });
      expect(parseConfirmReply({ status: "changed", quote: text, newValue: 1 }, r)).toEqual({
        status: "changed",
        quote: text,
        newValue: 1,
      });
      expect(
        parseConfirmReply({ status: "changed", quote: "niet in de tekst", newValue: 1 }, r),
      ).toBeNull();
    });
  });

  it("the prompt for a fee names the period and warns about side-by-side products", () => {
    const { system, user } = buildConfirmPrompt(fee("tekst"));
    expect(user).toContain("€ 4 per month");
    expect(user).toContain("ING Go");
    expect(system).toMatch(/per month or per year/);
    expect(system).toMatch(/side by side/);
    expect(system).toMatch(/THIS product or package/);
    expect(system).toContain("not_on_page");
    const absent = buildConfirmPrompt(zeroAbsence());
    expect(absent.system).toContain("none_stated");
    expect(absent.system).toMatch(/per euro/);
  });

  function zeroAbsence(): ConfirmRequest {
    return fee("tekst", {
      field: "cashbackPct",
      storedValue: 0,
      storedPeriod: undefined,
      zeroByAbsence: true,
    });
  }

  it("isZeroByAbsence is true for zero points and zero cashback only", () => {
    expect(isZeroByAbsence("pointsPerEuro", 0)).toBe(true);
    expect(isZeroByAbsence("cashbackPct", 0)).toBe(true);
    expect(isZeroByAbsence("pointsPerEuro", 1)).toBe(false);
    expect(isZeroByAbsence("cashbackPct", 2)).toBe(false);
    expect(isZeroByAbsence("accountFee", 0)).toBe(false);
    expect(isZeroByAbsence("fxFeePct", 0)).toBe(false);
    expect(isZeroByAbsence("interestPct", 0)).toBe(false);
  });
});

describe("FX and interest confirm questions stay byte-identical", () => {
  // Captured from the prompt builder and tool before slice 3 (reply cache keys depend on them).
  const base = JSON.parse(
    readFileSync(new URL("./catalogConfirm.base.json", import.meta.url), "utf8"),
  );
  const ask = (field: "fxFeePct" | "interestPct", v: number, c: string | null) =>
    buildConfirmPrompt({ product: "P", field, storedValue: v, storedConditions: c, text: "DOC" });

  it("the FX prompt and tool are unchanged", () => {
    expect(ask("fxFeePct", 1.4, "buiten de eurolanden")).toEqual(base.fx);
    expect(confirmToolFor({ field: "fxFeePct" })).toEqual(base.tool);
    expect(CONFIRM_TOOL).toEqual(base.tool);
  });

  it("the interest prompt and tool are unchanged", () => {
    expect(ask("interestPct", 2.5, null)).toEqual(base.int);
    expect(confirmToolFor({ field: "interestPct" })).toEqual(base.tool);
  });

  it("fee, points and cashback use the figure tool", () => {
    for (const field of ["accountFee", "pointsPerEuro", "cashbackPct"] as const) {
      expect(confirmToolFor({ field })).toBe(CONFIRM_FIGURE_TOOL);
    }
  });
});

describe("fix round 1 tightening", () => {
  const q = (
    field: Parameters<typeof checkFigureQuote>[0],
    v: number,
    text: string,
    p?: "maand" | "jaar",
  ) => checkFigureQuote(field, v, p, text).ok;

  it("period words match whole words", () => {
    expect(q("accountFee", 4, "Rekening ING Go kost € 4,00 voor 12 maanden", "maand")).toBe(false);
    expect(q("accountFee", 4, "Rekening ING Go kost € 4,00 maandelijks", "maand")).toBe(true);
    expect(q("accountFee", 48, "Rekening ING Go kost € 48,00 jaarlijks", "jaar")).toBe(true);
    expect(q("accountFee", 48, "Rekening ING Go kost € 48,00 jaarlijks", "maand")).toBe(false);
  });

  it("cashback needs the stored percentage tied to the cashback word", () => {
    expect(q("cashbackPct", 2, "Je krijgt 2% rente en 1% cashback op je aankopen")).toBe(false);
    expect(q("cashbackPct", 1, "Je krijgt 2% rente en 1% cashback op je aankopen")).toBe(true);
    expect(q("cashbackPct", 2, "Je krijgt 2% terugbetaling op je aankopen")).toBe(false);
    expect(q("cashbackPct", 2, "Je krijgt 2% terug op je aankopen met de kaart")).toBe(true);
  });

  it("per 1 counts only before a euro form", () => {
    expect(q("pointsPerEuro", 1, "Je krijgt 1 punt per 1 maand met de kaart")).toBe(false);
    expect(q("pointsPerEuro", 1, "Je krijgt 1 punt per 1 euro met de kaart")).toBe(true);
    expect(q("pointsPerEuro", 1, "You earn 1 point per EUR 1 spent on the card")).toBe(true);
  });

  it("a changed reply for a zero by absence needs a positive rate in the quote", () => {
    const base = {
      product: "P",
      field: "pointsPerEuro" as const,
      storedValue: 0,
      storedConditions: null,
      zeroByAbsence: true,
    };
    const text = "Met deze kaart spaar je 2 punten per euro die je uitgeeft.";
    const r: ConfirmRequest = { ...base, text };
    expect(parseConfirmReply({ status: "changed", quote: text, newValue: 2 }, r)).not.toBeNull();
    expect(parseConfirmReply({ status: "changed", quote: text, newValue: 3 }, r)).toBeNull();
    expect(parseConfirmReply({ status: "changed", quote: text, newValue: 0 }, r)).toBeNull();
    const cb: ConfirmRequest = {
      ...base,
      field: "cashbackPct",
      text: "Je krijgt 1,5% cashback op alles.",
    };
    expect(
      parseConfirmReply({ status: "changed", quote: cb.text, newValue: 1.5 }, cb),
    ).not.toBeNull();
    expect(parseConfirmReply({ status: "changed", quote: cb.text, newValue: 2 }, cb)).toBeNull();
  });
});

describe("snapshotDateOf", () => {
  it("reads the date of an archive address", () => {
    expect(
      snapshotDateOf("http://web.archive.org/web/20260519164655id_/https://www.icscards.nl/x"),
    ).toBe("2026-05-19");
  });
  it("is null for a live address", () => {
    expect(snapshotDateOf("https://www.icscards.nl/x")).toBeNull();
  });
});

describe("product binding of a quote", () => {
  const ING = ["ING Go", "ING More", "ING Extra", "ING Max"];
  const ING_ROW =
    "Betaalpakketten            ING Go                 ING More               ING Extra                ING Max\n\n Kosten per maand           € 4,00                 € 7,00                 € 15,99                  € 44,99";
  const bind = (product: string, all: string[], issuer = "ING Bank N.V.") => ({
    product,
    issuer,
    siblings: all.filter((n) => n !== product),
  });
  const amounts: Record<string, number> = {
    "ING Go": 4,
    "ING More": 7,
    "ING Extra": 15.99,
    "ING Max": 44.99,
  };

  it("the real ING four-column quote confirms each package at its own amount", () => {
    for (const name of ING) {
      expect(
        checkFigureQuote("accountFee", amounts[name]!, "maand", ING_ROW, bind(name, ING)),
      ).toEqual({
        ok: true,
      });
    }
  });
  it("rejects each amount for the wrong package", () => {
    for (const name of ING) {
      for (const [other, amount] of Object.entries(amounts)) {
        if (other === name) continue;
        expect(checkFigureQuote("accountFee", amount, "maand", ING_ROW, bind(name, ING)).ok).toBe(
          false,
        );
      }
    }
  });
  it("rejects the name-less row", () => {
    const row =
      "Kosten per maand           € 4,00                 € 7,00                 € 15,99                  € 44,99";
    const v = checkFigureQuote("accountFee", 4, "maand", row, bind("ING Go", ING));
    expect(v).toEqual({ ok: false, reason: "quote does not name the product" });
  });
  it("rejects a row whose names and amounts do not line up", () => {
    const row = "ING Go ING More ING Extra  Kosten per maand € 4,00 € 7,00 € 15,99 € 44,99";
    expect(checkFigureQuote("accountFee", 4, "maand", row, bind("ING Go", ING)).ok).toBe(false);
  });

  const ICS = ["ICS Visa World Card", "ICS Visa World Card Panda"];
  const ICS_QUOTE = "Waarom wordt de jaarbijdrage voor de World Card € 42,95?";
  const icsIssuer = "International Card Services B.V. (ICS, an ABN AMRO subsidiary)";
  it("a World Card quote on a shared URL is rejected for Panda and accepted for the World Card", () => {
    expect(
      checkFigureQuote(
        "accountFee",
        42.95,
        "jaar",
        ICS_QUOTE,
        bind("ICS Visa World Card Panda", ICS, icsIssuer),
      ),
    ).toEqual({ ok: false, reason: "quote does not name the product" });
    expect(
      checkFigureQuote(
        "accountFee",
        42.95,
        "jaar",
        ICS_QUOTE,
        bind("ICS Visa World Card", ICS, icsIssuer),
      ).ok,
    ).toBe(true);
  });
  it("the longest name wins: ING Creditcard is not found inside ING Creditcard More", () => {
    const names = ["ING Creditcard", "ING Creditcard More"];
    const quote = "Creditcards ING Creditcard More cardfee per maand € 2,00";
    expect(
      checkFigureQuote("accountFee", 2, "maand", quote, bind("ING Creditcard More", names)).ok,
    ).toBe(true);
    expect(
      checkFigureQuote("accountFee", 2, "maand", quote, bind("ING Creditcard", names)).ok,
    ).toBe(false);
  });
  it("an unshared document with one amount needs no name", () => {
    expect(
      checkFigureQuote("accountFee", 2.55, "maand", "Credit Card € 2,55 per maand", {
        product: "ABN AMRO creditcard",
        siblings: [],
      }).ok,
    ).toBe(true);
  });
  it("Credit Card and creditcard are the same name", () => {
    expect(
      checkFigureQuote(
        "accountFee",
        2.55,
        "maand",
        "ABN AMRO Credit Card             € 2,55 per maand",
        {
          product: "ABN AMRO creditcard",
          siblings: ["ABN AMRO Gold Card"],
        },
      ).ok,
    ).toBe(true);
  });
  it("an unshared document with several amounts needs the name", () => {
    const q = "Kosten per maand € 4,00 en € 7,00 voor iets anders";
    expect(
      checkFigureQuote("accountFee", 4, "maand", q, { product: "ING Go", siblings: [] }).ok,
    ).toBe(false);
  });
  it("an empty issuer never shortens a name: only the full name is found", () => {
    const names = ["ING Creditcard More", "ING Creditcard Extra"];
    const binding = { product: "ING Creditcard More", issuer: "", siblings: [names[1]!] };
    expect(
      checkFigureQuote(
        "accountFee",
        2,
        "maand",
        "Creditcard More € 2,00 per maand, Creditcard Extra € 4,35 per maand",
        binding,
      ).ok,
    ).toBe(false);
    expect(
      checkFigureQuote(
        "accountFee",
        2,
        "maand",
        "ING Creditcard More € 2,00 per maand, ING Creditcard Extra € 4,35 per maand",
        binding,
      ).ok,
    ).toBe(true);
  });
  it("a name without the issuer prefix counts when the remainder is distinct and has two words", () => {
    const names = ["ING Creditcard More", "ING Creditcard Extra"];
    const q = "Creditcard More cardfee per maand € 2,00";
    expect(
      checkFigureQuote("accountFee", 2, "maand", q, bind("ING Creditcard More", names)).ok,
    ).toBe(true);
    expect(
      checkFigureQuote("accountFee", 2, "maand", q, bind("ING Creditcard Extra", names)).ok,
    ).toBe(false);
  });
  it("a shared points quote must name the product", () => {
    const names = ["Alpha Card", "Beta Card"];
    const q = "Spaar 1 punt per euro met de Alpha Card";
    expect(
      checkFigureQuote("pointsPerEuro", 1, undefined, q, bind("Alpha Card", names, "")).ok,
    ).toBe(true);
    expect(
      checkFigureQuote("pointsPerEuro", 1, undefined, q, bind("Beta Card", names, "")).ok,
    ).toBe(false);
  });
  it("the confirm prompt of a shared document asks for the naming header; FX is untouched", () => {
    const shared = buildConfirmPrompt({
      product: "ING Go",
      field: "accountFee",
      storedValue: 4,
      storedPeriod: "maand",
      storedConditions: null,
      text: "x",
      siblings: ["ING More"],
    });
    expect(shared.system).toContain("MUST include the header or row label that names THIS product");
    expect(shared.system).toContain("ING More");
    const alone = buildConfirmPrompt({
      product: "ING Go",
      field: "accountFee",
      storedValue: 4,
      storedPeriod: "maand",
      storedConditions: null,
      text: "x",
    });
    expect(alone.system).not.toContain("MUST include the header");
  });
  it("parseConfirmReply applies the binding through the request", () => {
    const text = ING_ROW;
    const base = {
      field: "accountFee" as const,
      storedConditions: null,
      storedPeriod: "maand" as const,
      issuer: "ING Bank N.V.",
      text,
    };
    const ok = parseConfirmReply(
      { status: "still_stated", quote: ING_ROW },
      {
        ...base,
        product: "ING More",
        storedValue: 7,
        siblings: ["ING Go", "ING Extra", "ING Max"],
      },
    );
    expect(ok).toMatchObject({ status: "still_stated" });
    const bad = parseConfirmReply(
      { status: "still_stated", quote: ING_ROW },
      {
        ...base,
        product: "ING More",
        storedValue: 4,
        siblings: ["ING Go", "ING Extra", "ING Max"],
      },
    );
    expect(bad).toBeNull();
  });
});

describe("fee period and short points quotes", () => {
  it("the period nearest the amount decides", () => {
    const q =
      "The Gold Card € 20,00 per maand                 Extra kaart Inclusief: 4 extra Green Cards € 85 per jaar";
    expect(checkFigureQuote("accountFee", 20, "maand", q).ok).toBe(true);
    expect(checkFigureQuote("accountFee", 20, "jaar", q).ok).toBe(false);
    expect(checkFigureQuote("accountFee", 85, "jaar", q).ok).toBe(true);
    const both = "Kosten: € 4,00 per maand (€ 48 per jaar)";
    expect(checkFigureQuote("accountFee", 4, "maand", both).ok).toBe(true);
    expect(checkFigureQuote("accountFee", 48, "jaar", both).ok).toBe(true);
    expect(checkFigureQuote("accountFee", 4, "jaar", both).ok).toBe(false);
    expect(checkFigureQuote("accountFee", 48, "maand", both).ok).toBe(false);
  });
  it("no period word within 80 characters is still rejected", () => {
    const q = `Kosten voor de kaart € 4,00 ${"x".repeat(100)} per maand`;
    expect(checkFigureQuote("accountFee", 4, "maand", q).ok).toBe(false);
  });
  it("Spaar 1 Mile per 1 euro confirms 1 point per euro", () => {
    expect(checkFigureQuote("pointsPerEuro", 1, undefined, "Spaar 1 Mile per 1 euro").ok).toBe(
      true,
    );
    expect(checkFigureQuote("pointsPerEuro", 2, undefined, "Spaar 1 Mile per 1 euro").ok).toBe(
      false,
    );
  });
});

describe("documentNamesProduct", () => {
  it("matches the full name or the name without issuer prefix, ignoring case and spacing", () => {
    expect(
      documentNamesProduct("De  ING   Creditcard More is", "ING Creditcard More", "ING Bank N.V."),
    ).toBe(true);
    expect(
      documentNamesProduct("De creditcard more is", "ING Creditcard More", "ING Bank N.V."),
    ).toBe(true);
    expect(documentNamesProduct("De Extra is", "ING Extra", "ING Bank N.V.")).toBe(false);
    expect(documentNamesProduct("Another card", "ING Creditcard More", "ING Bank N.V.")).toBe(
      false,
    );
  });
});

describe("fee period: a label before the amount is not the amount's period", () => {
  const q = "Kosten per maand € 4,00     Kosten per jaar € 48";
  it("a per-phrase that directly follows the amount decides", () => {
    expect(checkFigureQuote("accountFee", 4, "maand", q).ok).toBe(true);
    expect(checkFigureQuote("accountFee", 4, "jaar", q).ok).toBe(false);
    expect(checkFigureQuote("accountFee", 48, "jaar", q).ok).toBe(true);
    expect(checkFigureQuote("accountFee", 48, "maand", q).ok).toBe(false);
  });
  it("short per-phrases directly after the amount decide", () => {
    expect(checkFigureQuote("accountFee", 4, "maand", "Kosten kaart € 4,00 p/m en meer").ok).toBe(
      true,
    );
    expect(checkFigureQuote("accountFee", 4, "maand", "Kosten kaart € 4,00 p.m. en meer").ok).toBe(
      true,
    );
    expect(checkFigureQuote("accountFee", 4, "jaar", "Kosten kaart € 4,00 p/m en meer").ok).toBe(
      false,
    );
  });
});

describe("a stripped name form keeps two words", () => {
  const ING = ["ING Go", "ING More", "ING Extra", "ING Max"];
  const b = (product: string) => ({
    product,
    issuer: "ING Bank N.V.",
    siblings: ING.filter((n) => n !== product),
  });
  it("a one-word remainder does not name the product", () => {
    const q = "Extra kaart € 7,00 per maand en bij Extra € 15,99 per maand";
    expect(checkFigureQuote("accountFee", 15.99, "maand", q, b("ING Extra"))).toEqual({
      ok: false,
      reason: "quote does not name the product",
    });
  });
  it("the full names in the header row still pass", () => {
    const row =
      "Betaalpakketten ING Go ING More ING Extra ING Max\n Kosten per maand € 4,00 € 7,00 € 15,99 € 44,99";
    expect(checkFigureQuote("accountFee", 15.99, "maand", row, b("ING Extra")).ok).toBe(true);
  });
});

describe("documentNamesProduct on word boundaries", () => {
  it("a longer sibling name does not name the shorter product", () => {
    const names = ["ING Creditcard More"];
    expect(
      documentNamesProduct("De ING Creditcard More is", "ING Creditcard", "ING Bank N.V.", names),
    ).toBe(false);
    expect(
      documentNamesProduct("De ING Creditcards zijn", "ING Creditcard", "ING Bank N.V.", names),
    ).toBe(false);
    expect(
      documentNamesProduct("De ING Creditcard is", "ING Creditcard", "ING Bank N.V.", names),
    ).toBe(true);
    expect(
      documentNamesProduct(
        "De ING Creditcard More en de ING Creditcard",
        "ING Creditcard",
        "ING Bank N.V.",
        names,
      ),
    ).toBe(true);
  });
  it("matches whole words only", () => {
    expect(documentNamesProduct("ING Goldcard", "ING Go", "ING Bank N.V.")).toBe(false);
  });
});

describe("a range bound is not a standing figure", () => {
  const rejectedAsBound = (v: ReturnType<typeof checkFigureQuote>) =>
    expect(v).toMatchObject({ ok: false, reason: expect.stringContaining("range bound") });
  it("Get up to 2% crypto cashback does not give 2", () => {
    rejectedAsBound(
      checkFigureQuote("cashbackPct", 2, undefined, "Get up to 2% crypto cashback in Credit Mode."),
    );
  });
  it("tot 3 punten per euro does not give 3", () => {
    rejectedAsBound(
      checkFigureQuote("pointsPerEuro", 3, undefined, "Spaar tot 3 punten per euro bij partners."),
    );
    rejectedAsBound(
      checkFigureQuote("pointsPerEuro", 3, undefined, "Spaar tot wel 3 punten per euro."),
    );
  });
  it("vanaf € 4,00 per maand does not give a fee of 4", () => {
    rejectedAsBound(
      checkFigureQuote("accountFee", 4, "maand", "Betaalrekening ING Go vanaf € 4,00 per maand."),
    );
  });
  it("maximaal 1% cashback is rejected", () => {
    rejectedAsBound(
      checkFigureQuote("cashbackPct", 1, undefined, "Maximaal 1% cashback op al je aankopen."),
    );
    rejectedAsBound(checkFigureQuote("cashbackPct", 1, undefined, "Max. 1% cashback op aankopen."));
    rejectedAsBound(
      checkFigureQuote("cashbackPct", 1, undefined, "Starting at 1% cashback on purchases."),
    );
  });
  it("a plain figure still passes", () => {
    expect(checkFigureQuote("cashbackPct", 2, undefined, "2% cashback op al je aankopen").ok).toBe(
      true,
    );
  });
  it("a date range before the number does not bind to it", () => {
    expect(
      checkFigureQuote("cashbackPct", 2, undefined, "Van 1 tot 31 maart 2% cashback op aankopen")
        .ok,
    ).toBe(true);
  });
});

describe("binding against every product of the issuer", () => {
  const abn: Binding = {
    product: "ABN AMRO Credit Card",
    issuer: "ABN AMRO Bank N.V.",
    siblings: [],
    others: ["ABN AMRO Gold Card", "ABN AMRO Platinum Card"],
  };
  const fee = (value: number, quote: string, binding = abn) =>
    checkFigureQuote("accountFee", value, "maand", quote, binding);

  it("a quote that names only another product of the issuer is rejected", () => {
    expect(fee(4.25, "ABN AMRO Gold Card € 4,25 per maand").ok).toBe(false);
  });
  it("a quote that names this product is accepted", () => {
    expect(fee(2.55, "ABN AMRO Credit Card € 2,55 per maand").ok).toBe(true);
    expect(fee(2.55, "Credit Card € 2,55 per maand").ok).toBe(true);
  });
  it("a name-less single amount stays accepted unless the name is required", () => {
    expect(fee(2.55, "Kosten voor het houden van de kaart € 2,55 per maand").ok).toBe(true);
    expect(
      fee(2.55, "Kosten voor het houden van de kaart € 2,55 per maand", {
        ...abn,
        requireName: true,
      }),
    ).toEqual({ ok: false, reason: "quote does not name the product" });
    expect(
      fee(2.55, "ABN AMRO Credit Card € 2,55 per maand", { ...abn, requireName: true }).ok,
    ).toBe(true);
  });
  it("a quote that names this product and another one with a single amount is rejected", () => {
    expect(fee(2.55, "ABN AMRO Credit Card en Gold Card € 2,55 per maand").ok).toBe(false);
    expect(
      checkFigureQuote(
        "pointsPerEuro",
        1,
        undefined,
        "Credit Card 1 punt per euro, ABN AMRO Gold Card 2 punten per euro",
        abn,
      ).ok,
    ).toBe(false);
  });
  it("points and cashback quotes that name only another product are rejected", () => {
    expect(
      checkFigureQuote(
        "pointsPerEuro",
        2,
        undefined,
        "Met de ABN AMRO Gold Card spaar je 2 punten per euro",
        abn,
      ).ok,
    ).toBe(false);
    expect(
      checkFigureQuote(
        "cashbackPct",
        2,
        undefined,
        "ABN AMRO Platinum Card geeft 2% cashback op alles",
        abn,
      ).ok,
    ).toBe(false);
  });
  it("parseConfirmReply applies the other names of the issuer", () => {
    const text = "ABN AMRO Credit Card € 2,55 per maand. ABN AMRO Gold Card € 4,25 per maand.";
    const r: ConfirmRequest = {
      product: "ABN AMRO Credit Card",
      issuer: "ABN AMRO Bank N.V.",
      field: "accountFee",
      storedValue: 4.25,
      storedPeriod: "maand",
      storedConditions: null,
      text,
      siblings: [],
      others: ["ABN AMRO Gold Card"],
    };
    expect(
      parseConfirmReply(
        { status: "still_stated", quote: "ABN AMRO Gold Card € 4,25 per maand" },
        r,
      ),
    ).toBeNull();
    expect(
      parseConfirmReply(
        { status: "still_stated", quote: "ABN AMRO Credit Card € 2,55 per maand" },
        { ...r, storedValue: 2.55 },
      ),
    ).not.toBeNull();
  });
});

describe("points per spend amount", () => {
  const pts = (value: number, quote: string) =>
    checkFigureQuote("pointsPerEuro", value, undefined, quote).ok;

  it("1 punt per € 2 gives 0.5 and nothing else", () => {
    expect(pts(1, "Je spaart 1 punt per € 2 besteed")).toBe(false);
    expect(pts(0.5, "Je spaart 1 punt per € 2 besteed")).toBe(true);
    expect(pts(2, "Je spaart 1 punt per € 2 besteed")).toBe(false);
  });
  it("2 punten per euro gives 2, 1 punt per € 5 gives 0.2", () => {
    expect(pts(2, "Je spaart 2 punten per euro besteed")).toBe(true);
    expect(pts(2, "Je spaart 2 punten per € 1 besteed")).toBe(true);
    expect(pts(1, "Je spaart 2 punten per euro besteed")).toBe(false);
    expect(pts(0.2, "Je spaart 1 punt per € 5 besteed")).toBe(true);
    expect(pts(1, "Je spaart 1 punt per € 5 besteed")).toBe(false);
    expect(pts(0.8, "Je spaart 4 punten per € 5 besteed")).toBe(true);
  });
  it("every wording of a spend amount other than 1 is read as that amount", () => {
    for (const quote of [
      "Earn 1 point for every €2 spent on your card",
      "Je spaart 1 punt per 2 euro aan aankopen",
      "Je spaart 1 punt voor elke 2 euro",
      "Je spaart 1 punt per 2 uitgegeven euro's",
      "Je spaart 1 punt voor elke € 2 die je uitgeeft",
    ]) {
      expect(pts(1, quote), quote).toBe(false);
      expect(pts(0.5, quote), quote).toBe(true);
    }
  });
  it("a spend amount of 1 or none still reads as per euro", () => {
    for (const quote of [
      "Je spaart 1 punt per euro die je uitgeeft",
      "Je spaart 1 punt per € 1 besteed",
      "Je spaart 1 punt per 1 euro besteed",
      "Je spaart 1 punt voor elke uitgegeven euro",
      "Earn 1 point for every euro you spend",
      "1 Membership Rewards punt per uitgegeven euro",
    ]) {
      expect(pts(1, quote), quote).toBe(true);
      expect(pts(0.5, quote), quote).toBe(false);
    }
  });
  it("a per-phrase that is no spend amount does not count", () => {
    expect(pts(1, "Je krijgt 1 punt per maand als je de kaart gebruikt")).toBe(false);
    expect(pts(1, "Je krijgt 1 punt per aankoop met de kaart in de winkel")).toBe(false);
  });
  it("the changed reply of a zero by absence needs the converted rate too", () => {
    const text = "Met deze kaart spaar je 1 punt per € 2 die je uitgeeft.";
    const r: ConfirmRequest = {
      product: "P",
      field: "pointsPerEuro",
      storedValue: 0,
      storedConditions: null,
      zeroByAbsence: true,
      text,
    };
    expect(parseConfirmReply({ status: "changed", quote: text, newValue: 1 }, r)).toBeNull();
    expect(parseConfirmReply({ status: "changed", quote: text, newValue: 0.5 }, r)).not.toBeNull();
  });
  it("the prompts say how a rate per another amount is read", () => {
    const { system } = buildConfirmPrompt({
      product: "P",
      field: "pointsPerEuro",
      storedValue: 0.5,
      storedConditions: null,
      text: "x",
    });
    expect(system).toMatch(/divided by/i);
  });
});

describe("fee period", () => {
  const fee = (value: number, period: "maand" | "jaar", quote: string) =>
    checkFigureQuote("accountFee", value, period, quote).ok;
  const header = "Prijs per maand Prijs per jaar Betaalpakket € 4,00 € 48,00";

  it("a stacked header does not decide the period", () => {
    expect(fee(4, "jaar", header)).toBe(false);
    expect(fee(4, "maand", header)).toBe(false);
    expect(fee(48, "jaar", header)).toBe(false);
    expect(fee(48, "maand", header)).toBe(false);
  });
  it("a quarter, week, day or transaction amount confirms neither period", () => {
    const q = "Kosten pakket: € 12 per kwartaal (€ 4 per maand)";
    expect(fee(12, "maand", q)).toBe(false);
    expect(fee(12, "jaar", q)).toBe(false);
    expect(fee(4, "maand", q)).toBe(true);
    for (const unit of [
      "week",
      "dag",
      "transactie",
      "quarter",
      "halfjaar",
      "6 maanden",
      "opname",
    ]) {
      expect(fee(4, "maand", `Kosten pakket € 4,00 per ${unit}`), unit).toBe(false);
      expect(fee(4, "jaar", `Kosten pakket € 4,00 per ${unit}`), unit).toBe(false);
    }
  });
  it("inflected period words decide", () => {
    expect(fee(4, "maand", "De maandelijkse kosten voor dit pakket zijn € 4,00.")).toBe(true);
    expect(fee(4, "jaar", "De maandelijkse kosten voor dit pakket zijn € 4,00.")).toBe(false);
    expect(fee(48, "jaar", "Jaarlijkse bijdrage € 48 (€ 4 per maand)")).toBe(true);
    expect(fee(4, "maand", "Jaarlijkse bijdrage € 48 (€ 4 per maand)")).toBe(true);
  });
  it("a period word that belongs to a later amount does not decide", () => {
    expect(fee(4, "maand", "Kosten kaart € 4,00 en € 7,00 per maand")).toBe(false);
  });
  it("a repeated period word of one period is no header", () => {
    expect(fee(4, "maand", "Maandelijkse kosten per maand € 4,00")).toBe(true);
  });
});

describe("cashback and points quote details", () => {
  const cb = (value: number, quote: string) =>
    checkFigureQuote("cashbackPct", value, undefined, quote).ok;
  it("a negated cashback word does not tie a percentage", () => {
    expect(cb(2, "Geen cashback. Bij betalen in vreemde valuta 2% koersopslag")).toBe(false);
    expect(cb(2, "No cashback; foreign currency payments carry a 2% surcharge")).toBe(false);
  });
  it("a percentage followed by a fee word is not cashback", () => {
    expect(cb(2, "Ontvang cashback of 2% koersopslag bij valuta")).toBe(false);
  });
  it("a plain cashback quote still passes", () => {
    expect(cb(1, "Krijg 1% cashback op je aankopen")).toBe(true);
    expect(cb(1.5, "Krijg 1,5 % cashback op alles")).toBe(true);
  });
  it("a bound word with filler is a range bound", () => {
    expect(cb(1, "Get up to a maximum of 1% cashback on spend")).toBe(false);
    expect(cb(1, "Ontvang tot een maximum van 1% cashback")).toBe(false);
  });
});

describe("round 2: other-unit words are period words", () => {
  const fee = (value: number, period: "maand" | "jaar", quote: string) =>
    checkFigureQuote("accountFee", value, period, quote).ok;

  it("a unit word before the amount decides and rejects", () => {
    expect(fee(12, "maand", "Per kwartaal: € 12. Per maand: € 4")).toBe(false);
    expect(fee(4, "maand", "Per kwartaal: € 12. Per maand: € 4")).toBe(true);
    expect(fee(12, "maand", "Kosten per maand per kwartaal: Pakket € 4 € 12")).toBe(false);
    expect(fee(4, "maand", "Kosten per maand per kwartaal: Pakket € 4 € 12")).toBe(false);
  });
  it("week, day and similar abbreviations directly after the amount reject it", () => {
    for (const quote of [
      "Pakket € 4 p/w, rekening per maand",
      "Pakket € 4 p.w. maandelijks gefactureerd",
      "Pakket € 4 per wk, maandelijks gefactureerd",
      "Pakket € 4 per etmaal, factuur per maand",
      "Pakket € 4 per week, dat is per maand veel",
    ]) {
      expect(fee(4, "maand", quote), quote).toBe(false);
      expect(fee(4, "jaar", quote), quote).toBe(false);
    }
    expect(fee(16, "maand", "€ 4 per week, € 16 per maand")).toBe(true);
  });
  it("the pinned period cases still hold", () => {
    expect(fee(4, "maand", "Kosten per maand € 4,00     Kosten per jaar € 48")).toBe(true);
    expect(fee(48, "jaar", "Kosten per maand € 4,00     Kosten per jaar € 48")).toBe(true);
    expect(fee(4, "maand", "Kosten: € 4,00 per maand (€ 48 per jaar)")).toBe(true);
  });
});

describe("round 2: a shortened label of another product names a rival", () => {
  const abn: Binding = {
    product: "ABN AMRO Credit Card",
    issuer: "ABN AMRO Bank N.V.",
    siblings: [],
    others: ["ABN AMRO Gold Card", "ABN AMRO Business Gold Card"],
  };
  const ics: Binding = {
    product: "ICS Visa World Card",
    issuer: "International Card Services B.V. (ICS, an ABN AMRO subsidiary)",
    siblings: [],
    others: ["ICS Visa World Card Gold", "ICS Visa World Card Platinum", "ICS Mastercard Gold"],
  };
  it("Gold Card is not the ABN AMRO Credit Card", () => {
    expect(
      checkFigureQuote("accountFee", 4.25, "maand", "Gold Card € 4,25 per maand", abn).ok,
    ).toBe(false);
    expect(
      checkFigureQuote("accountFee", 2.55, "maand", "Credit Card € 2,55 per maand", abn).ok,
    ).toBe(true);
  });
  it("Gold is not the ICS Visa World Card", () => {
    expect(
      checkFigureQuote("accountFee", 175, "jaar", "Gold € 175 per jaar bij ICS kaarten", ics).ok,
    ).toBe(false);
    expect(
      checkFigureQuote("accountFee", 42.95, "jaar", "World Card € 42,95 per jaar", ics).ok,
    ).toBe(true);
  });
  it("points and cashback quotes with such a label are rejected too", () => {
    expect(checkFigureQuote("pointsPerEuro", 2, undefined, "Gold: 2 punten per euro", ics).ok).toBe(
      false,
    );
  });
  it("the Amex Gold Card and the ING header row still pass", () => {
    const amex: Binding = {
      product: "American Express Gold Card",
      issuer: "American Express (self-issued in NL; NOT ICS)",
      siblings: [],
      others: ["American Express Platinum Card", "Flying Blue - American Express Gold Card"],
    };
    expect(
      checkFigureQuote("accountFee", 20, "maand", "The Gold Card € 20,00 per maand", amex).ok,
    ).toBe(true);
  });
});

describe("a zero account fee is never confirmed from a quote", () => {
  const own: Binding = { product: "Alpha Platinum Card", issuer: "Alpha Bank", siblings: [] };
  const verdict = (quote: string, period: "maand" | "jaar" = "maand", binding?: Binding) =>
    checkFigureQuote("accountFee", 0, period, quote, binding);
  const amex =
    "Uw kaart                    Kaartlidmaatschapsbijdrage\n\n\n\n                            Basis bijdragen                          Additionele kaarten 2\n\n\n\nThe Blue Card               € 0 per jaar 1                           Extra kaart";

  it("rejects the wrong accepts of the earlier rule designs", () => {
    for (const quote of [
      "Extra kaart € 0 per maand",
      "Voor leden is de jaarbijdrage gratis",
      "Jaarbijdrage gratis voor dit jaar",
      "Kosten kaart € 0 voor de rekening",
      "Jaarbijdrage gratis voor studenten",
    ]) {
      expect(verdict(quote).ok, quote).toBe(false);
    }
  });

  it("rejects the forms that were accepted before", () => {
    expect(verdict("Jaarbijdrage: gratis", "jaar").ok).toBe(false);
    expect(verdict("Kosten per maand: € 0,00").ok).toBe(false);
    expect(verdict(amex, "jaar", own).ok).toBe(false);
    expect(verdict("Alpha Platinum Card kosten € 0 per maand", "maand", own).ok).toBe(false);
  });

  it("gives the reason", () => {
    expect(verdict("Kosten per maand: € 0,00")).toEqual({
      ok: false,
      reason: "a zero fee is not confirmed from a quote",
    });
  });

  it("a stored zero fee is not confirmed by a still_stated reply", () => {
    const text = "Kosten per maand: € 0,00 voor deze rekening";
    expect(
      parseConfirmReply(
        { status: "still_stated", quote: text },
        {
          product: "ING Go",
          field: "accountFee",
          storedValue: 0,
          storedPeriod: "maand",
          storedConditions: null,
          text,
        },
      ),
    ).toBeNull();
  });

  it("the closed fee prompt no longer offers a zero wording", () => {
    const { system } = buildConfirmPrompt({
      product: "ING Go",
      field: "accountFee",
      storedValue: 4,
      storedPeriod: "maand",
      storedConditions: null,
      text: "x",
    });
    expect(system).not.toMatch(/gratis|geen kosten|zero fee/i);
  });
});

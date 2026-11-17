import { describe, expect, it } from "vitest";
import { INSTINCT_COPY } from "./copy.js";
import { renderCandidate, renderConsentReminder, renderPausedNotice } from "./render.js";
import { TIPS } from "./tips.js";
import type { Candidate } from "./types.js";

const spending: Candidate = {
  kind: "spending",
  key: "spending:2026-11-10",
  figures: { yesterdayCents: 8400, lastWeekdayCents: 4400, diffCents: 4000, weekday: 2 },
};
const renewal: Candidate = {
  kind: "deadline",
  key: "deadline:renewal:netflix|out|1599:2026-11-13",
  figures: {
    what: "renewal",
    name: "Netflix",
    dueDate: "2026-11-13",
    daysAway: 2,
    amountCents: 1599,
  },
};
const vat: Candidate = {
  kind: "deadline",
  key: "deadline:vat:BTW Q3:2026-11-12",
  figures: { what: "vat", name: "BTW Q3", dueDate: "2026-11-12", daysAway: 1, amountCents: null },
};
const rate: Candidate = {
  kind: "better-offer",
  key: "offer:rate:Bunq",
  figures: { what: "rate", name: "Bunq", yearlyGainCents: 12000 },
};
const card: Candidate = {
  kind: "better-offer",
  key: "offer:card:Kaart",
  figures: { what: "card", name: "Kaart", yearlyGainCents: 6000 },
};
const tips: Candidate[] = TIPS.map((t) => ({
  kind: "tip" as const,
  key: `tip:${t.id}`,
  figures: { tipId: t.id },
}));
const all = [spending, renewal, vat, rate, card, ...tips];

describe("renderCandidate", () => {
  it("spending NL", () => {
    expect(renderCandidate(spending, "nl").short).toBe(
      "Je gaf gisteren € 84 uit, € 40 meer dan vorige dinsdag.",
    );
  });
  it("spending EN", () => {
    expect(renderCandidate(spending, "en").short).toBe(
      "You spent €84 yesterday, €40 more than last Tuesday.",
    );
  });
  it("spending below last week says less", () => {
    const c: Candidate = {
      ...spending,
      figures: {
        ...spending.figures,
        yesterdayCents: 4400,
        lastWeekdayCents: 8400,
        diffCents: -4000,
      },
    };
    expect(renderCandidate(c, "nl").short).toContain("€ 40 minder dan vorige dinsdag");
  });
  it("renewal shows cents when not whole and a relative day", () => {
    expect(renderCandidate(renewal, "nl").short).toBe(
      "Netflix wordt over 2 dagen verlengd, € 15,99.",
    );
    expect(renderCandidate(renewal, "en").short).toBe("Netflix renews in 2 days, €15.99.");
  });
  it("due date NL and EN", () => {
    expect(renderCandidate(vat, "nl").short).toBe("BTW Q3 is morgen aan de beurt, op 12 nov.");
    expect(renderCandidate(vat, "en").short).toBe("BTW Q3 is due tomorrow, on 12 Nov.");
  });
  it("offers", () => {
    expect(renderCandidate(rate, "nl").short).toContain("€ 120");
    expect(renderCandidate(card, "en").short).toContain("€60");
  });

  it("every channel text fits: short at most 120 characters, no newlines", () => {
    for (const loc of ["nl", "en"] as const)
      for (const c of all) {
        const r = renderCandidate(c, loc);
        expect(r.short.length).toBeLessThanOrEqual(120);
        expect(r.short).not.toMatch(/[\n\r\t]/);
        expect(r.whatsappParams).toEqual([r.short]);
        expect(r.long.length).toBeGreaterThanOrEqual(r.short.length);
      }
  });
  it("worst case: 40 char name and EUR 123456,78 gain keeps short at 120", () => {
    const name = "N".repeat(40);
    for (const loc of ["nl", "en"] as const)
      for (const what of ["rate", "card"] as const) {
        const c: Candidate = {
          kind: "better-offer",
          key: "offer:x",
          figures: { what, name, yearlyGainCents: 12_345_678 },
        };
        expect(renderCandidate(c, loc).short.length).toBeLessThanOrEqual(120);
      }
  });
  it("a long merchant name is clipped so push stays short", () => {
    const c: Candidate = {
      ...renewal,
      figures: { ...(renewal as { figures: object }).figures, name: "X".repeat(200) } as never,
    };
    expect(renderCandidate(c, "nl").short.length).toBeLessThanOrEqual(120);
  });

  it("no hyphen inside a sentence of the library copy", () => {
    for (const loc of ["nl", "en"] as const) {
      const k = INSTINCT_COPY[loc];
      const texts = [
        ...all.flatMap((c) => {
          const r = renderCandidate(c, loc);
          return [r.title, r.short, r.long];
        }),
        ...Object.values(k.tips).flatMap((t) => [t.title, t.short, t.long]),
      ];
      for (const t of texts) expect(t).not.toMatch(/[-–—]/);
    }
  });

  it("EN has no Dutch words", () => {
    const dutch =
      /\b(je|jouw|gaf|gisteren|uit|meer|minder|dan|vorige|wordt|verlengd|bij|rente|abonnement\w*|nog|voor|het|een|van|over|aan|de)\b/i;
    for (const c of all) {
      const r = renderCandidate(c, "en");
      for (const t of [r.title, r.short, r.long].map((s) =>
        s.replace(/Optimalisatie|LaVega|BTW Q3/g, ""),
      ))
        expect(t).not.toMatch(dutch);
    }
  });

  it("every tip id has both locales", () => {
    for (const loc of ["nl", "en"] as const)
      for (const t of TIPS) {
        const tp = INSTINCT_COPY[loc].tips[t.id];
        expect(tp.title && tp.short && tp.long).toBeTruthy();
      }
    expect(Object.keys(INSTINCT_COPY.nl.tips).sort()).toEqual(TIPS.map((t) => t.id).sort());
    expect(Object.keys(INSTINCT_COPY.en.tips).sort()).toEqual(TIPS.map((t) => t.id).sort());
  });

  it("interpolates only figures: strip them and no digit or key is left", () => {
    const r = renderCandidate(spending, "nl");
    for (const t of [r.title, r.short, r.long]) {
      expect(t.replace(/€ \d+/g, "")).not.toMatch(/\d/);
      expect(t).not.toContain("spending:");
    }
    const d = renderCandidate(renewal, "en");
    for (const t of [d.title, d.short, d.long]) expect(t).not.toContain("deadline:");
  });

  it("an unknown tip id throws without echoing the key", () => {
    const bad = { kind: "tip", key: "tip:x", figures: { tipId: "nope" } } as Candidate;
    expect(() => renderCandidate(bad, "nl")).toThrow("unknown tip");
  });

  it("consent reminder and paused notice", () => {
    expect(renderConsentReminder("nl").title).toBe("Koppel je bank opnieuw");
    expect(renderConsentReminder("en").title).toBe("Reconnect your bank");
    expect(renderPausedNotice("nl").short).toContain("pauze");
    expect(renderPausedNotice("en").short).toContain("paused");
    expect(renderPausedNotice("nl").short.length).toBeLessThanOrEqual(120);
  });
});

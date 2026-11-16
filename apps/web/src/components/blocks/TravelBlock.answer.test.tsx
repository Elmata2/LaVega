// @vitest-environment jsdom
import { expect, test } from "vitest";
import type { JourneyHeadline, PayHeadline, WithdrawalHeadline } from "@lavega/core";
import { payAnswer, withdrawAnswer, type TravelAnswer } from "./TravelBlock";
import { optimiseCopy } from "../../copy/optimise.js";

/* Every variant of the two answers, in both languages, from core's structs:
 * ONE short line (the move and the number, at most 12 words), the reasoning in
 * at most two sentences behind the "i". Euro formatting differs per locale, so
 * the expected strings are written out by hand per language. */

const nl = optimiseCopy.nl.travel;
const en = optimiseCopy.en.travel;
const railNl = nl.railFor("NL");
const railEn = en.railFor("NL");
const NBSP = / /g;
const flat = (a: TravelAnswer): TravelAnswer => ({
  line: a.line.replace(NBSP, " "),
  why: a.why.map((w) => w.replace(NBSP, " ")),
  caution: a.caution?.replace(NBSP, " "),
});

/** Product names are catalogue data, so the limit counts the line WITHOUT them. */
const words = (s: string, names: string[] = []) =>
  names
    .reduce((acc, n) => acc.split(n).join("X"), s)
    .trim()
    .split(/\s+/).length;
const NAMES = [
  "Revolut betaalpas",
  "Revolut debit card",
  "ING betaalpas",
  "N26 betaalpas",
  "N26 debit card",
  "Wise betaalpas",
  "Crypto.com Prepaid Card — Basic (Midnight Blue)",
];
const FORBIDDEN = /advies|adviseur|advice|adviser/i;

function check(a: TravelAnswer, names: string[] = NAMES) {
  expect(words(a.line, names)).toBeLessThanOrEqual(12);
  expect(a.why.join(" ")).not.toMatch(FORBIDDEN);
  expect(a.line).not.toMatch(FORBIDDEN);
  expect(NAMES.reduce((acc, n) => acc.split(n).join("X"), a.line)).not.toContain("—");
  return a;
}

const none = { kind: "none" } as const;
type Route = Extract<JourneyHeadline, { kind: "route" }>;
const route = (
  head: Route["head"],
  costOnReference: number | null,
  versus: Route["versus"] = none,
): PayHeadline => ({
  kind: "journey",
  headline: { kind: "route", head, costOnReference, versus },
});

const pay = (h: PayHeadline, tail = true) => [
  flat(check(payAnswer(h, nl, "nl", railNl, tail))),
  flat(check(payAnswer(h, en, "en", railEn, tail))),
];

test("own card is best: the card and the number; 'cheapest you hold' behind the i", () => {
  const [a, b] = pay(route({ kind: "direct", provider: "Revolut betaalpas" }, 4));
  expect(a.line).toBe("Betaal met Revolut betaalpas: € 4,00 op € 1.000.");
  expect(a.why).toEqual(["Dit is de goedkoopste kaart die je al hebt."]);
  expect(b.line).toBe("Pay with Revolut debit card: €4.00 per €1,000.");
  expect(b.why).toEqual(["Cheapest card you already hold."]);
});

test("own card is best and free: says so; the comparison rides behind the i", () => {
  const [a, b] = pay(
    route({ kind: "direct", provider: "Revolut betaalpas" }, 0, {
      kind: "cheaper",
      savingEuros: 12,
      alt: { kind: "via", via: "Wise betaalpas" },
    }),
  );
  expect(a.line).toBe("Betaal met Revolut betaalpas: geen wisselkosten.");
  expect(a.why).toEqual([
    "Dit is de goedkoopste kaart die je al hebt.",
    "Dat is € 12,00 goedkoper dan via Wise betaalpas.",
  ]);
  expect(b.line).toBe("Pay with Revolut debit card: no exchange fee.");
  expect(b.why[1]).toBe("That's €12.00 cheaper than via Wise debit card.");
});

test("via a transfer: move, then pay; the free rail and who moves it behind the i", () => {
  const [a, b] = pay(
    route({ kind: "via", fundedFrom: "ING betaalpas", via: "Revolut betaalpas", free: true }, 3),
  );
  expect(a.line).toBe("Zet geld over naar Revolut betaalpas, betaal daar: € 3,00 op € 1.000.");
  expect(a.why).toEqual([
    "Overzetten van ING betaalpas via iDEAL is gratis.",
    "LaVega verplaatst zelf niets.",
  ]);
  expect(b.line).toBe("Move money to Revolut debit card, pay there: €3.00 per €1,000.");
  expect(b.why).toEqual([
    "Transfer from ING betaalpas via iDEAL is free.",
    "LaVega moves nothing itself.",
  ]);
});

test("via a transfer with a comparison: two sentences, the comparison replaces the LaVega note", () => {
  const [a] = pay(
    route({ kind: "via", fundedFrom: "ING betaalpas", via: "Revolut betaalpas", free: true }, 3, {
      kind: "cheaper",
      savingEuros: 5,
      alt: { kind: "direct", provider: "ING betaalpas" },
    }),
  );
  expect(a.why).toEqual([
    "Overzetten van ING betaalpas via iDEAL is gratis.",
    "Dat is € 5,00 goedkoper dan direct met ING betaalpas.",
  ]);
});

test("catalogue card, not held: open it, the number, the saving; why behind the i", () => {
  const h: PayHeadline = {
    kind: "catalogue-card",
    product: "N26 betaalpas",
    costOnReference: 0,
    savingOnReference: 14,
    ownProduct: "ING betaalpas",
    holdingCost: { kind: "bare", clause: { kind: "free", product: "N26 betaalpas" } },
  };
  const [a, b] = pay(h, false);
  // The saving is GROSS, so it never stands without the card it is measured against.
  expect(a.line).toBe("Open N26 betaalpas: € 14,00 minder dan met je ING betaalpas op € 1.000.");
  expect(a.line).toContain("ING betaalpas");
  expect(a.why).toEqual(["Deze kaart: geen wisselkosten.", "Je hebt deze kaart nog niet."]);
  expect(b.line).toBe("Open N26 debit card: €14.00 less than with your ING debit card per €1,000.");
  expect(b.why).toEqual(["This card: no exchange fee.", "You don't hold this card yet."]);

  // Without visible Kaartkosten fields the card's own price rides behind the i.
  const [withTail] = pay(h, true);
  expect(withTail.why.join(" ")).toContain("kost zelf niets");
});

test("catalogue card with a priced route and nothing to compare", () => {
  const [a] = pay(
    {
      kind: "catalogue-card",
      product: "N26 betaalpas",
      costOnReference: 4,
      savingOnReference: null,
      ownProduct: null,
      holdingCost: { kind: "bare", clause: null },
    },
    false,
  );
  expect(a.line).toBe("Open N26 betaalpas: € 4,00 op € 1.000.");
  expect(a.line).not.toMatch(/minder/);
  expect(a.why).toEqual(["Je hebt deze kaart nog niet."]);
});

test("euro country: nothing to exchange, in both languages", () => {
  const [a, b] = pay({ kind: "eur" });
  expect(a.line).toBe("Daar betaal je in euro's: niets te wisselen.");
  expect(b.line).toBe("You pay in euros there: nothing to exchange.");
});

test("no priced route: a short line, no refresh instruction", () => {
  const [a, b] = pay({ kind: "journey", headline: { kind: "no-route" } });
  expect(a.line).toBe("Nog geen tarieven van je kaarten bekend.");
  expect(b.line).toBe("No fees known for your cards yet.");
  expect(a.line).not.toMatch(/ververs/i);
});

const pin = (h: WithdrawalHeadline, tail = true) => [
  flat(check(withdrawAnswer(h, nl, "nl", tail))),
  flat(check(withdrawAnswer(h, en, "en", tail))),
];

test("pinnen, held: the card and the price per EUR 200; flat-fee note behind the i", () => {
  const [a, b] = pin({
    kind: "held",
    product: "Revolut betaalpas",
    costOnReference: 3.5,
    effectivePct: 1.75,
    small: { kind: "penalised", provider: "Revolut betaalpas", smallEffectivePct: 7 },
    missingCashNote: { kind: "some", missing: ["Knab betaalpas"] },
  });
  expect(a.line).toBe("Pin met Revolut betaalpas: € 3,50 op € 200 (1,75%).");
  expect(a.caution).toBe(
    "Vast bedrag per opname bij Revolut betaalpas: € 50,00 pinnen kost 7%. Neem in één keer meer op.",
  );
  expect(a.why).toEqual([
    "Onbekend is niet gratis: onze bron noemt geen pinprijs van Knab betaalpas.",
  ]);
  expect(b.line).toBe("Withdraw with Revolut debit card: €3.50 per €200 (1.75%).");
  expect(b.caution).toContain("Take out more at once.");
  expect(b.why).toEqual([
    "Unknown is not free: our source gives no withdrawal price for Knab debit card.",
  ]);
});

test("pinnen, held with nothing to explain: no i at all", () => {
  const [a] = pin({
    kind: "held",
    product: "Revolut betaalpas",
    costOnReference: 0,
    effectivePct: null,
    small: none,
    missingCashNote: none,
  });
  expect(a.why).toEqual([]);
});

test("pinnen, not held: the card and the price; own-card comparison behind the i", () => {
  const [a, b] = pin(
    {
      kind: "not-held",
      product: "N26 betaalpas",
      costOnReference: 0,
      effectivePct: null,
      own: {
        kind: "known",
        ownProduct: "ING betaalpas",
        ownCostOnReference: 6.3,
        extraCostVsWinner: 6.3,
      },
      holdingCost: { kind: "bare", clause: null },
      small: none,
      missingCashNote: none,
    },
    false,
  );
  // Not held and not named on the pay line: the verb marks the card.
  expect(a.line).toBe("Open N26 betaalpas om te pinnen: € 0,00 op € 200.");
  expect(a.why).toEqual([
    "Van je eigen kaarten pin je het goedkoopst met ING betaalpas: € 6,30, dus € 6,30 duurder.",
  ]);
  expect(b.line).toBe("Open N26 debit card to withdraw: €0.00 per €200.");
});

test("pinnen, not held and the SAME card the pay line already names: plain 'Pin met', no open wording", () => {
  const h: WithdrawalHeadline = {
    kind: "not-held",
    product: "N26 betaalpas",
    costOnReference: 0,
    effectivePct: null,
    own: { kind: "unknown" },
    holdingCost: { kind: "bare", clause: null },
    small: none,
    missingCashNote: none,
  };
  const a = flat(check(withdrawAnswer(h, nl, "nl", false, "N26 betaalpas")));
  const b = flat(check(withdrawAnswer(h, en, "en", false, "N26 betaalpas")));
  expect(a.line).toBe("Pin met N26 betaalpas: € 0,00 op € 200.");
  expect(b.line).toBe("Withdraw with N26 debit card: €0.00 per €200.");
  // A different pay-line card does not count as "already named".
  const c = flat(check(withdrawAnswer(h, nl, "nl", false, "ING betaalpas")));
  expect(c.line).toMatch(/^Open N26 betaalpas om te pinnen: /);
  // The explanation behind the i is unchanged.
  expect(a.why).toEqual(["Van je eigen kaarten kennen we geen opnametarief."]);
});

test("pinnen, unknown / no cards / euro country", () => {
  const [a, b] = pin({ kind: "no-known-price", missingCashNote: none });
  expect(a.line).toBe("Pinprijs van je kaarten onbekend.");
  expect(a.why).toEqual(["Pinnen is een aparte prijs, meestal hoger dan betalen."]);
  expect(b.line).toBe("Withdrawal price of your cards unknown.");
  expect(b.why).toEqual(["Withdrawing is priced separately, usually higher than paying."]);

  const [c, d] = pin({ kind: "no-accounts" });
  expect(c.line).toBe("Nog geen kaart om mee te pinnen.");
  expect(d.line).toBe("No card to withdraw with yet.");

  const [e, f] = pin({ kind: "eur" });
  expect(e.line).toBe("Daar pin je in euro's: geen opslag voor vreemde valuta.");
  expect(e.why).toEqual(["Wat je bank voor een opname rekent, staat niet in onze bronnen."]);
  expect(f.why).toEqual(["What your bank charges for a withdrawal isn't in our sources."]);
});

test("the empty states are one short line each", () => {
  expect(nl.empty).toBe("Kies een land voor je beste kaart.");
  expect(en.empty).toBe("Pick a country for your best card.");
  expect(nl.answer.noCard).toBe("Nog geen kaart bekend.");
  expect(en.answer.noCard).toBe("No card known yet.");
});

test("a long real catalogue name does not break the word limit: names are data", () => {
  const name = "Crypto.com Prepaid Card — Basic (Midnight Blue)";
  const a = flat(
    check(
      withdrawAnswer(
        {
          kind: "held",
          product: name,
          costOnReference: 0.4,
          effectivePct: 0.2,
          small: none,
          missingCashNote: none,
        },
        nl,
        "nl",
        true,
      ),
    ),
  );
  expect(a.line).toBe(`Pin met ${name}: € 0,40 op € 200 (0,2%).`);
  // The full name is left as is: the catalogue has no short-name field.
});

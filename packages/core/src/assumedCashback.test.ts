import { describe, expect, test } from "vitest";
import {
  cashbackPctOf,
  describeHeldCashback,
  heldCashbackOf,
  type HeldCashback,
} from "./assumedCashback.js";

/* DE EIGEN KAARTEN, en hoe hard we hun cashback kennen (app review 4, punt 22).
 *
 * De afbakening zelf — wie er wel en niet onder de aanname valt — staat in
 * catalogRates.test.ts, want daar wordt hij op catalogusrijen toegepast. Deze
 * suite gaat over de laag erboven: de VOLGORDE waarin een feit, een schakelaar
 * en een aanname elkaar verslaan. Die volgorde is wat de feedbackmodule in
 * Profiel laat werken, en één omdraaiing erin maakt zijn eigen correctie
 * onzichtbaar zonder dat er iets kapot lijkt.
 */

const ing = { issuer: "ING", kind: "betaalpas", productName: "ING betaalpas" };

describe("heldCashbackOf", () => {
  test("een feit van HEMZELF wint van de aanname", () => {
    // Dit is het hele punt van de feedbackmodule: hij typt 1,5 en de aanname is
    // weg. Zou de aanname hier winnen, dan corrigeert hij een cijfer dat daarna
    // niet verandert — de stilste manier om een gebruiker zijn vertrouwen te
    // laten verliezen.
    const k = heldCashbackOf({
      ...ing,
      fact: { pct: 1.5, source: "user", updatedAt: "2026-08-21" },
      assumptionOn: true,
    });
    expect(k).toEqual({ tier: "gemeten", pct: 1.5, source: "user", updatedAt: "2026-08-21" });
    expect(describeHeldCashback(k)).toBe("1,5%, door jou ingesteld op 2026-08-21");
  });

  test("een feit van de reisagent wint óók, maar zegt op het scherm wie het vond", () => {
    const k = heldCashbackOf({
      ...ing,
      fact: { pct: 0.5, source: "agent", updatedAt: "2026-03-02" },
      assumptionOn: true,
    });
    expect(describeHeldCashback(k)).toBe("0,5%, gevonden door de reisagent op 2026-03-02");
  });

  test("een gewone ING-pas zonder feit is AANGENOMEN nul, met het woord erbij", () => {
    const k = heldCashbackOf({
      ...ing,
      fact: null,
      assumptionOn: true,
      lastCheckedAt: "2026-06-15",
    });
    expect(k.tier).toBe("aangenomen");
    expect(cashbackPctOf(k)).toBe(0);
    expect(describeHeldCashback(k)).toContain("aangenomen: geen cashback");
  });

  test("met de schakelaar uit is het antwoord onbekend, en de melding noemt de schakelaar", () => {
    // Niet de dichtstbijzijnde reden van core lenen ("uitgever-buiten-de-aanname"
    // zou hier onwaar zijn): een melding die zijn eigen oorzaak niet noemt stuurt
    // de lezer naar de verkeerde knop.
    const k = heldCashbackOf({ ...ing, fact: null, assumptionOn: false });
    expect(k).toEqual({ tier: "uitgezet" });
    expect(cashbackPctOf(k)).toBeNull();
    expect(describeHeldCashback(k)).toContain("uitgezet");
  });

  test("de schakelaar raakt alleen de aanname, nooit een gemeten cijfer", () => {
    // Uitzetten betekent "vul niets in wat nergens staat", niet "vergeet wat ik je
    // zelf verteld heb". Zonder deze grens zou één klik zijn eigen correcties
    // wissen van het scherm.
    const k = heldCashbackOf({
      ...ing,
      fact: { pct: 1.5, source: "user", updatedAt: "2026-08-21" },
      assumptionOn: false,
    });
    expect(k.tier).toBe("gemeten");
    expect(cashbackPctOf(k)).toBe(1.5);
  });

  test("een Amex blijft onbekend, ook met de aanname aan", () => {
    const k = heldCashbackOf({
      issuer: "American Express",
      kind: "creditcard",
      productName: "American Express creditcard",
      fact: null,
      assumptionOn: true,
    });
    expect(k).toEqual({ tier: "onbekend", reason: "beloningsuitgever" });
    expect(cashbackPctOf(k)).toBeNull();
  });
});

describe("cashbackPctOf", () => {
  test("alleen gemeten en aangenomen leveren een getal", () => {
    const cases: [HeldCashback, number | null][] = [
      [{ tier: "gemeten", pct: 2, source: "agent", updatedAt: "2026-01-01" }, 2],
      [
        { tier: "aangenomen", pct: 0, issuerFamily: "ING", kind: "betaalpas", lastCheckedAt: null },
        0,
      ],
      [{ tier: "onbekend", reason: "soort-onbekend" }, null],
      [{ tier: "uitgezet" }, null],
    ];
    for (const [k, want] of cases) expect(cashbackPctOf(k), k.tier).toBe(want);
  });
});

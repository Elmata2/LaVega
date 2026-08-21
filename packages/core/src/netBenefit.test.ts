import { describe, expect, test } from "vitest";
import {
  MIN_HORIZON_MONTHS,
  compareNetBenefit,
  describeNetBenefit,
  holdingCostOfProduct,
  isRecommendation,
  marginalHoldingCost,
  netBenefit,
  rankByNetBenefit,
  type HoldingCost,
  type NetBenefit,
} from "./netBenefit.js";
import { accountFees, type AccountFeeEntryLike, type FeePeriod } from "./accountCosts.js";

/* DE CIJFERS HIERONDER ZIJN ECHT, uit docs/catalog/catalog.json (ronde augustus
 * 2026), want de hele opdracht draait om of een maandbedrag een maandbedrag
 * blijft:
 *   · ABN AMRO Gold Card                € 4,45 PER MAAND
 *   · ABN AMRO creditcard               € 2,55 PER MAAND
 *   · American Express Business Gold    € 270,00 PER JAAR
 *   · 212 Card en Trade Republic        € 0,00 per maand — een UITGESPROKEN nul
 *   · Rabobank creditcard               € 2,00 per maand "bovenop de € 3,45 per
 *                                       maand van Rabo Standaard" — dus niet de
 *                                       prijs van dit product op zichzelf
 * En € 16,99 per maand is zijn eigen voorbeeld uit de opdracht.
 */

const cost = (cents: number, period: FeePeriod = "maand"): HoldingCost => ({
  kind: "known",
  amount: {
    cents,
    period,
    perYearCents: period === "maand" ? cents * 12 : cents,
    perYearDerived: period === "maand",
  },
  why: "stated",
  sourceUrl: "https://assets.abnamro.com/informatieblad.pdf",
  asOf: "2026-01",
});

const unknown: HoldingCost = { kind: "unknown", reason: "no-source" };

const entry = (over: Partial<AccountFeeEntryLike> & { fee?: Record<string, unknown> }): AccountFeeEntryLike => {
  const { fee, ...rest } = over;
  return {
    id: "x",
    product: "X",
    kind: "creditcard",
    fields: {
      accountFee: {
        value: 4.45,
        period: "maand",
        route: "provider-pdf",
        sourceUrl: "https://assets.abnamro.com/informatieblad.pdf",
        checkedAt: "2026-01",
        conditions: null,
        conditionsKnown: true,
        ...fee,
      },
    },
    ...rest,
  };
};

const feeOf = (e: AccountFeeEntryLike) => accountFees([e])[0] ?? null;

describe("kosten bekend: er wordt netto gerekend", () => {
  test("EEN KAART DIE MEER KOST DAN HIJ OPLEVERT IS GEEN AANBEVELING", () => {
    // Zijn woorden: "als een kaart 5 euro per maand kost en ons 3 oplevert gaan we
    // er op achteruit." Terugkerend tegen terugkerend, dus schoon af te trekken.
    const b = netBenefit({ benefit: { kind: "recurring", cents: 300, period: "maand" }, cost: cost(500) });
    expect(b.kind).toBe("no-recommendation");
    expect(isRecommendation(b)).toBe(false);
    // Het bedrag valt NIET weg: hij moet kunnen zien staan dat het € 2 per maand
    // achteruit is in plaats van het zelf te moeten uitrekenen.
    if (b.kind !== "no-recommendation") throw new Error("verkeerde toestand");
    expect(b.netCents).toBe(-200);
    expect(describeNetBenefit(b)).toContain("€ 2,00");
    expect(describeNetBenefit(b)).toMatch(/achteruit/);
  });

  test("netto precies nul is ook geen aanbeveling — een stap zonder uitkomst", () => {
    const b = netBenefit({ benefit: { kind: "recurring", cents: 445, period: "maand" }, cost: cost(445) });
    expect(b.kind).toBe("no-recommendation");
    expect(describeNetBenefit(b)).toMatch(/levert niets op/);
  });

  test("blijft er iets over, dan is dát het bedrag en heet het netto", () => {
    const b = netBenefit({ benefit: { kind: "recurring", cents: 800, period: "maand" }, cost: cost(445) });
    expect(b.kind).toBe("net");
    if (b.kind !== "net") throw new Error("verkeerde toestand");
    expect(b.netCents).toBe(355);
    expect(b.grossCents).toBe(800);
    expect(b.costCents).toBe(445);
    expect(describeNetBenefit(b)).toContain("€ 3,55 netto");
  });

  test("een eenmalige winst tegen doorlopende kosten kantelt met de horizon", () => {
    // € 14 op € 1.000 is EENMALIG; € 4,45 per maand loopt door. Bij één maand is
    // het voordeel; bij vier maanden is het verlies. Zonder horizon betekent
    // 14 − 4,45 niets, en dat is precies wat hier vastligt.
    const one = netBenefit({ benefit: { kind: "one-off", cents: 1400 }, cost: cost(445), horizonMonths: 1 });
    expect(one.kind).toBe("net");
    if (one.kind !== "net") throw new Error("verkeerde toestand");
    expect(one.netCents).toBe(955);

    const four = netBenefit({ benefit: { kind: "one-off", cents: 1400 }, cost: cost(445), horizonMonths: 4 });
    expect(four.kind).toBe("no-recommendation");
    if (four.kind !== "no-recommendation") throw new Error("verkeerde toestand");
    expect(four.costCents).toBe(1780); // 4 × € 4,45, niet één keer
    expect(four.netCents).toBe(-380);
  });

  test("zijn eigen voorbeeld: € 14 winst tegen € 16,99 per maand is achteruit", () => {
    const b = netBenefit({ benefit: { kind: "one-off", cents: 1400 }, cost: cost(1699), horizonMonths: 1 });
    expect(b.kind).toBe("no-recommendation");
    if (b.kind !== "no-recommendation") throw new Error("verkeerde toestand");
    expect(b.netCents).toBe(-299);
  });
});

describe("de horizon en zijn ondergrens", () => {
  test("EEN REIS VAN EEN WEEK KOST EEN HELE MAAND KAART, en dat staat op het scherm", () => {
    // Wie een kaart opent voor één reis betaalt minstens één maandnota. Een kwart
    // maand rekenen zou € 1,11 kaartkosten opleveren, en dat bedrag bestaat niet.
    const b = netBenefit({ benefit: { kind: "one-off", cents: 1400 }, cost: cost(445), horizonMonths: 0.25 });
    if (b.kind !== "net") throw new Error("verkeerde toestand");
    expect(b.costCents).toBe(445);
    if (b.basis.kind !== "one-off") throw new Error("verkeerde basis");
    expect(b.basis.months).toBe(MIN_HORIZON_MONTHS);
    expect(b.basis.periodsCharged).toBe(1);
    expect(b.basis.flooredToMinimum).toBe(true);
    // De gebruiker moet kunnen zien over welke periode we rekenen.
    expect(describeNetBenefit(b)).toContain("over 1 maand");
    expect(describeNetBenefit(b)).toMatch(/minder dan één maand/i);
  });

  test("een ontbrekende of onzinnige horizon valt op de ondergrens terug, nooit op nul", () => {
    for (const months of [undefined, 0, -3, Number.NaN]) {
      const b = netBenefit({ benefit: { kind: "one-off", cents: 1400 }, cost: cost(445), horizonMonths: months });
      if (b.kind !== "net") throw new Error("verkeerde toestand");
      expect(b.costCents).toBe(445); // niet 0 — dat zou de kosten laten verdampen
    }
  });

  test("anderhalve maand zijn twee maandnota's, want je koopt geen halve maand", () => {
    const b = netBenefit({ benefit: { kind: "one-off", cents: 5000 }, cost: cost(445), horizonMonths: 1.5 });
    if (b.kind !== "net") throw new Error("verkeerde toestand");
    expect(b.costCents).toBe(890);
  });
});

describe("maand tegenover jaar — een factor twaalf", () => {
  test("EEN JAARPRIJS WORDT NIET DOOR TWAALF GEDEELD voor een reis van een maand", () => {
    // American Express Business Gold: € 270,00 PER JAAR. Wie hem opent voor een
    // reis van een maand is € 270 kwijt, niet € 22,50 — die € 22,50 staat in geen
    // enkel document en je kunt geen twaalfde jaar kaart kopen.
    //
    // € 100 voordeel is precies het bedrag waarop de twee antwoorden verschillen:
    // gedeeld door twaalf zou de kaart € 22,50 kosten en € 77,50 opleveren, dus een
    // aanbeveling. Heel afgerekend kost hij € 270 en ga je € 170 achteruit.
    const b = netBenefit({ benefit: { kind: "one-off", cents: 10000 }, cost: cost(27000, "jaar"), horizonMonths: 1 });
    expect(b.kind).toBe("no-recommendation");
    if (b.kind !== "no-recommendation") throw new Error("verkeerde toestand");
    expect(b.costCents).toBe(27000);
    expect(b.netCents).toBe(-17000);
    if (b.basis.kind !== "one-off") throw new Error("verkeerde basis");
    expect(b.basis.costPeriod).toBe("jaar");
    expect(b.basis.flooredToMinimum).toBe(true);
    expect(describeNetBenefit(b)).toMatch(/per jaar afgerekend/);
  });

  test("dezelfde jaarprijs als maandprijs geschreven is twaalf keer zo goedkoop over één maand", () => {
    // € 270 per jaar en € 22,50 per maand hebben hetzelfde jaarbedrag en zijn over
    // één maand € 247,50 van elkaar verwijderd. Dát is de fout die deze scheiding
    // voorkomt.
    const perYear = netBenefit({ benefit: { kind: "one-off", cents: 10000 }, cost: cost(27000, "jaar"), horizonMonths: 1 });
    const perMonth = netBenefit({ benefit: { kind: "one-off", cents: 10000 }, cost: cost(2250, "maand"), horizonMonths: 1 });
    if (perYear.kind === "gross-cost-unknown" || perMonth.kind === "gross-cost-unknown") throw new Error("verkeerde toestand");
    expect(perYear.costCents - perMonth.costCents).toBe(24750);
    expect(perYear.kind).toBe("no-recommendation");
    expect(perMonth.kind).toBe("net");
  });

  test("terugkerend in twee eenheden gaat naar de GROFSTE, en dat is omhoog rekenen", () => {
    // € 5 cashback per maand tegen een kaart van € 48 per jaar: per jaar € 60
    // tegen € 48, dus € 12 over. Naar maanden gaan zou van € 48 per jaar een
    // maandbedrag maken dat nergens staat.
    const b = netBenefit({ benefit: { kind: "recurring", cents: 500, period: "maand" }, cost: cost(4800, "jaar") });
    if (b.kind !== "net") throw new Error("verkeerde toestand");
    expect(b.grossCents).toBe(6000);
    expect(b.costCents).toBe(4800);
    expect(b.netCents).toBe(1200);
    if (b.basis.kind !== "recurring") throw new Error("verkeerde basis");
    expect(b.basis.period).toBe("jaar");
    expect(b.basis.benefitDerived).toBe(true); // × 12, onze rekensom
    expect(b.basis.costDerived).toBe(false); // stond zo in het document
    expect(describeNetBenefit(b)).toContain("per jaar");
  });

  test("beide per maand blijft per maand — dan is er niets om te ver­talen", () => {
    const b = netBenefit({ benefit: { kind: "recurring", cents: 500, period: "maand" }, cost: cost(255) });
    if (b.kind !== "net") throw new Error("verkeerde toestand");
    if (b.basis.kind !== "recurring") throw new Error("verkeerde basis");
    expect(b.basis.period).toBe("maand");
    expect(b.basis.benefitDerived).toBe(false);
    expect(b.basis.costDerived).toBe(false);
    expect(b.netCents).toBe(245);
  });
});

describe("kosten onbekend: bruto, met het gat erbij", () => {
  test("HET WOORD NETTO VALT HIER NOOIT, en er is geen veld dat zo heet", () => {
    const b = netBenefit({ benefit: { kind: "one-off", cents: 1400 }, cost: unknown, horizonMonths: 1 });
    expect(b.kind).toBe("gross-cost-unknown");
    if (b.kind !== "gross-cost-unknown") throw new Error("verkeerde toestand");
    expect(b.grossCents).toBe(1400);
    // Het TYPE draagt het: er is geen netCents om per ongeluk te tonen.
    expect("netCents" in b).toBe(false);
    expect("costCents" in b).toBe(false);
    const tekst = describeNetBenefit(b);
    expect(tekst).not.toMatch(/netto/i);
    expect(tekst).toContain("€ 14,00");
    expect(tekst).toMatch(/geen nul/); // onbekend is geen nul, en dat staat er
  });

  test("de kaart wordt niet verzwegen: hij blijft een aanbeveling zolang er iets te winnen is", () => {
    const b = netBenefit({ benefit: { kind: "one-off", cents: 1400 }, cost: unknown });
    expect(isRecommendation(b)).toBe(true);
  });

  test("maar zonder winst is er ook bruto niets te bevelen", () => {
    const b = netBenefit({ benefit: { kind: "one-off", cents: 0 }, cost: unknown });
    expect(isRecommendation(b)).toBe(false);
  });

  test("de reden staat erbij, want 'geen bron' en 'hangt aan een ander product' vragen iets anders", () => {
    const b = netBenefit({
      benefit: { kind: "one-off", cents: 1400 },
      cost: { kind: "unknown", reason: "needs-another-product" },
    });
    const tekst = describeNetBenefit(b);
    expect(tekst).toMatch(/bovenop een ander product/);
    expect(tekst).not.toMatch(/netto/i);
  });
});

describe("een kaart die hij AL HEEFT kost hem marginaal niets", () => {
  test("de maandprijs loopt toch door, dus voor deze keuze is hij nul", () => {
    // ABN AMRO Gold Card, € 4,45 per maand. Heeft hij hem al, dan verandert die
    // € 4,45 niet door de kaart wél of niet mee te nemen op reis.
    const marginal = marginalHoldingCost(cost(445), true);
    expect(marginal.kind).toBe("known");
    if (marginal.kind !== "known") throw new Error("verkeerde toestand");
    expect(marginal.amount.cents).toBe(0);
    expect(marginal.why).toBe("already-held");

    const b = netBenefit({ benefit: { kind: "one-off", cents: 1400 }, cost: marginal, horizonMonths: 6 });
    if (b.kind !== "net") throw new Error("verkeerde toestand");
    expect(b.costCents).toBe(0);
    expect(b.netCents).toBe(1400); // het volle voordeel, ook over zes maanden
  });

  test("een kaart die hij MOET OPENEN houdt zijn prijs — anders is de opdracht weg", () => {
    const marginal = marginalHoldingCost(cost(445), false);
    if (marginal.kind !== "known") throw new Error("verkeerde toestand");
    expect(marginal.amount.cents).toBe(445);
    expect(marginal.why).toBe("stated");
  });

  test("ook een kaart met een ONBEKENDE prijs is een bekende nul zodra hij hem heeft", () => {
    // Dit is wat de gelijkspelregel overeind houdt: zijn eigen kaart kan nooit
    // zakken op "wat we kunnen aantonen", want deze nul is aantoonbaar.
    const marginal = marginalHoldingCost(unknown, true);
    expect(marginal.kind).toBe("known");
  });
});

describe("holdingCostOfProduct: van catalogusrij naar kostenpost", () => {
  test("een geprijsde rij wordt een bekende prijs, met bron en datum", () => {
    const c = holdingCostOfProduct(feeOf(entry({ id: "abn-amro-gold-card", product: "ABN AMRO Gold Card" })));
    if (c.kind !== "known") throw new Error("verkeerde toestand");
    expect(c.amount.cents).toBe(445);
    expect(c.amount.period).toBe("maand");
    expect(c.asOf).toBe("2026-01");
  });

  test("een UITGESPROKEN nul is een bekende nul, geen ontbrekend cijfer", () => {
    // 212 Card en Trade Republic staan letterlijk op € 0 per maand in hun eigen
    // prijslijst. Die nul telt gewoon mee.
    const c = holdingCostOfProduct(feeOf(entry({ id: "212-card", product: "212 Card", kind: "betaalpas", fee: { value: 0 } })));
    if (c.kind !== "known") throw new Error("verkeerde toestand");
    expect(c.amount.cents).toBe(0);
    expect(c.why).toBe("stated");
  });

  test("geen rij in de catalogus is ONBEKEND, niet gratis", () => {
    expect(holdingCostOfProduct(null)).toEqual({ kind: "unknown", reason: "no-source" });
  });

  test("een prijs die BOVENOP een ander product komt is geen prijs van dit product", () => {
    // Rabobank creditcard: € 2,00 per maand "bovenop de € 3,45 per maand van Rabo
    // Standaard". Die € 2,00 doorgeven zou een te LAGE prijs zijn, en een te lage
    // prijs rekent door in elk nettobedrag erna — erger dan geen prijs.
    const c = holdingCostOfProduct(
      feeOf(
        entry({
          id: "rabobank-creditcard",
          product: "Rabobank creditcard",
          fee: { value: 2.0, conditions: "Bovenop de € 3,45 per maand van Rabo Standaard." },
        }),
      ),
    );
    expect(c).toEqual({ kind: "unknown", reason: "needs-another-product" });
  });
});

describe("de rangschikking", () => {
  const net = (netCents: number): NetBenefit =>
    netBenefit({ benefit: { kind: "one-off", cents: netCents + 445 }, cost: cost(445), horizonMonths: 1 });
  const gross = (cents: number): NetBenefit => netBenefit({ benefit: { kind: "one-off", cents }, cost: unknown });

  test("BIJ GELIJKE WAARDE STAAT NETTO-BEKEND BOVEN BRUTO-ONBEKEND", () => {
    // Van de eerste weten we dat het klopt; van de tweede weten we alleen dat er
    // nog iets af kan gaan. Het brutobedrag is een bovengrens, dus een gelijke
    // stand is geen echte gelijke stand.
    const sorted = [gross(1000), net(1000)].sort(compareNetBenefit);
    expect(sorted[0].kind).toBe("net");
  });

  test("maar een echt hoger bedrag wint nog steeds, ook als het bruto is", () => {
    const sorted = [net(1000), gross(1500)].sort(compareNetBenefit);
    expect(sorted[0].kind).toBe("gross-cost-unknown");
  });

  test("iets waarop je achteruitgaat staat altijd onderaan, hoe hoog het brutobedrag ook is", () => {
    const loss = netBenefit({ benefit: { kind: "one-off", cents: 1400 }, cost: cost(9999), horizonMonths: 1 });
    const sorted = [loss, gross(10), net(5)].sort(compareNetBenefit);
    expect(sorted[sorted.length - 1]).toBe(loss);
  });

  test("rankByNetBenefit is stabiel, zodat een lijst niet herschikt tussen renders", () => {
    const rows = [
      { id: "a", b: gross(1000) },
      { id: "b", b: gross(1000) },
      { id: "c", b: net(2000) },
    ];
    expect(rankByNetBenefit(rows, (r) => r.b).map((r) => r.id)).toEqual(["c", "a", "b"]);
  });
});

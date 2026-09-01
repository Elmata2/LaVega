/* Wat er op het scherm komt. De meeste tests hier gaan over het geval waarin er
 * NIETS te melden valt, want dat is waar een paneel de neiging heeft iets te
 * verzinnen. */

import { describe, it, expect } from "vitest";
import { buildPanel, panelRows, PANEEL_CAPS, ONGEKAPT, amountNote, footer, puntenBlok } from "./panel.js";
import { rankCheckout, type Ranking } from "./rank.js";
import { pointsCoverage } from "./points.js";
import { POINTS_RATES } from "./generated/points-rates.generated.js";
import type { CheckoutCard, CardFee } from "./types.js";
import type { Reading } from "./read.js";

function sourced(value: number) {
  return { value, sourceUrl: "https://voorbeeld.nl/x", checkedAt: "2026-06-15", conditions: null };
}
function fee(value: number, period: "maand" | "jaar"): CardFee {
  return { value, period, sourceUrl: "https://voorbeeld.nl/t", checkedAt: "2026-01-15", conditions: null };
}
function card(p: Partial<CheckoutCard> & { id: string; product: string }): CheckoutCard {
  return { issuer: "Bank Voorbeeld", kind: "creditcard", fxFeePct: null, cashbackPct: null, pointsPerEuro: null, fee: null, ...p };
}
/* Twee kaarten met een controledatum ver uit elkaar, zodat de voetregel iets te
 * spreiden heeft. */
const BUNDEL: CheckoutCard[] = [
  card({ id: "oud", product: "Oude Kaart", fxFeePct: { value: 2, sourceUrl: "https://voorbeeld.nl/a", checkedAt: "2022-10-01", conditions: null } }),
  card({ id: "nieuw", product: "Nieuwe Kaart", fxFeePct: { value: 1, sourceUrl: "https://voorbeeld.nl/b", checkedAt: "2026-08-20", conditions: null } }),
];
const GEEN_PUNTEN: ReturnType<typeof pointsCoverage> = [];
function rank(cards: CheckoutCard[], heldIds: string[], amountCents: number | null, currency = "EUR"): Ranking {
  return rankCheckout({ cards, heldIds, currency, amountCents, asOf: "2026-08-21" });
}
/* Het geslaagde geval apart getypeerd. `Reading` is een unie, en amountNote
 * neemt alleen de ok-tak aan — met `: Reading` als teruggeeftype geeft tsc
 * terecht een fout, terwijl vitest (esbuild, geen typecheck) vrolijk doorloopt.
 * Precies het soort verschil dat je pas ziet als je allebei draait. */
type Gelukt = Extract<Reading, { ok: true }>;
const gelezen = (amountCents: number, currency = "EUR", basis: "artikel" | "bestelling" = "artikel"): Gelukt => ({
  ok: true, amountCents, currency, basis, via: "JSON-LD Offer",
});

describe("als het bedrag niet te lezen is, wordt er niet gegokt", () => {
  it("noemt de echte oorzaak én de plek waar het handmatige veld staat", () => {
    /* Rule 3, letterlijk: een melding mag geen advies geven dat in de toestand
     * waarin het verschijnt niet kan werken. reasonText eindigt met "vul het
     * bedrag zelf in" — maar in het paneel ZIT geen veld, dus zonder de
     * verwijzing naar het werkbalkvenster is dat een doodlopend advies. */
    const a = buildPanel({
      reading: { ok: false, reason: "geen-prijsmarkup", detail: "…" },
      ranking: null,
      cards: BUNDEL,
      punten: GEEN_PUNTEN,
    });
    expect(a.soort).toBe("geen-bedrag");
    if (a.soort !== "geen-bedrag") return;
    expect(a.uitleg).toContain("machineleesbaar");
    expect(a.uitleg).toContain("werkbalk");
  });

  it("weigert een bedrag in een andere munt in plaats van het als euro's te tonen", () => {
    /* Zonder deze tak zou "USD 300" op het scherm komen als "€ 300,00": het
     * getal klopt, alleen het teken ervoor is gelogen, en dat merkt niemand. */
    const a = buildPanel({
      reading: gelezen(30000, "USD"),
      ranking: rank([], [], 30000, "USD"),
      cards: BUNDEL,
      punten: GEEN_PUNTEN,
    });
    expect(a.soort).toBe("geen-bedrag");
    if (a.soort !== "geen-bedrag") return;
    expect(a.kop).toContain("USD");
    expect(a.uitleg).toContain("wisselkoers");
    /* En er staat nergens een euroteken met dat bedrag erachter. */
    expect(a.kop + a.uitleg).not.toContain("€ 300,00");
  });
});

describe("wat een gelezen bedrag is, staat erbij", () => {
  it("een artikelprijs wordt niet als ordertotaal gepresenteerd", () => {
    expect(amountNote(gelezen(4999, "EUR", "artikel"))).toContain("prijs van één artikel");
    expect(amountNote(gelezen(4999, "EUR", "artikel"))).toContain("Aantal, bezorgkosten en korting zitten er niet in");
    expect(amountNote(gelezen(31245, "EUR", "bestelling"))).toContain("totaal van je bestelling");
  });

  it("de voet noemt de SPREIDING van de controledatums en niet één datum", () => {
    /* Hier stond de bouwdatum van de catalogus, en die was aantoonbaar onjuist:
     * zesenveertig cijfers in dezelfde bundel droegen een NIEUWERE datum dan de
     * datum die het scherm noemde, en het oudste cijfer was bijna vier jaar
     * ouder. Eén datum boven zo'n verzameling is altijd fout. */
    const v = footer(BUNDEL);
    expect(v).toContain("1 oktober 2022");
    expect(v).toContain("20 augustus 2026");
    expect(v).toContain("stuurt niets naar buiten");
  });

  it("zegt het als er geen enkele controledatum in de bundel staat", () => {
    const v = footer([card({ id: "x", product: "Kaal" })]);
    expect(v).toContain("geen controledatum");
  });
});

describe("de volgorde en de afkapping van de rijen", () => {
  const mijn1 = card({ id: "m1", product: "Mijn Beste", cashbackPct: sourced(2), fxFeePct: sourced(0) });
  const mijn2 = card({ id: "m2", product: "Mijn Tweede", cashbackPct: sourced(1), fxFeePct: sourced(0) });
  const beter = card({ id: "o1", product: "Beter Met Prijs", cashbackPct: sourced(5), fxFeePct: sourced(0), fee: fee(1, "maand") });
  const achteruit = card({ id: "o2", product: "Beter Maar Duur", cashbackPct: sourced(4), fxFeePct: sourced(0), fee: fee(50, "maand") });
  const geenPrijs = card({ id: "o3", product: "Beter Zonder Prijskaartje", cashbackPct: sourced(3), fxFeePct: sourced(0) });
  const onbekend = card({ id: "m3", product: "Mijn Onbekende", fxFeePct: sourced(1) });

  const r = rank([mijn1, mijn2, beter, achteruit, geenPrijs, onbekend], ["m1", "m2", "m3"], 30000);

  it("zet eerst wat hij heeft, dan wat hij kan openen, en onbekend onderaan", () => {
    const groepen = panelRows(r, ONGEKAPT).map((x) => x.groep);
    const eerste = (g: PaneelGroep) => groepen.indexOf(g);
    expect(eerste("mijn")).toBeLessThan(eerste("openen"));
    expect(eerste("openen")).toBeLessThan(eerste("achteruit"));
    expect(eerste("onbekend")).toBe(groepen.length - 1);
  });

  it("laat de achteruit-rij STAAN, want die bestaat om zichtbaar te zijn", () => {
    /* Een kaart die op papier meer teruggeeft en na kosten minder oplevert,
     * weglaten omdat het geen aanbeveling is, verbergt juist de vergelijking. */
    const achter = panelRows(r, ONGEKAPT).find((x) => x.groep === "achteruit");
    expect(achter?.titel).toBe("Beter Maar Duur");
    expect(achter?.regel).toContain("geen aanbeveling");
  });

  it("kapt in het paneel af, maar nooit de onbekenden", () => {
    const kort = panelRows(r, PANEEL_CAPS);
    expect(kort.filter((x) => x.groep === "openen")).toHaveLength(1);
    /* Zijn eigen kaart waarvan we het antwoord niet weten, is precies het soort
     * ding dat een korte lijst stil weglaat. Hier niet. */
    expect(kort.filter((x) => x.groep === "onbekend")).toHaveLength(1);
    expect(kort.find((x) => x.groep === "onbekend")?.regel).toContain("Onbekend is niet nul");
  });

  it("bij onbekende kaartkosten valt het woord netto ook in het paneel niet", () => {
    const rij = panelRows(r, ONGEKAPT).find((x) => x.groep === "onbekende-kosten");
    expect(rij?.titel).toBe("Beter Zonder Prijskaartje");
    expect(rij?.regel.toLowerCase()).not.toContain("netto");
    expect(rij?.regel).toContain("brutobedrag");
  });
});

describe("het volledige paneel", () => {
  it("draagt het bedrag, de kop en de voet", () => {
    const mijn = card({ id: "m", product: "Mijn Kaart", cashbackPct: sourced(1), fxFeePct: sourced(0) });
    const a = buildPanel({
      reading: gelezen(4999),
      ranking: rank([mijn], ["m"], 4999),
      cards: BUNDEL,
      punten: GEEN_PUNTEN,
    });
    expect(a.soort).toBe("toon");
    if (a.soort !== "toon") return;
    expect(a.bedrag).toBe("€ 49,99");
    expect(a.kop).toContain("Mijn Kaart");
    expect(a.regels).toHaveLength(1);
    expect(a.voet).toContain("bewaart er niets van");
  });
});


describe("het puntenblok", () => {
  const rijen = (saldi: { program: string; points: number; updatedAt: string }[], amountCents: number | null) =>
    pointsCoverage({ balances: saldi, rates: POINTS_RATES, amountCents, asOf: "2026-08-22" });

  it("verschijnt OOK als het bedrag niet te lezen is — dat is de hele winst", () => {
    /* Op een IKEA-actiepagina is het bedrag een bereik en zei het paneel
     * helemaal niets. Wat hij aan punten heeft liggen hangt niet van dat bedrag
     * af, dus daar staat nu wél iets waars. */
    const a = buildPanel({
      reading: { ok: false, reason: "prijsbereik", detail: "…" },
      ranking: null,
      cards: BUNDEL,
      punten: rijen([{ program: "Amex", points: 42000, updatedAt: "2026-08-12" }], null),
    });
    expect(a.soort).toBe("geen-bedrag");
    if (a.soort !== "geen-bedrag") return;
    expect(a.punten.regels).toHaveLength(1);
    expect(a.punten.regels[0]!.regel).toContain("42.000 punten");
    expect(a.punten.regels[0]!.regel).toContain("€ 126,00");
    /* Maar geen percentage: daar is een aankoopbedrag voor nodig. */
    expect(a.punten.regels[0]!.regel).not.toContain("%");
  });

  it("zet er bij een gelezen bedrag wél een percentage bij, met de route erbij", () => {
    const a = buildPanel({
      reading: gelezen(36000),
      ranking: rank([], [], 36000),
      cards: BUNDEL,
      punten: rijen([{ program: "American Express", points: 42000, updatedAt: "2026-08-12" }], 36000),
    });
    expect(a.soort).toBe("toon");
    if (a.soort !== "toon") return;
    const r = a.punten.regels[0]!;
    expect(r.regel).toContain("€ 126,00");
    expect(r.regel).toContain("35%");
    /* De route mag nooit weg: zonder deze zin leest het percentage als een knop
     * in de kassa van de winkel, en die knop bestaat niet. */
    expect(r.regel).toContain("niet in de kassa van deze winkel");
    expect(r.bron).toContain("12 augustus 2026");
  });

  it("zegt bij een leeg blok waar de saldi vandaan moeten komen, en anders niets", () => {
    const leegBlok = puntenBlok([], 4999, "EUR");
    expect(leegBlok.regels).toHaveLength(0);
    expect(leegBlok.leeg).toContain("nog geen puntensaldo");
    expect(leegBlok.voetnoot).toBe("");

    const vol = puntenBlok(rijen([{ program: "Amex", points: 1000, updatedAt: "2026-08-12" }], 4999), 4999, "EUR");
    expect(vol.leeg).toBe("");
    expect(vol.voetnoot).toContain("herinnering");
  });

  it("waarschuwt bij vreemde valuta dat inwisselen hier juist geld kost", () => {
    const rij = rijen([{ program: "Amex", points: 1000, updatedAt: "2026-08-12" }], 4999);
    expect(puntenBlok(rij, 4999, "USD").voetnoot).toContain("koersopslag");
    expect(puntenBlok(rij, 4999, "EUR").voetnoot).not.toContain("koersopslag");
  });
});

describe("twee soorten onbekend krijgen twee groepskoppen", () => {
  it("een opbrengst in een token staat niet onder \"kaartkosten onbekend\"", () => {
    /* Bij Crypto.com Obsidian staan de kaartkosten letterlijk in de voorwaarde
     * ("€450,000 12-month CRO staking"). "Kaartkosten onbekend" boven die rij is
     * onwaar, en een groepskop is de sterkste uitspraak in het blok. */
    const inToken = card({
      id: "t",
      product: "Tokenkaart",
      fxFeePct: sourced(0),
      cashbackPct: {
        value: 5,
        sourceUrl: "https://voorbeeld.nl/c",
        checkedAt: "2026-06-15",
        conditions: "Rewards are PAID IN CRO, not euro.",
      },
    });
    const geenPrijs = card({ id: "g", product: "Geen Prijskaartje", fxFeePct: sourced(0), cashbackPct: sourced(3) });
    const r = rank([inToken, geenPrijs], [], 30000);
    const groepen = panelRows(r, ONGEKAPT);
    expect(groepen.find((x) => x.titel === "Tokenkaart")?.groep).toBe("geen-euro-uitkomst");
    expect(groepen.find((x) => x.titel === "Geen Prijskaartje")?.groep).toBe("onbekende-kosten");
  });
});

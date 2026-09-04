/* De puntenkant. Dit bestand test één ding in tien vormen: dat er nooit een
 * getal op het scherm komt dat we niet hebben.
 *
 * WAAROM DAT HIER ZWAARDER WEEGT DAN BIJ DE KAARTEN. Bij de kaarten is de
 * ontbrekende data zichtbaar — de netto-tak wordt nooit bereikt, dus er valt
 * niets te verzinnen. Hier is de helft van de data er WEL (zijn saldo) en de
 * andere helft niet (wat een winkel accepteert), en dat is precies de vorm
 * waarin een percentage uit de lucht komt vallen: 42.000 punten en een
 * aankoopbedrag van € 360 leveren met een verzonnen koers een heel
 * geloofwaardige 35% op. */

import { describe, it, expect } from "vitest";
import { pointsCoverage, zoekKoers, normaliseerProgramma, VEROUDERD_NA_DAGEN } from "./points.js";
import { POINTS_RATES } from "./generated/points-rates.generated.js";
import { puntenRegel, puntenBron, puntenVoetnoot } from "./lines.js";

const ASOF = "2026-08-22";

function reken(
  saldi: { program: string; points: number; updatedAt?: string }[],
  amountCents: number | null,
) {
  return pointsCoverage({
    balances: saldi.map((s) => ({
      program: s.program,
      points: s.points,
      updatedAt: s.updatedAt ?? "2026-08-12",
    })),
    rates: POINTS_RATES,
    amountCents,
    asOf: ASOF,
  });
}

describe("de gebundelde koerslijst", () => {
  it("draagt bij elke regel een bron en de datum waarop WIJ hem lazen", () => {
    /* Een koers zonder bron en zonder datum is aan een kassa niets waard: de
     * datum is het enige waarop hij de betrouwbaarheid kan afmeten. Deze test is
     * de reden dat de bundler geen regel zonder die twee kan opleveren. */
    expect(POINTS_RATES.length).toBeGreaterThan(0);
    for (const r of POINTS_RATES) {
      expect(r.sourceUrl, r.program).toMatch(/^https:\/\//);
      expect(r.gelezenOp, r.program).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.aliases.length, r.program).toBeGreaterThan(0);
      /* Alleen een gepubliceerde koers mag een getal dragen. Bij de andere drie
       * soorten is eurPerPoint null of een uitgesproken nul, en nooit een getal
       * dat als koers gelezen kan worden. */
      if (r.soort === "koers") expect(r.eurPerPoint, r.program).toBeGreaterThan(0);
      else expect(r.eurPerPoint === null || r.eurPerPoint === 0, r.program).toBe(true);
    }
  });

  it("legt vast HOEVEEL programma's een koers hebben — dat getal is de dekking", () => {
    /* Zoals rank.test.ts de 77/8/27/0 van de kaarten vastlegt: het valt om zodra
     * de data verandert, en dan hoort er iemand naar te kijken in plaats van dat
     * een scherm stilletjes meer of minder gaat beweren. Vandaag: vier
     * programma's, één met een koers. */
    const perSoort = (s: string) => POINTS_RATES.filter((r) => r.soort === s).length;
    expect(POINTS_RATES.length).toBe(4);
    expect(perSoort("koers")).toBe(1);
    expect(perSoort("uitgesproken-nul")).toBe(1);
    expect(perSoort("geen-vaste-waarde")).toBe(1);
    expect(perSoort("niet-gepubliceerd")).toBe(1);
  });
});

describe("een programma zonder gepubliceerde koers krijgt GEEN getal", () => {
  it("geeft null en niet 0, met een reden erbij", () => {
    /* Dit is de test die het hele product eerlijk houdt. Nul zou hier lezen als
     * "je punten dekken hier niets", en dat is een conclusie die een ontbrekend
     * cijfer niet kan dragen. */
    const [rij] = reken([{ program: "Flying Blue", points: 30000 }], 36000);
    expect(rij!.coverageCents).toBeNull();
    expect(rij!.pct).toBeNull();
    expect(rij!.saldoWaardeCents).toBeNull();
    expect(rij!.waarom).toBe("koers-niet-gelezen");
  });

  it("en de zin erbij noemt geen euro's en geen percentage", () => {
    const [rij] = reken([{ program: "Flying Blue", points: 30000 }], 36000);
    const zin = puntenRegel(rij!, 36000);
    expect(zin).toContain("30.000 punten");
    expect(zin).not.toContain("€");
    expect(zin).not.toContain("%");
  });
});

describe("er zijn VIER soorten onbekend, en de uitkomst laat ze uit elkaar", () => {
  it("ING is een uitgesproken nul, Revolut een niet-vaste waarde, Flying Blue ons eigen gat", () => {
    /* Ze samenvoegen tot één "onbekend" zou van drie verschillende feiten één
     * vage mededeling maken. ING zegt zelf dat punten geen geldwaarde hebben —
     * dat mág op het scherm. Revolut zegt dat de waarde niet vast is; dat is iets
     * anders dan nul. Bij Flying Blue hebben WIJ het niet kunnen lezen, en dat is
     * geen uitspraak van Flying Blue. */
    const rijen = reken(
      [
        { program: "ING Punten", points: 8400 },
        { program: "RevPoints", points: 3200 },
        { program: "Flying Blue", points: 30000 },
        { program: "Marriott Bonvoy", points: 12000 },
      ],
      36000,
    );
    const waarom = new Map(rijen.map((r) => [r.program, r.waarom]));
    expect(waarom.get("ING Punten")).toBe("uitgesproken-geen-geldwaarde");
    expect(waarom.get("RevPoints")).toBe("geen-vaste-waarde");
    expect(waarom.get("Flying Blue")).toBe("koers-niet-gelezen");
    expect(waarom.get("Marriott Bonvoy")).toBe("programma-onbekend");
    expect(new Set(waarom.values()).size).toBe(4);
  });

  it("en vier verschillende zinnen, elk met de eigen oorzaak erin", () => {
    const rijen = reken(
      [
        { program: "ING Punten", points: 8400 },
        { program: "RevPoints", points: 3200 },
        { program: "Flying Blue", points: 30000 },
        { program: "Marriott Bonvoy", points: 12000 },
      ],
      36000,
    );
    const zin = (naam: string) =>
      puntenRegel(
        rijen.find((r) => r.program === naam)!,
        36000,
      );

    /* ING mag de nul noemen omdat ING hem zelf uitspreekt — maar alleen binnen
     * zijn reikwijdte, en die staat erbij. */
    expect(zin("ING Punten")).toContain("geen geldwaarde");
    expect(zin("ING Punten")).toContain("ING Winkel");
    expect(zin("ING Punten")).toContain("geen percentage");

    expect(zin("RevPoints")).toContain("geen vaste geldwaarde");
    expect(zin("RevPoints")).toContain("iets anders dan nul");

    expect(zin("Flying Blue")).toContain("WIJ niet kunnen lezen");

    expect(zin("Marriott Bonvoy")).toContain("niet in onze koerslijst");
    expect(zin("Marriott Bonvoy")).toContain("Onbekend is niet nul");
  });
});

describe("waar er WEL een koers is", () => {
  it("rekent bedrag en percentage uit, en zegt langs welke weg dat gaat", () => {
    const [rij] = reken([{ program: "Amex", points: 42000 }], 36000);
    expect(rij!.waarom).toBe("koers-bekend");
    /* 42.000 × € 0,003 = € 126. Op € 360 is dat 35%. */
    expect(rij!.coverageCents).toBe(12600);
    expect(rij!.pct).toBe(35);
    expect(rij!.afgetopt).toBe(false);
    const zin = puntenRegel(rij!, 36000);
    expect(zin).toContain("35%");
    /* De route mag nooit weg — zonder deze zin leest het percentage als een knop
     * in de kassa van de winkel, en die knop bestaat niet. */
    expect(zin).toContain("Inwisselen gaat via");
    expect(zin).toContain("niet in de kassa van deze winkel");
    /* En we beweren nergens dat deze winkel de punten accepteert. */
    expect(zin).toContain("kunnen we hier niet zien");
  });

  it("topt af op het aankoopbedrag: 200.000 punten op € 30 is 100%, niet 2000%", () => {
    const [rij] = reken([{ program: "Amex", points: 200000 }], 3000);
    expect(rij!.coverageCents).toBe(3000);
    expect(rij!.pct).toBe(100);
    expect(rij!.afgetopt).toBe(true);
    expect(puntenRegel(rij!, 3000)).toContain("dekt hem helemaal");
    expect(puntenRegel(rij!, 3000)).not.toContain("2000%");
  });

  it("zonder aankoopbedrag blijft de WAARDE staan en verdwijnt het PERCENTAGE", () => {
    /* Dit is de toestand op een IKEA-actiepagina: het bedrag is een bereik en
     * dus niet te lezen. Wat hij aan punten heeft liggen hangt daar niet van af,
     * en dat is de hele reden dat dit blok ook daar verschijnt. */
    const [rij] = reken([{ program: "Amex", points: 42000 }], null);
    expect(rij!.waarom).toBe("geen-bedrag");
    expect(rij!.saldoWaardeCents).toBe(12600);
    expect(rij!.coverageCents).toBeNull();
    expect(rij!.pct).toBeNull();
    const zin = puntenRegel(rij!, null);
    expect(zin).toContain("€ 126,00");
    expect(zin).not.toContain("%");
  });
});

describe("de datum van het saldo", () => {
  it("een saldo ouder dan negentig dagen komt terug als verouderd, met de datum erbij", () => {
    const [rij] = reken([{ program: "Amex", points: 42000, updatedAt: "2026-04-01" }], 36000);
    expect(rij!.dagenOud).toBeGreaterThan(VEROUDERD_NA_DAGEN);
    expect(rij!.verouderd).toBe(true);
    /* Het percentage blijft staan: het saldo is oud, niet onbekend. Wat erbij
     * komt is de mededeling dat hij het beter even nakijkt. */
    expect(rij!.pct).toBe(35);
    const bron = puntenBron(rij!);
    expect(bron).toContain("1 april 2026");
    expect(bron).toContain("negentig dagen");
  });

  it("een saldo ZONDER datum is niet vers, en dat staat er ook", () => {
    /* Er stilletjes vandaag van maken zou een saldo van vier maanden oud vers
     * verklaren. Onbekende ouderdom is niet nul dagen oud. */
    const [rij] = reken([{ program: "Amex", points: 42000, updatedAt: "" }], 36000);
    expect(Number.isNaN(rij!.dagenOud)).toBe(true);
    expect(rij!.verouderd).toBe(true);
    expect(puntenBron(rij!)).toContain("geen datum");
  });

  it("de bron noemt de koers, de leesdatum EN de invoerdatum — twee verschillende dingen", () => {
    const [rij] = reken([{ program: "Amex", points: 42000, updatedAt: "2026-08-12" }], 36000);
    const bron = puntenBron(rij!);
    expect(bron).toContain("1.000 Membership Rewards punten");
    expect(bron).toContain("americanexpress.com");
    expect(bron).toContain("21 augustus 2026");
    expect(bron).toContain("12 augustus 2026");
  });
});

describe("wat er GEEN rij oplevert", () => {
  it("een leeg saldo geeft geen rij en dus geen kop", () => {
    /* Dezelfde fout als "je saldi staan al op de beste plek", overgezet naar dit
     * oppervlak: een kop boven niets is een bewering over niets. */
    expect(reken([], 36000)).toHaveLength(0);
  });

  it("nul punten geeft geen rij: er ligt niets om aan te herinneren", () => {
    /* Nul is hier een UITGESPROKEN nul — hij heeft het zelf ingevoerd — en dus
     * een feit. Maar een herinnering aan nul punten is geen herinnering. */
    expect(reken([{ program: "Amex", points: 0 }], 36000)).toHaveLength(0);
  });

  it("een lege programmanaam geeft geen rij", () => {
    expect(reken([{ program: "   ", points: 42000 }], 36000)).toHaveLength(0);
  });
});

describe("de volgorde", () => {
  it("zet de rij die iets dekt bovenaan en de uitgesproken nul onderaan", () => {
    const rijen = reken(
      [
        { program: "ING Punten", points: 8400 },
        { program: "Marriott Bonvoy", points: 12000 },
        { program: "Amex", points: 42000 },
      ],
      36000,
    );
    expect(rijen.map((r) => r.program)).toEqual(["Amex", "Marriott Bonvoy", "ING Punten"]);
  });
});

describe("het zoeken van de koers", () => {
  it("matcht op een hele alias en nooit op een deel ervan", () => {
    /* "Air Miles" bevat "miles". Zou dit op "bevat" werken, dan stond er een
     * KLM-uitspraak onder een Air Miles-saldo. Geen match is hier het goede
     * antwoord: dan zegt de extensie dat ze het programma niet kent. */
    expect(zoekKoers("Amex", POINTS_RATES)?.program).toBe("Membership Rewards");
    expect(zoekKoers("american express", POINTS_RATES)?.program).toBe("Membership Rewards");
    expect(zoekKoers("AMEX ", POINTS_RATES)?.program).toBe("Membership Rewards");
    expect(zoekKoers("Air Miles", POINTS_RATES)).toBeNull();
    expect(zoekKoers("Miles", POINTS_RATES)).toBeNull();
    expect(zoekKoers("", POINTS_RATES)).toBeNull();
  });

  it("normaliseert leestekens en diakrieten weg", () => {
    expect(normaliseerProgramma("Flying Blue (KLM/Air France)")).toBe("flying blue klm air france");
    expect(normaliseerProgramma("  ING  Punten ")).toBe("ing punten");
    expect(normaliseerProgramma("Aéroplan")).toBe("aeroplan");
  });
});

describe("de voetnoot onder het blok", () => {
  it("spreekt de verkoopkant van dit idee tegen, en dat is de bedoeling", () => {
    /* Punten inwisselen levert overal dezelfde koers op, dus er is aan deze
     * kassa geen voordeel te halen dat er morgen niet ook is. Dat weglaten omdat
     * het de kop zwakker maakt, zou een winst beloven die er niet is. */
    const v = puntenVoetnoot("EUR");
    expect(v).toContain("gaan niet verloren");
    expect(v).toContain("geen voordeel dat je hier moet pakken");
  });

  it("waarschuwt bij vreemde valuta dat inwisselen hier juist GELD KOST", () => {
    /* Huisregel 3 andersom: "gebruik je punten hier" is bij een aankoop in
     * dollars advies dat in de toestand waarin het verschijnt geld kost. */
    const v = puntenVoetnoot("USD");
    expect(v).toContain("USD");
    expect(v).toContain("koersopslag");
    expect(v).toContain("volgende week");
  });
});

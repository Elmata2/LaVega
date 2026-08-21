import { expect, test } from "vitest";
import {
  categorySpendPercentiles,
  MIN_HISTORY_PERIODS,
  type CategoryPercentile,
  type SpendRow,
} from "./spendPercentile.js";

const row = (date: string, category: string, euros: number): SpendRow => ({
  date,
  category,
  cents: Math.round(euros * 100),
});

/** Ten whole months of one category, Oct 2025 … Jul 2026, € 100 climbing to
 *  € 190 — the distribution every test below is judged against. */
const CLIMB = [100, 110, 120, 130, 140, 150, 160, 170, 180, 190];
const MONTHS = [
  "2025-10", "2025-11", "2025-12", "2026-01", "2026-02",
  "2026-03", "2026-04", "2026-05", "2026-06", "2026-07",
];
const boodschappen = MONTHS.map((m, i) => row(`${m}-05`, "Boodschappen", CLIMB[i]));

const find = (rows: CategoryPercentile[], category: string): CategoryPercentile =>
  rows.find((r) => r.category === category)!;

test("plaatst deze maand in de tien maanden ervoor", () => {
  const out = categorySpendPercentiles([...boodschappen, row("2026-08-31", "Boodschappen", 175)], {
    asOf: "2026-08-31",
    coverage: { start: "2025-10-01", end: "2026-08-31" },
  });

  expect(out.complete).toBe(true);
  expect(out.comparedDays).toBe(null); // whole periods, so nothing to warn about
  expect(out.compared).toHaveLength(10);
  expect(out.compared[0]).toEqual({ start: "2025-10-01", end: "2025-10-31" }); // oldest first

  const r = find(out.rows, "Boodschappen");
  expect(r.currentCents).toBe(17_500);
  expect(r.higher).toBe(8); // € 100 … € 170
  expect(r.lower).toBe(2); //  € 180 and € 190
  expect(r.same).toBe(0);
  expect(r.percentile).toBe(0.8);
  expect(r.reason).toBe(null);
  expect(r.historyCents).toEqual(CLIMB.map((e) => e * 100));
});

test("weigert onder het minimum aantal periodes, met de reden", () => {
  const four = boodschappen.slice(-4); // apr–jul 2026 only
  const out = categorySpendPercentiles([...four, row("2026-08-31", "Boodschappen", 175)], {
    asOf: "2026-08-31",
    coverage: { start: "2026-04-01", end: "2026-08-31" },
  });

  expect(out.compared).toHaveLength(4);
  expect(out.minHistory).toBe(MIN_HISTORY_PERIODS);

  const r = find(out.rows, "Boodschappen");
  expect(r.percentile).toBe(null);
  expect(r.reason).toBe("te-weinig-geschiedenis");
  expect(r.currentCents).toBe(17_500); // the amount is known; only its position is not
});

/* De val van deze functie. Halverwege augustus is de maand-tot-nu bijna altijd
 * laag, dus een rauwe vergelijking meet de kalender en niet zijn gedrag.
 *
 * Hier staat € 300 van elke maand op de 25e en € 50 op de 5e. Tegen de volle
 * maanden (€ 350) is de € 60 van deze augustus de laagste die hij ooit had;
 * tegen dezelfde eerste vijftien dagen (€ 50) is het de hoogste. Het tweede is
 * het antwoord, en `comparedDays` zegt hardop dat er over vijftien dagen wordt
 * vergeleken. */
test("vergelijkt een lopende maand met dezelfde eerste dagen van elke eerdere maand", () => {
  const history = MONTHS.flatMap((m) => [row(`${m}-05`, "Uit eten", 50), row(`${m}-25`, "Uit eten", 300)]);
  const out = categorySpendPercentiles([...history, row("2026-08-05", "Uit eten", 60)], {
    asOf: "2026-08-15",
    coverage: { start: "2025-10-01", end: "2026-08-15" },
  });

  expect(out.complete).toBe(false);
  expect(out.comparedDays).toBe(15);
  expect(out.compared[0]).toEqual({ start: "2025-10-01", end: "2025-10-15" });

  const r = find(out.rows, "Uit eten");
  expect(r.historyCents).toEqual(new Array(10).fill(5_000)); // de € 300 van de 25e telt niet mee
  expect(r.currentCents).toBe(6_000);
  expect(r.higher).toBe(10);
  expect(r.percentile).toBe(1);
  expect(r.reason).toBe(null);
});

test("een nieuwe categorie heeft geen verdeling — geen 100e percentiel", () => {
  const out = categorySpendPercentiles(
    [
      ...boodschappen,
      row("2026-08-31", "Boodschappen", 175),
      // Abonnement begonnen in deze maand: geen enkele eerdere maand gaat erover.
      row("2026-08-04", "Sportschool", 30),
      // En eentje van vorige maand: één eerdere periode, nog steeds te weinig.
      row("2026-07-10", "Verzekeringen", 42),
      row("2026-08-10", "Verzekeringen", 42),
    ],
    { asOf: "2026-08-31", coverage: { start: "2025-10-01", end: "2026-08-31" } },
  );

  const nieuw = find(out.rows, "Sportschool");
  expect(nieuw.reason).toBe("nieuwe-categorie");
  expect(nieuw.percentile).toBe(null);
  expect(nieuw.higher).toBe(0);
  expect(nieuw.historyCents).toEqual([]);
  expect(nieuw.currentCents).toBe(3_000);

  const kort = find(out.rows, "Verzekeringen");
  expect(kort.reason).toBe("te-kort-bekend");
  expect(kort.percentile).toBe(null);
  expect(kort.historyCents).toEqual([4_200]); // alleen juli telt als waarneming

  // De categorie die het wél kan, blijft gewoon werken naast de twee die het niet kunnen.
  expect(find(out.rows, "Boodschappen").percentile).toBe(0.8);
});

test("een maand waarvan maar een deel is geïmporteerd telt niet mee", () => {
  const out = categorySpendPercentiles([...boodschappen, row("2026-08-31", "Boodschappen", 175)], {
    asOf: "2026-08-31",
    coverage: { start: "2025-10-12", end: "2026-08-31" }, // afschrift begint midden in oktober
  });

  expect(out.compared).toHaveLength(9);
  expect(out.compared[0].start).toBe("2025-11-01");
  expect(find(out.rows, "Boodschappen").historyCents).toEqual(CLIMB.slice(1).map((e) => e * 100));
});

test("een maand die korter is dan het gemeten deel wordt overgeslagen en geteld", () => {
  const months = ["2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"];
  const rows = months.map((m) => row(`${m}-02`, "Vervoer", 40));
  const out = categorySpendPercentiles([...rows, row("2026-03-02", "Vervoer", 40)], {
    asOf: "2026-03-30", // dertig dagen gemeten
    coverage: { start: "2025-06-01", end: "2026-03-30" },
  });

  expect(out.comparedDays).toBe(30);
  expect(out.shortPeriods).toBe(1); // februari 2026 heeft geen dertigste dag
  expect(out.compared.some((p) => p.start === "2026-02-01")).toBe(false);
  expect(out.compared).toHaveLength(8);
});

test("een uitgave van nul is een gemeten nul, geen weigering", () => {
  const vakantie = MONTHS.map((m) => row(`${m}-08`, "Vakantie", 25));
  const out = categorySpendPercentiles([...boodschappen, ...vakantie, row("2026-08-31", "Boodschappen", 175)], {
    asOf: "2026-08-31",
    coverage: { start: "2025-10-01", end: "2026-08-31" },
  });

  const r = find(out.rows, "Vakantie");
  expect(r.currentCents).toBe(0);
  expect(r.lower).toBe(10);
  expect(r.percentile).toBe(0);
  expect(r.reason).toBe(null);
});

test("een reeks zonder spreiding krijgt geen percentiel van 50", () => {
  const netflix = [...MONTHS, "2026-08"].map((m) => row(`${m}-15`, "Abonnementen", 9.99));
  const out = categorySpendPercentiles(netflix, {
    asOf: "2026-08-31",
    coverage: { start: "2025-10-01", end: "2026-08-31" },
  });

  const r = find(out.rows, "Abonnementen");
  expect(r.same).toBe(10);
  expect(r.higher).toBe(0);
  expect(r.lower).toBe(0);
  expect(r.percentile).toBe(null);
  expect(r.reason).toBe("geen-verschil");
});

test("data die niet tot in de huidige periode reikt levert geen cijfer op", () => {
  const out = categorySpendPercentiles(boodschappen, {
    asOf: "2026-08-15",
    coverage: { start: "2025-10-01", end: "2026-07-05" }, // nieuwste afschrift is van juli
  });

  expect(out.measuredThrough).toBe(null);
  expect(out.compared).toHaveLength(0);
  const r = find(out.rows, "Boodschappen");
  expect(r.reason).toBe("geen-gegevens");
  expect(r.percentile).toBe(null);
  expect(r.currentCents).toBe(0);
});

test("periodes van drie maanden lopen op kwartalen van de peildatum terug", () => {
  const out = categorySpendPercentiles([row("2026-08-05", "Boodschappen", 10)], {
    asOf: "2026-08-31",
    monthsPerPeriod: 3,
    coverage: { start: "2024-01-01", end: "2026-08-31" },
    // maxHistory wordt opgetrokken tot minstens minHistory — een bovengrens
    // onder de ondergrens zou elke uitkomst bij voorbaat een weigering maken.
    minHistory: 2,
    maxHistory: 2,
  });

  expect(out.current).toEqual({ start: "2026-06-01", end: "2026-08-31" });
  expect(out.compared).toEqual([
    { start: "2025-12-01", end: "2026-02-28" },
    { start: "2026-03-01", end: "2026-05-31" },
  ]);
});

test("de peildatum bepaalt alles — geen klok in deze module", () => {
  const rows = [...boodschappen, row("2026-08-31", "Boodschappen", 175)];
  const juli = categorySpendPercentiles(rows, {
    asOf: "2026-07-31",
    coverage: { start: "2025-10-01", end: "2026-08-31" },
  });
  expect(juli.current).toEqual({ start: "2026-07-01", end: "2026-07-31" });
  expect(find(juli.rows, "Boodschappen").currentCents).toBe(19_000); // juli, niet augustus
  expect(juli.compared).toHaveLength(9);
});

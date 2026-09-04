import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Tx } from "@lavega/core";
import { formatEuro } from "../../format.js";
import StatistiekBlock, { gemiddeldeWeigeringNL } from "./StatistiekBlock";
import { own, rules, txs } from "./fixtures";

/* GEMIDDELDE INKOMSTEN EN GEMIDDELDE UITGAVEN — de weergave.
 *
 * Het rekenwerk staat in statistics.test.ts. Dit bestand bewaakt de twee dingen
 * die alleen op het scherm mis kunnen gaan:
 *
 *   1. "gemiddeld € 283,39" zonder eenheid is geen cijfer maar een raadsel, en
 *      met de VERKEERDE eenheid is het een extrapolatie. De eenheid moet er dus
 *      bij staan, en ze moet uit het venster komen.
 *   2. Een weigering mag niet opvouwen, en het advies erin moet werken in de
 *      toestand waarin het verschijnt.
 *
 * `renderToStaticMarkup` is genoeg: de gemiddelden staan onder de grafiek in
 * elke weergave, dus er valt niets weg te klikken. Een dichte <details> houdt
 * zijn kinderen in de DOM (zie ToonMeer.tsx), dus `toContain` op paneelinhoud
 * bewijst niets over de stand — dat wordt in StatistiekBlock.toonmeer.test.tsx
 * getest, waar een echte DOM is. */

const render = (t: Tx[] = txs) =>
  renderToStaticMarkup(
    <StatistiekBlock txs={t} rules={rules} own={own} onSelectCategory={() => {}} />,
  );

const tx = (id: string, date: string, amount: number, counterparty: string, category = ""): Tx => ({
  id,
  accountKey: "A1",
  date,
  amount,
  currency: "EUR",
  counterparty,
  description: "",
  category,
  manual: category !== "",
});

test("elk totaal krijgt zijn eigen gemiddelde, met de eenheid erbij", () => {
  const html = render();
  // De fixture dekt 4 juni t/m 11 augustus. Het venster staat op 12 maanden,
  // maar daar zit maar één hele kalendermaand in, dus wordt er per hele week
  // gemiddeld: negen weken, 8 juni t/m 9 augustus.
  expect(html).toContain(`gemiddeld ${formatEuro(9_500 / 9)} per week`);
  expect(html).toContain(`gemiddeld ${formatEuro((420.5 + 1_880 + 250) / 9)} per week`);
  // Het totaal blijft ernaast staan: het gemiddelde vervangt het niet.
  expect(html).toContain(formatEuro(12_000 + 9_500));
  expect(html).toContain(formatEuro(420.5 + 1_880 + 250 + 1_100));
});

test("waarover gemiddeld is staat in het label van de opgevouwen regel, niet erin", () => {
  const html = render();
  // De telling is de helft van het cijfer — wie de regel dichtlaat moet nog
  // steeds weten of dit over negen weken of over twee gaat.
  expect(html).toContain("Waarover deze twee gemiddelden gaan: 9 hele weken");
  // En het paneel zegt waaróm het geen maandbedrag is.
  expect(html).toContain("Niet per maand");
  expect(html).toContain("8 jun – 9 aug 2026");
  // De zes dagen aan de randen worden genoemd in plaats van stil meegedeeld.
  expect(html).toContain("6 dagen aan de randen tellen niet mee");
});

test("een gemiddelde telt geen geld mee dat alleen van plaats veranderde", () => {
  // Dezelfde val als in ronde 3, nu gedeeld door vier weken: een storting van
  // € 20.000 op zijn eigen beleggingsrekening zou € 5.000 per week "uitgaven"
  // opleveren naast € 25,00 aan echte boodschappen.
  const geparkeerd: Tx[] = [
    tx("g1", "2026-07-06", -50, "Albert Heijn"),
    tx("g2", "2026-07-08", -20_000, "Trading 212", "Sparen & beleggen"),
    tx("g3", "2026-07-20", -50, "Albert Heijn"),
    tx("g4", "2026-08-02", 4_000, "Klant BV"),
  ];
  const html = render(geparkeerd);
  expect(html).toContain(`gemiddeld ${formatEuro(25)} per week`);
  expect(html).not.toContain(formatEuro(5_025));
  // En wat er buiten bleef staat er nog steeds bij, in dezelfde regel als altijd.
  expect(html).toContain("Buiten deze cijfers gehouden");
});

test("te weinig om te middelen is een zin op de voorgrond, geen leeg vak", () => {
  const html = render([tx("k1", "2026-08-05", -30, "Albert Heijn")]);
  expect(html).toContain("Nog geen gemiddelde: deze periode bevat 1 dag afschrift");
  expect(html).toContain("minstens 2");
  // Geen verzonnen nul naast de weigering.
  expect(html).not.toContain("gemiddeld € 0,00 per");
  // En de weigering zit niet in een paneel: er is er geen.
  expect(html).not.toContain("Waarover deze twee gemiddelden gaan");
});

test("gemiddeldeWeigeringNL geeft alleen advies dat in díe toestand werkt", () => {
  // Ligt er afschrift buiten het venster, dan helpt een langere periode.
  expect(gemiddeldeWeigeringNL("te-kort", 1, true)).toBe(
    "Nog geen gemiddelde: deze periode bevat 1 dag afschrift, en middelen vraagt er minstens 2. " +
      "Een langere periode pakt de rest van je afschriften mee.",
  );
  // Is dit alles wat er is, dan klikt hij zich suf aan langere periodes; dan is
  // importeren het enige dat werkt.
  expect(gemiddeldeWeigeringNL("te-kort", 1, false)).toContain("Oudere afschriften importeren");
  expect(gemiddeldeWeigeringNL("te-kort", 1, false)).not.toContain("langere periode");
  // Geen enkele transactie is een ander feit dan één dag afschrift, en krijgt
  // een andere zin — niet "0 dagen".
  const leeg = gemiddeldeWeigeringNL("geen-gegevens", 0, true);
  expect(leeg).toContain("geen enkele transactie");
  expect(leeg).not.toContain("0 dagen");
});

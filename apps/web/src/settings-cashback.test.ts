// @vitest-environment jsdom
import { beforeEach, expect, test } from "vitest";
import { getCashbackAssumptionEnabled, setCashbackAssumptionEnabled } from "./settings";

/* DE SCHAKELAAR ONDER DE CASHBACK-AANNAME (app review 4, punt 22).
 *
 * Eén voorkeur, drie eigenschappen die er echt toe doen — en de eerste is de
 * omgekeerde van elke andere opt-in in dit bestand. AI-extractie, chat en
 * AI-categorisatie staan UIT tot hij ze aanzet, want die sturen gegevens de deur
 * uit. Deze staat AAN, want hij vroeg erom en er gaat niets de deur uit.
 *
 * Dat verschil zit in één teken (`!== "0"` in plaats van `=== "1"`), en precies
 * daar gaat het mis als iemand dit bestand ooit uniform maakt: dan is de aanname
 * stilletjes weg en staat er weer overal "onbekend" zonder dat iemand iets heeft
 * uitgezet. Vandaar de eerste test.
 */

beforeEach(() => localStorage.clear());

test("nooit ingesteld betekent AAN — dat is wat hij vroeg", () => {
  expect(localStorage.getItem("lavega.cashbackAssumption")).toBeNull();
  expect(getCashbackAssumptionEnabled()).toBe(true);
});

test("uitzetten blijft uit staan, en dat is de hele reden dat de schakelaar bestaat", () => {
  // Een aanname die je niet kunt uitzetten is niet te controleren: hij moet in
  // één klik terug kunnen naar "onbekend" om te zien wat er dan overblijft.
  setCashbackAssumptionEnabled(false);
  expect(getCashbackAssumptionEnabled()).toBe(false);
  setCashbackAssumptionEnabled(true);
  expect(getCashbackAssumptionEnabled()).toBe(true);
});

test("rommel in de opslag telt als AAN, niet als uit", () => {
  // Alleen een uitgesproken "0" zet hem uit. Een half geschreven waarde is geen
  // keuze van de gebruiker, en een keuze die niemand gemaakt heeft mag niet als
  // een gemaakte keuze doorgaan — dezelfde redenering als `getEnabledModules`.
  localStorage.setItem("lavega.cashbackAssumption", "ja");
  expect(getCashbackAssumptionEnabled()).toBe(true);
});

// @vitest-environment jsdom
import { beforeEach, expect, test } from "vitest";
import {
  autoRefreshDue,
  EB_AUTO_REFRESH_MS,
  everConnectedBank,
  lastEbRefreshAt,
  markBankConnected,
  markEbRefreshAttempted,
} from "./ebAutoRefresh.js";

/* AUTOMATISCH VERVERSEN, vier keer per dag. Zijn verzoek.
 *
 * Het staat in de browser en niet in een cron, en dat is geen keuze maar een
 * gevolg: de kluis staat in DEZE browser en de kopie op de server is een
 * ondoorzichtige blob die met de sleutel van de gebruiker is versleuteld. Een
 * server-cron zou de bank kunnen bellen en het antwoord nergens kwijt kunnen. */

beforeEach(() => localStorage.clear());

test("four times a day is the interval", () => {
  expect(EB_AUTO_REFRESH_MS).toBe(6 * 60 * 60 * 1000);
  expect((24 * 60 * 60 * 1000) / EB_AUTO_REFRESH_MS).toBe(4);
});

const base = { connected: true, lastAt: 1_000_000, now: 1_000_000, busy: false };

test("it waits the full interval and then goes", () => {
  expect(autoRefreshDue({ ...base, now: base.lastAt + EB_AUTO_REFRESH_MS - 1 })).toBe(false);
  expect(autoRefreshDue({ ...base, now: base.lastAt + EB_AUTO_REFRESH_MS })).toBe(true);
});

/* NOOIT TIJDENS EEN SCHRIJFBEWERKING. Een verversing die tussen `putAccounts`
 * en `putTxs` van een import valt, schrijft over een half geschreven kluis. */
test("it never fires while something is already writing", () => {
  expect(autoRefreshDue({ ...base, now: base.lastAt + EB_AUTO_REFRESH_MS, busy: true })).toBe(false);
});

/* Wie alleen bestanden importeert heeft geen bank, en hoort niet elk uur een
 * verzoek te sturen om te horen dat er niets te verversen valt. */
test("a browser that never connected a bank is never polled", () => {
  expect(autoRefreshDue({ ...base, now: base.lastAt + EB_AUTO_REFRESH_MS, connected: false })).toBe(
    false,
  );
});

/* "Nog nooit" is niet "lang geleden". Een browser die zojuist koppelde heeft de
 * data al; meteen opnieuw ophalen zou het bankverkeer verdubbelen zonder iets
 * toe te voegen — vandaar dat koppelen zelf de stempel ook zet. */
test("never-refreshed does not read as overdue", () => {
  expect(autoRefreshDue({ ...base, lastAt: 0, now: Date.now() })).toBe(false);
});

test("the stamp survives a reload", () => {
  expect(lastEbRefreshAt()).toBe(0);
  markEbRefreshAttempted(1_700_000_000_000);
  expect(lastEbRefreshAt()).toBe(1_700_000_000_000);
});

/* DE POGING EN DE KOPPELING ZIJN TWEE DINGEN, en ze uit elkaar houden is wat
 * een mislukte verversing van een lus onderscheidt.
 *
 * Alleen stempelen bij SUCCES is de tidy-ogende versie en is kapot: het effect
 * draait opnieuw zodra `busy` omslaat, dus een mislukte poging laat de klok
 * staan en de volgende ronde vindt de verversing meteen weer nodig — server
 * plat of rate-limited wordt dan een strakke lus van netwerkverzoeken.
 *
 * En andersom: een poging bewijst niet dat er een bank ís. Zou hij de
 * koppelvlag zetten, dan ging een browser zonder bank eeuwig staan pollen. */
test("an attempt moves the clock but never claims a bank exists", () => {
  markEbRefreshAttempted(1_700_000_000_000);
  expect(lastEbRefreshAt()).toBe(1_700_000_000_000);
  expect(everConnectedBank()).toBe(false);
  // Geen bank, dus ook na het verstrijken van het interval geen verzoek.
  expect(
    autoRefreshDue({
      connected: everConnectedBank(),
      lastAt: lastEbRefreshAt(),
      now: 1_700_000_000_000 + EB_AUTO_REFRESH_MS,
      busy: false,
    }),
  ).toBe(false);
});

test("connecting a bank is what turns auto-refresh on", () => {
  expect(everConnectedBank()).toBe(false);
  markBankConnected();
  expect(everConnectedBank()).toBe(true);
  // en het raakt de klok niet aan
  expect(lastEbRefreshAt()).toBe(0);
});

test("a corrupt stamp reads as never, not as long ago", () => {
  localStorage.setItem("lavega.ebLastRefreshAt", "gisteren");
  expect(lastEbRefreshAt()).toBe(0);
  expect(autoRefreshDue({ ...base, lastAt: lastEbRefreshAt(), now: Date.now() })).toBe(false);
});

/* DE LUS, als regressietest.
 *
 * Dit was een echte bug in de eerste versie, gevonden bij het nalopen van het
 * effect: `markEbRefreshed` stond op het SUCCESPAD, dus een mislukte poging
 * liet de klok staan. Het effect hangt aan `busy`, `setBusy(false)` in de
 * `finally` laat die omslaan, het effect draait opnieuw, `tick()` vindt de
 * verversing weer nodig — en dat herhaalt zich zo snel als het netwerk
 * antwoordt. Een server die 429 teruggeeft zou zo eeuwig 429 blijven krijgen.
 *
 * De eigenschap die dat dichtzet: NA EEN POGING IS HET NIET MEER NODIG, wat
 * die poging ook opleverde. */
test("a failed attempt still backs off — the clock moves on the attempt, not the outcome", () => {
  markBankConnected();
  const t = 1_700_000_000_000;

  // De mislukte poging: geen succes, wél een stempel (App doet dit in `finally`).
  markEbRefreshAttempted(t);

  const dueRightAfter = autoRefreshDue({
    connected: everConnectedBank(),
    lastAt: lastEbRefreshAt(),
    now: t + 1, // het effect draait meteen opnieuw als `busy` omslaat
    busy: false,
  });
  expect(dueRightAfter).toBe(false);

  // En pas na een vol interval opnieuw, net als na een geslaagde poging.
  expect(
    autoRefreshDue({
      connected: true,
      lastAt: lastEbRefreshAt(),
      now: t + EB_AUTO_REFRESH_MS,
      busy: false,
    }),
  ).toBe(true);
});

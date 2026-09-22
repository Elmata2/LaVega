import { expect, test } from "vitest";
import { moneyCopy } from "./money.js";

/* DE VRAAG OM EEN SALDO BIJ TE WERKEN, en de eigenschap die hem veilig maakt.
 *
 * Hij stond als Nederlandse zin in `packages/core/src/tracking.ts` en werd
 * letterlijk afgedrukt in Punten en in de aandachtsmelding, dus een Engelse
 * lezer kreeg "Hoeveel punten staan er nu bij ...". Core draagt nu `label` en
 * een `unit`-TOKEN; de zin staat hier.
 *
 * De afspraak die meeverhuisde: er mag GEEN GETAL in. Dat is waarom deze vraag
 * in een melding mag staan en aan de assistent gegeven mag worden — hij noemt
 * het programma en verder niets. Die eis stond in core's eigen test; zonder
 * deze test was hij bij de verhuizing verdampt. */

const AMEX = { label: "American Express Membership Rewards", unit: "points" };

test("the question names the programme and asks for just the number, in both languages", () => {
  expect(moneyCopy.nl.betaalschema.trackingQuestion(AMEX)).toBe(
    "Hoeveel punten staan er nu bij American Express Membership Rewards? Stuur alleen het getal.",
  );
  expect(moneyCopy.en.betaalschema.trackingQuestion(AMEX)).toBe(
    "How many points are at American Express Membership Rewards now? Send just the number.",
  );
});

test("no number of any kind can leak into the ask, in either language", () => {
  for (const locale of ["nl", "en"] as const) {
    const q = moneyCopy[locale].betaalschema.trackingQuestion(AMEX);
    expect(q, locale).not.toMatch(/\d/);
  }
});

/* Een niet-punten eenheid houdt zijn eigen teken; "€" is geen woord dat wij
 * vertalen, en een onbekend token wordt niet stilzwijgend "points". */
test("a unit that is not points is carried through as given", () => {
  const pot = { label: "bunq cashback", unit: "€" };
  expect(moneyCopy.nl.betaalschema.trackingQuestion(pot)).toBe(
    "Wat is het huidige saldo van bunq cashback (€)? Stuur alleen het getal.",
  );
  expect(moneyCopy.en.betaalschema.trackingQuestion(pot)).toBe(
    "What is the current balance of bunq cashback (€)? Send just the number.",
  );
});

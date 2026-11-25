import { planProfileOf, type AdvisorProfileStore } from "@lavega/core";

/** The one rule for "answer the intake questions first": no finished first
 *  block. "Jouw plan" shows only its invitation while this holds, and the card
 *  advice on Optimalisatie waits on the same answer. */
export const wizardFirst = (store: AdvisorProfileStore | null): boolean =>
  planProfileOf(store).intakeBlocksDone < 1;

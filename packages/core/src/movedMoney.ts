/* Money that only changes place is neither an expense nor income. ONE list, shared
 * by the Statistiek block (apps/web statistics.ts re-exports it) and the assistant
 * chat's spend and income tools, so the two can never count differently. */

export type MovedCategory = {
  category: string;
  /** Why it is outside the diagram, in the sentence the block prints. */
  why: string;
};

export const MOVED_CATEGORIES: readonly MovedCategory[] = [
  { category: "Eigen overboeking", why: "een overboeking tussen je eigen rekeningen" },
  { category: "Sparen & beleggen", why: "geld naar je eigen spaar- of beleggingsrekening" },
  {
    category: "Creditcard afbetaald",
    why: "een afbetaling aan je eigen creditcard — die uitgaven staan al op de creditcardrekening",
  },
  /* GELDOPNAME STAAT HIER BEWUST NIET IN, op zijn beslissing van 20 augustus.
   *
   * Strikt genomen is contant opnemen ook "dezelfde euro op een andere plek": het
   * geld zit in je zak in plaats van op de rekening. Maar het verschil met een
   * spaarrekening is dat LaVega het daarna nooit meer terugziet — er komt geen
   * transactie die zegt waar het heen ging. Als opnemen buiten de uitgaven valt,
   * verdwijnt dat geld uit elke telling en zou de som van zijn categorieën minder
   * zijn dan wat er werkelijk van zijn rekening ging.
   *
   * Een creditcard-afbetaling is een apart geval en nog niet beslist: daar staan de
   * echte uitgaven wél in de app, op de creditcardrekening, dus die afbetaling
   * dubbel tellen is een reëel risico. Dat wacht op hem. */
];

const MOVED_BY_CATEGORY = new Map(MOVED_CATEGORIES.map((m) => [m.category, m.why]));

/** Whether a category is money moving rather than money spent. */
export function isMovedCategory(category: string): boolean {
  return MOVED_BY_CATEGORY.has(category);
}

/** Why a moved category sits outside the totals ("" for any other category). */
export function movedCategoryWhy(category: string): string {
  return MOVED_BY_CATEGORY.get(category) ?? "";
}

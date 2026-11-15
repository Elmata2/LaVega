import type { Priority, SectionId } from "@lavega/core";

const SECTION_OF: Record<Priority, SectionId> = {
  "spend-less": "spending",
  "save-more": "goals",
  children: "goals",
  "start-investing": "goals",
  "pay-off-debt": "debts",
  "cards-points": "cards",
  subscriptions: "subscriptions",
};

/** Sections the person's priorities point at move to the front, in priority
 *  order (a section reached twice moves once, at its first position); the rest
 *  keep their order. No priorities leaves the order as it was. */
export function orderSections(sections: readonly SectionId[], priorities: readonly Priority[]): SectionId[] {
  const front: SectionId[] = [];
  for (const p of priorities) {
    const s = SECTION_OF[p];
    if (sections.includes(s) && !front.includes(s)) front.push(s);
  }
  return [...front, ...sections.filter((s) => !front.includes(s))];
}

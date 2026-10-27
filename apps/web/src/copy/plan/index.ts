import type { Locale } from "../../locale.js";
import { assumptionsCopy } from "./assumptions.js";
import { bufferCopy } from "./buffer.js";
import { cardsCopy } from "./cards.js";
import { debtsCopy } from "./debts.js";
import { goalsCopy } from "./goals.js";
import { monthCopy } from "./month.js";
import { planShellCopy } from "./shell.js";
import { spendingCopy } from "./spending.js";
import { subscriptionsCopy } from "./subscriptions.js";

export * from "./shared.js";
export { planShellCopy, type PlanShellCopy } from "./shell.js";
export { assumptionsCopy, type AssumptionsCopy } from "./assumptions.js";
export { monthCopy, type MonthCopy } from "./month.js";
export { bufferCopy, type BufferCopy } from "./buffer.js";
export { debtsCopy, type DebtsCopy } from "./debts.js";
export { spendingCopy, type SpendingCopy } from "./spending.js";
export { subscriptionsCopy, type SubsCopy } from "./subscriptions.js";
export { cardsCopy, type CardsCopy } from "./cards.js";
export { fromAnswersCopy, type FromAnswersCopy } from "./fromAnswers.js";
export { goalsCopy, learnShortHorizonText, type GoalsCopy } from "./goals.js";
export { FACT_GATED_EXAMPLES, WORDING_TABLES, type WordingTable } from "./wording.js";

/** Every plan copy module for one locale, for the page and for tests. */
export const planCopyByLocale = (locale: Locale) => ({
  shell: planShellCopy[locale],
  assumptions: assumptionsCopy[locale],
  month: monthCopy[locale],
  buffer: bufferCopy[locale],
  debts: debtsCopy[locale],
  spending: spendingCopy[locale],
  subscriptions: subscriptionsCopy[locale],
  cards: cardsCopy[locale],
  goals: goalsCopy[locale],
});

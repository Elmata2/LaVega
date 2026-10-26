import { monthsBetween } from "./months.js";
import { RISK_REVIEW_THRESHOLDS as R } from "./thresholds.js";

export const KNOWLEDGE_QUESTIONS: {
  id: "interest" | "inflation" | "diversification";
  options: { id: string; correct: boolean }[];
}[] = [
  {
    id: "interest",
    options: [
      { id: "more-than-102", correct: true },
      { id: "exactly-102", correct: false },
      { id: "less-than-102", correct: false },
    ],
  },
  {
    id: "inflation",
    options: [
      { id: "buy-less", correct: true },
      { id: "buy-same", correct: false },
      { id: "buy-more", correct: false },
    ],
  },
  {
    id: "diversification",
    options: [
      { id: "lower-risk", correct: true },
      { id: "higher-risk", correct: false },
      { id: "no-difference", correct: false },
    ],
  },
];

/** `answers` maps a question id to the chosen option id. */
export function scoreKnowledge(answers: Record<string, string>): number {
  return KNOWLEDGE_QUESTIONS.filter((q) =>
    q.options.some((o) => o.correct && o.id === answers[q.id]),
  ).length;
}

export function experienceOf(
  correct: number,
  investedBefore: boolean,
): "beginner" | "some" | "experienced" {
  if (!investedBefore && correct <= 1) return "beginner";
  if (investedBefore && correct >= KNOWLEDGE_QUESTIONS.length) return "experienced";
  return "some";
}

/** `changePct` is the size of an income change as a share (0.21 = 21%). Without
 *  it an income change is not counted: its size is unknown. */
export type LifeEvent = {
  kind: "child" | "income-change" | "new-debt";
  at: string;
  changePct?: number;
};

/** Risk answers are due after 12 whole months, or sooner on a life event after
 *  `riskAt`: a child, a new debt, or an income change over 20%. */
export function riskDue(riskAt: string, asOf: string, events: readonly LifeEvent[]): boolean {
  if (monthsBetween(riskAt, asOf) >= R.monthsUntilDue) return true;
  return events.some(
    (e) =>
      e.at > riskAt &&
      e.at <= asOf &&
      (e.kind === "child" ||
        e.kind === "new-debt" ||
        (e.kind === "income-change" && (e.changePct ?? 0) > R.incomeChangeShare)),
  );
}

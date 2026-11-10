import type { Rule, Tx } from "../model.js";
import { matchNorm } from "../categories.js";
import { categorize, type OwnAccounts } from "../views.js";
import { historyCoverage } from "./scopePersonal.js";

/** A prompt for "Do you have children?", never an answer and never a count. */
export type ChildSignal = { kind: "kinderbijslag" | "childcare"; evidence: string[] };

const CHILDCARE_WORDS = [
  "kinderopvang",
  "kinderdagverblijf",
  "buitenschoolse opvang",
  "gastouder",
  "peuterspeelzaal",
  "bso",
  "kdv",
  "creche",
];
const MIN_PAYMENTS = 2;

const has = (text: string, words: readonly string[]): boolean => {
  const h = ` ${matchNorm(text)} `;
  return words.some((w) => h.includes(` ${w} `));
};

export function childSignal(
  txs: readonly Tx[],
  rules: Rule[],
  own: OwnAccounts | undefined,
): ChildSignal | null {
  if (!historyCoverage(txs).sufficient) return null;
  const mine = txs.filter((t) => categorize(t, rules, own) !== "Eigen overboeking");
  const text = (t: Tx) => `${t.counterparty} ${t.description}`;
  const benefit = mine.filter((t) => t.amount > 0 && has(text(t), ["kinderbijslag"]));
  if (benefit.length >= MIN_PAYMENTS)
    return { kind: "kinderbijslag", evidence: benefit.map((t) => t.id) };
  const care = mine.filter((t) => t.amount < 0 && has(text(t), CHILDCARE_WORDS));
  if (care.length >= MIN_PAYMENTS) return { kind: "childcare", evidence: care.map((t) => t.id) };
  return null;
}

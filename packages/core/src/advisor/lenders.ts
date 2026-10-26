import { matchNorm } from "../categories.js";

/** Words that make an outgoing stream a debt repayment. DUO is also an
 *  institution in `subscriptions.ts`; it is listed so the label alone matches.
 *  Short and Dutch on purpose: a false debt is worse than a missed one, the
 *  user confirms either way. */
const LENDER_WORDS = [
  "duo",
  "dienst uitvoering onderwijs",
  "studieschuld",
  "lening",
  "krediet",
  "aflossing",
  "klarna",
  "afterpay",
  "findio",
  "santander consumer",
  "defam",
  "ferratum",
  "int. kredietbank",
];

/** True when the text names a known lender or a lending word, as whole words. */
export function looksLikeLender(text: string): boolean {
  const h = ` ${matchNorm(text)} `;
  return LENDER_WORDS.some((w) => h.includes(` ${w} `));
}

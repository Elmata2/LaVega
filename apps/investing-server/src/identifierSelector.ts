import type {
  IdentifierCandidate,
  IdentifierCandidateSelector,
  IdentifierRequest,
  IdentifierSelection,
} from "@lavega/adapters";
import type { SystemOneProvider } from "./systemOne.js";

/** Set once and measured, per the issue's own "set a placeholder and measure"
 *  note — not a claim about the right number. A pick below it still resolves;
 *  the stored confidence is what marks it for the owner. */
export const IDENTIFIER_SELECTION_CONFIDENCE_THRESHOLD = 0.6;

/** The worst case one selection call can cost, in euro cents, for the shared
 *  budget gate: a small state (the broker's instrument context plus at most a
 *  handful of candidates) against Jev's own 64k-token request budget. */
export const IDENTIFIER_SELECTION_WORST_CASE_CENTS = 2;

const NO_MATCH = "none_of_these_candidates" as const;

/** One option per candidate, keyed by a name the model can read. The option set
 *  IS the provider's candidate array: nothing else is offered (issue #136). */
function optionId(candidate: IdentifierCandidate, index: number): string {
  const ticker = candidate.ticker
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
  const exchange = (candidate.exchange ?? "unknown")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
  return `candidate_${index}_${ticker}_${exchange}`;
}

function candidateCriteria(candidate: IdentifierCandidate): string {
  return [
    `Ticker ${candidate.ticker}`,
    candidate.exchange ? `exchange ${candidate.exchange}` : "exchange not reported",
    candidate.name ? `name ${candidate.name}` : null,
    candidate.currency ? `currency ${candidate.currency}` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

/**
 * The Jev `Choice` selector (issue #136). It picks among the provider's own
 * candidates or answers the explicit "none of these" option; the provider then
 * copies the chosen candidate's fields verbatim, so the model can never invent
 * an identifier. No prose is generated and no question wording lives anywhere
 * else.
 */
export function createSystemOneIdentifierSelector(
  provider: SystemOneProvider,
): IdentifierCandidateSelector {
  return async (input): Promise<IdentifierSelection> => {
    const { candidates } = input;
    if (candidates.length === 0) return { kind: "no-match", confidence: 1 };
    const criteria: Record<string, string> = {};
    const byOption = new Map<string, IdentifierCandidate>();
    candidates.forEach((candidate, index) => {
      const id = optionId(candidate, index);
      criteria[id] = candidateCriteria(candidate);
      byOption.set(id, candidate);
    });
    criteria[NO_MATCH] = "None of these listings is the holding described in the state.";

    const holding = {
      isin: input.isin,
      ...(input.instrument?.name !== undefined ? { name: input.instrument.name } : {}),
      ...(input.instrument?.description !== undefined
        ? { description: input.instrument.description }
        : {}),
      ...(input.instrument?.currency !== undefined ? { currency: input.instrument.currency } : {}),
    };
    let result;
    try {
      result = await provider.judge({
        state: {
          holding,
          candidates: candidates.map((candidate, index) => ({
            option: optionId(candidate, index),
            ticker: candidate.ticker,
            exchange: candidate.exchange ?? null,
            name: candidate.name ?? null,
            currency: candidate.currency ?? null,
          })),
        },
        questions: {
          listing: {
            type: "choice",
            instructions:
              "Which candidate listing is the holding described in `holding`? The candidates are listings of the same security on different exchanges. Match the holding's name, description and currency; if no candidate plausibly describes it, choose the none option.",
            criteria,
          },
        },
      });
    } catch (error) {
      return { kind: "failed", reason: error instanceof Error ? error.message : String(error) };
    }
    const answer = result.answers.listing;
    if (!answer || answer.type !== "choice")
      return { kind: "failed", reason: "System One did not return a choice answer" };
    if (!Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1)
      return { kind: "failed", reason: `invalid confidence: ${answer.confidence}` };
    if (answer.choice === NO_MATCH) return { kind: "no-match", confidence: answer.confidence };
    const chosen = byOption.get(answer.choice);
    // An answer outside the option set is refused, never mapped onto a candidate.
    if (!chosen) return { kind: "failed", reason: "answer is not one of the offered candidates" };
    return {
      kind: "selected",
      ticker: chosen.ticker,
      ...(chosen.exchange !== undefined ? { exchange: chosen.exchange } : {}),
      confidence: answer.confidence,
    };
  };
}

/** The instrument context the provider may send: identity, never position. */
export function identifierInstrumentContext(
  request: IdentifierRequest,
): IdentifierRequest["instrument"] {
  return request.instrument;
}

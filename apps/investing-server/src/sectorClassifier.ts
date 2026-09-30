import { GICS_SECTOR_LABELS, SECTOR_TO_DIVISION, type GicsSectorLabel } from "@lavega/core";
import type { SystemOneProvider } from "./systemOne.js";

/** Set once and measured, per issue #135's own "Tuning the confidence
 *  threshold" out-of-scope note — not a claim about the right number. */
export const SECTOR_INFERENCE_CONFIDENCE_THRESHOLD = 0.6;

const NO_MATCH = "NoMatch" as const;

/** `classified` reports a sector or, below the confidence threshold, the
 *  division it rolls up into — `specificity` says which. `no-match` is the
 *  model's own explicit "none of these sectors fit"; safe to cache as
 *  Unknown. `failed` is everything else that kept the model from answering
 *  (provider error, timeout, budget refusal, a malformed response) — it must
 *  never be cached as Unknown, only retried later. */
export type SectorClassification =
  | { kind: "classified"; sector: string; specificity: "sector" | "division"; confidence: number }
  | { kind: "no-match" }
  | { kind: "failed"; reason: string };
export type SectorClassifier = (instrument: {
  symbol: string;
  description?: string;
}) => Promise<SectorClassification>;

const SECTOR_DESCRIPTIONS: Record<GicsSectorLabel, string> = {
  Technology: "Software, hardware, semiconductors, IT services.",
  "Financial Services": "Banks, insurers, asset managers, exchanges, payments.",
  Healthcare: "Pharmaceuticals, biotech, medical devices, healthcare providers.",
  "Consumer Cyclical": "Retail, autos, travel, leisure, discretionary consumer goods.",
  "Consumer Defensive": "Food, beverages, household staples, discount retail.",
  "Communication Services": "Telecoms, media, entertainment, internet platforms.",
  Industrials: "Manufacturing, aerospace, defense, transport, business services.",
  Energy: "Oil, gas, coal, energy exploration and production.",
  Utilities: "Electric, gas, and water utilities.",
  "Basic Materials": "Chemicals, mining, metals, forestry, construction materials.",
  "Real Estate": "REITs and real-estate management and development.",
};

const CRITERIA: Record<GicsSectorLabel | typeof NO_MATCH, string> = {
  ...SECTOR_DESCRIPTIONS,
  [NO_MATCH]: "No listed GICS sector plausibly describes this instrument.",
};

const GICS_SECTOR_LABEL_SET: ReadonlySet<string> = new Set(GICS_SECTOR_LABELS);

function isGicsSectorLabel(value: string): value is GicsSectorLabel {
  return GICS_SECTOR_LABEL_SET.has(value);
}

/** Every answer is checked against `GICS_SECTOR_LABELS` before it is trusted
 *  as a sector — the same discipline `portfolioAgent.ts` applies to its own
 *  Choice answers. `SystemOneProvider.judge` types `choice` as `string`, so
 *  nothing upstream stops a model from answering with text outside its own
 *  criteria; an unvalidated pass-through is exactly how a legal-entity name
 *  became a sector before (see `sectorTaxonomy.ts`'s header comment). An
 *  answer that fails validation reports `no-match`, never the raw string. */
export function createSystemOneSectorClassifier(
  provider: SystemOneProvider,
  threshold = SECTOR_INFERENCE_CONFIDENCE_THRESHOLD,
): SectorClassifier {
  return async (instrument) => {
    let result;
    try {
      result = await provider.judge({
        state: { symbol: instrument.symbol, description: instrument.description ?? null },
        questions: {
          sector: {
            type: "choice",
            instructions:
              "Classify this financial instrument into one GICS sector, using only its symbol and description.",
            criteria: CRITERIA,
          },
        },
      });
    } catch (error) {
      return { kind: "failed", reason: error instanceof Error ? error.message : String(error) };
    }
    const answer = result.answers.sector;
    if (!answer || answer.type !== "choice")
      return { kind: "failed", reason: "System One did not return a choice answer for sector" };
    if (!Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1)
      return { kind: "failed", reason: `invalid confidence: ${answer.confidence}` };
    if (answer.choice === NO_MATCH) return { kind: "no-match" };
    if (!isGicsSectorLabel(answer.choice)) return { kind: "no-match" };
    if (answer.confidence >= threshold)
      return {
        kind: "classified",
        sector: answer.choice,
        specificity: "sector",
        confidence: answer.confidence,
      };
    return {
      kind: "classified",
      sector: SECTOR_TO_DIVISION[answer.choice],
      specificity: "division",
      confidence: answer.confidence,
    };
  };
}

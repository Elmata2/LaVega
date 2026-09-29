import { SECTOR_TO_DIVISION, type GicsSectorLabel } from "@lavega/core";
import type { SystemOneProvider } from "./systemOne.js";

/** Set once and measured, per issue #135's own "Tuning the confidence
 *  threshold" out-of-scope note — not a claim about the right number. */
export const SECTOR_INFERENCE_CONFIDENCE_THRESHOLD = 0.6;

const NO_MATCH = "NoMatch";

export type SectorClassification = { sector: string; confidence: number };
export type SectorClassifier = (
  instrument: { symbol: string; description?: string },
) => Promise<SectorClassification | null>;

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

const CRITERIA: Record<string, string> = {
  ...SECTOR_DESCRIPTIONS,
  [NO_MATCH]: "No listed GICS sector plausibly describes this instrument.",
};

/** Never throws — a failed or ambiguous classification degrades to `null`,
 *  the same contract fetchYahooSectorProfile already has, so sectorResolution
 *  can treat a missing provider profile and a missing inference identically. */
export function createSystemOneSectorClassifier(
  provider: SystemOneProvider,
  threshold = SECTOR_INFERENCE_CONFIDENCE_THRESHOLD,
): SectorClassifier {
  return async (instrument) => {
    try {
      const result = await provider.judge({
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
      const answer = result.answers.sector;
      if (!answer || answer.type !== "choice" || answer.choice === NO_MATCH) return null;
      if (answer.confidence >= threshold) return { sector: answer.choice, confidence: answer.confidence };
      const division = SECTOR_TO_DIVISION[answer.choice as GicsSectorLabel];
      return division ? { sector: division, confidence: answer.confidence } : null;
    } catch {
      return null;
    }
  };
}

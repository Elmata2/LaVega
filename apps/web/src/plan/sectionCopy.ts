import type { SectionId } from "@lavega/core";
import { planCopyByLocale, type PlanFmt } from "../copy/plan/index.js";
import type { Locale } from "../locale.js";

/** What the frame needs from any section's copy. Each section types its own
 *  figures, reasons, missing kinds and calc ids; the frame only looks them up
 *  by the keys the section's own result carries, so it reads them loosely. */
export type FrameCopy = {
  reasons: Record<string, string | undefined>;
  headline: (figures: unknown, fmt: PlanFmt) => string;
  explain: {
    simple: (figures: unknown, fmt: PlanFmt) => string[];
    detailed: (figures: unknown, fmt: PlanFmt) => string[];
  };
  empty: Record<string, string | undefined>;
  howCalculated: Record<string, string | undefined>;
};

export const frameCopyOf = (locale: Locale, section: SectionId): FrameCopy =>
  planCopyByLocale(locale)[section] as unknown as FrameCopy;

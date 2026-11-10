import { isShowable, type PublicFact } from "../advisor/publicFact.js";

/* Figures taken from outside LaVega. Nothing here is verified at ship: the
 * owner adds entries (with verifiedOn, verifiedBy and sourceUrl) after
 * checking each against its source. Until then no outside figure renders. */

/** Spec section 15, open items 1-11. Data only: an id here shows nothing. */
export const PENDING_PUBLIC_FACT_IDS = [
  "gift-tax-annual-2026", // 15.1 annual gift-tax exemption, 2026
  "gift-tax-one-time-18-40", // 15.1 one-time higher exemption, ages 18-40
  "box3-minors", // 15.2 box 3 treatment of a minor's assets
  "afm-backbone", // 15.3 AFM backbone text
  "afm-long-term", // 15.4 AFM long-term-horizon text
  "afm-costs", // 15.5 AFM costs text
  "spiva-europe", // 15.6 SPIVA Europe scorecard
  "nibud-save-10pct", // 15.7 Nibud saving guidance
  "nibud-buffer-purpose", // 15.8 Nibud buffer purpose text
  "spending-reference-budget", // external reference budget for spending (no source chosen yet)
  "hist-fall-2008", // 15.9 2008 market fall
  "hist-fall-2020", // 15.9 2020 market fall
  "duo-rules", // 15.10 DUO study-finance rules
  "pension-overview-url", // 15.10 pension overview link
  "child-provider-values", // 15.11 child-account provider values
  "card-nl-terms", // 15.11 card terms (NL)
] as const;
export type PendingPublicFactId = (typeof PENDING_PUBLIC_FACT_IDS)[number];

export const PUBLIC_FACTS: readonly PublicFact[] = [];

const hasContent = (f: PublicFact): boolean =>
  f.textKey.trim() !== "" &&
  (typeof f.value === "number" ? Number.isFinite(f.value) : f.value.trim() !== "");

/** Facts that may render: verified (isShowable) and complete. */
export const showableFacts = (facts: readonly PublicFact[] = PUBLIC_FACTS): PublicFact[] =>
  facts.filter((f) => isShowable(f) && hasContent(f));

/** A showable fact by id, else null. */
export const factById = (
  id: string,
  facts: readonly PublicFact[] = PUBLIC_FACTS,
): PublicFact | null => showableFacts(facts).find((f) => f.id === id) ?? null;

export type FxRequest = { from: string; to: string; date?: string };
export type FxProviderResult = { rate: number; problems: string[] };
export type IdentifierRequest = {
  isin: string;
  /** Absolute epoch ms. A request slot after it ends the lookup as unresolved. */
  deadlineMs?: number;
  /** Broker-side instrument context (issue #136): the name, description and
   *  currency the broker reports for this holding. Identity resolution needs
   *  the instrument, never the position — no quantity, value or account. */
  instrument?: {
    name?: string;
    description?: string;
    currency?: string;
    /** The venue MIC the broker printed for the instrument (DeGiro's
     *  `Uitvoeringsplaats`, e.g. `XAMS`). A listing hint only: it may break a
     *  tie between listings the provider returned, never invent a ticker. */
    venue?: string;
  };
  /** The owner's own choice for this identifier, if any. Most trusted tier:
   *  it short-circuits the provider lookup and any stored model selection. */
  override?: { ticker: string; exchange?: string };
  /** True only when the caller has market-data consent AND the owner enabled
   *  identifier selection for this account. False (or absent) keeps today's
   *  behaviour exactly: the first candidate is taken, no model is called. */
  allowModelSelection?: boolean;
};
/** One instrument OpenFIGI offered for an identifier. `currency` is copied
 *  only when the provider reported it; nothing here is reconstructed. */
export type IdentifierCandidate = {
  ticker: string;
  exchange?: string;
  name?: string;
  currency?: string;
};
export type IdentifierMatch = {
  isin: string;
  ticker: string;
  exchange?: string;
  name?: string;
  currency?: string;
};
/** Which tier decided the resolution, most trusted first (issue #136). */
export type IdentifierResolutionTier = "owner-override" | "provider" | "model" | "unresolved";
/** The audit trail stored beside the resolution: how it was decided, how sure
 *  the model was, and every candidate the provider offered. */
export type IdentifierResolution = {
  tier: IdentifierResolutionTier;
  /** The selector's confidence, or null when no selector was involved. */
  confidence: number | null;
  candidates: readonly IdentifierCandidate[];
};
export type IdentifierProviderResult = {
  match: IdentifierMatch;
  problems: string[];
  resolution: IdentifierResolution;
};

/** What a selector may answer for an ambiguous identifier. `selected` must name
 *  a candidate the provider actually returned; the provider copies that
 *  candidate's fields verbatim and refuses an invented one. `no-match` is the
 *  explicit "none of these fits" option and maps to the unresolved outcome. */
export type IdentifierSelection =
  | { kind: "selected"; ticker: string; exchange?: string; confidence: number }
  | { kind: "no-match"; confidence: number }
  | { kind: "failed"; reason: string };

/** The injectable decision seam on the identifier provider (issue #136). The
 *  real one asks Jev; tests inject a fake. It is only called on ambiguity. */
export type IdentifierCandidateSelector = (input: {
  isin: string;
  instrument?: IdentifierRequest["instrument"];
  candidates: readonly IdentifierCandidate[];
}) => Promise<IdentifierSelection>;

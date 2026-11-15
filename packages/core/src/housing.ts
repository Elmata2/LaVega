import type { Rule, Tx } from "./model.js";
import { matchNorm } from "./categories.js";
import { detectRecurringStreams } from "./forecast.js";
import { categorize, type OwnAccounts } from "./views.js";

/* Woonlasten (rent or mortgage) READ FROM THE DATA instead of typed by hand.
 *
 * Optimalisatie's rent/savings framing asked the owner for a figure LaVega can
 * already see: a monthly outflow to the same counterparty, of a stable amount,
 * categorised as housing. `detectRecurringStreams` already finds exactly that,
 * so this module only decides which of its streams is the housing one and hands
 * the caller a PROPOSAL.
 *
 * Two rules govern the result, and both are about not lying:
 *   1. A proposal is always marked `source: "detected"`, never presented as an
 *      entered figure, and it names the counterparty and the occurrences behind
 *      it so the owner can check it in one glance.
 *   2. A figure the owner typed ALWAYS wins. `resolveHousingCost` never
 *      substitutes a derived number for a manual one, and when there is neither
 *      it returns null with `source: "unknown"` — not a zero, not a guess.
 *
 * Pure + deterministic: integer cents, no Date.now(), no I/O. */

/** The category the built-in Dutch rules give rent, mortgage, energy and water. */
const HOUSING_CATEGORY = "Wonen & energie";

/** Counterparty words that make a housing stream specifically the ROOF, as
 *  opposed to the energy/water bills that share the category. Matched on the
 *  normalized counterparty + description, so "Woningstichting Rochdale" and
 *  "Hypotheek 1234.56.789" both land. */
const RENT_HINTS = [
  "huur",
  "verhuur",
  "woningstichting",
  "woningcorporatie",
  "woonstichting",
  "vastgoed",
];
// "hypothe" and not "hypotheek": the plural is "hypotheken" (one e), so "ING
// Hypotheken" — a real counterparty — misses the singular. The built-in
// category rule in categories.ts has the same blind spot; this module does not
// depend on it.
const MORTGAGE_HINTS = ["hypothe"];

export type HousingKind = "huur" | "hypotheek" | "wonen";

export type HousingCandidate = {
  /** Stream key from detectRecurringStreams — stable across re-derivations. */
  key: string;
  counterparty: string;
  kind: HousingKind;
  monthlyCents: number; // positive integer cents, normalized to 30 days
  cadenceDays: number;
  occurrences: number;
  lastDate: string;
};

export type HousingProposal = HousingCandidate & {
  /** Every housing stream found, biggest monthly cost first — the chosen one
   *  included. The caller can offer these as alternatives; picking one is the
   *  owner's call, not ours. */
  alternatives: HousingCandidate[];
};

/** Name the kind of housing outflow, or "wonen" when it is housing-categorised
 *  but not recognisably rent or mortgage (energy, water, service charges). */
export function housingKind(text: string): HousingKind {
  const h = matchNorm(text);
  if (MORTGAGE_HINTS.some((w) => h.includes(w))) return "hypotheek";
  if (RENT_HINTS.some((w) => h.includes(w))) return "huur";
  return "wonen";
}

/** Rank: an explicitly named rent/mortgage stream beats an unnamed housing one,
 *  and within a kind the larger monthly amount wins. Rent is the biggest
 *  housing outflow in practice, but "named" is stronger evidence than "big", so
 *  it is the primary key. */
const KIND_RANK: Record<HousingKind, number> = { huur: 0, hypotheek: 0, wonen: 1 };

/** Propose the owner's monthly housing cost from the recurring payments already
 *  detected in his own transactions. Returns null when nothing qualifies — an
 *  absent proposal, never a placeholder figure.
 *
 *  A candidate must be: an OUTflow, on a monthly cadence (a quarterly service
 *  charge is not a monthly housing cost), and either categorised as
 *  "Wonen & energie" or explicitly named as rent/mortgage. `rules` and `own` are
 *  the caller's normal categorisation inputs, so a user rule that labels his
 *  landlord counts here too. */
export function proposeHousingCost(
  txs: Tx[],
  rules: Rule[],
  own?: OwnAccounts,
): HousingProposal | null {
  // Categorised housing spend keeps the stream detection focused; the hint match
  // catches a landlord the category rules do not know by name.
  const byKey = new Map<string, Tx[]>();
  const housing: Tx[] = [];
  for (const t of txs) {
    if (t.amount >= 0 || !t.date) continue;
    const text = `${t.counterparty} ${t.description}`;
    const named = housingKind(text) !== "wonen";
    if (!named && categorize(t, rules, own) !== HOUSING_CATEGORY) continue;
    housing.push(t);
    const key = `${t.counterparty}`;
    const g = byKey.get(key);
    if (g) g.push(t);
    else byKey.set(key, [t]);
  }
  if (housing.length === 0) return null;

  const candidates: HousingCandidate[] = [];
  for (const s of detectRecurringStreams(housing)) {
    if (s.sign !== -1) continue;
    if (s.cadenceDays !== 30) continue; // a monthly cost, stated monthly
    const sample = byKey.get(s.counterparty)?.[0];
    candidates.push({
      key: s.key,
      counterparty: s.counterparty,
      kind: housingKind(`${s.counterparty} ${sample?.description ?? ""}`),
      monthlyCents: s.amountCents,
      cadenceDays: s.cadenceDays,
      occurrences: s.occurrences,
      lastDate: s.lastDate,
    });
  }
  if (candidates.length === 0) return null;

  const alternatives = [...candidates].sort((a, b) => b.monthlyCents - a.monthlyCents);
  const best = [...candidates].sort(
    (a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || b.monthlyCents - a.monthlyCents,
  )[0];
  return { ...best, alternatives };
}

export type HousingAmountSource = "manual" | "detected" | "unknown";

export type HousingAmount = {
  /** null means we do not know — never 0, and never a default. */
  monthlyCents: number | null;
  source: HousingAmountSource;
  /** What the data suggests, whatever the source. Present even when a manual
   *  figure wins, so the UI can show "je vulde X in, LaVega ziet Y". */
  proposal: HousingProposal | null;
};

/** Resolve the housing cost to use, with the manual figure always on top.
 *  `manualCents` null/undefined means "he has not typed one"; a typed 0 is a
 *  real answer ("ik betaal geen huur") and is respected as such. */
export function resolveHousingCost(
  manualCents: number | null | undefined,
  txs: Tx[],
  rules: Rule[],
  own?: OwnAccounts,
): HousingAmount {
  const proposal = proposeHousingCost(txs, rules, own);
  if (manualCents !== null && manualCents !== undefined) {
    return { monthlyCents: Math.round(manualCents), source: "manual", proposal };
  }
  if (proposal) return { monthlyCents: proposal.monthlyCents, source: "detected", proposal };
  return { monthlyCents: null, source: "unknown", proposal: null };
}

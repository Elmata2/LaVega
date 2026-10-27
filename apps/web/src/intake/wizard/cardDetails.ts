import {
  makeRewardsBalance,
  norm,
  programForCard,
  type CardBalance,
  type RewardsBalance,
} from "@lavega/core";
import { cardLabel } from "./cardOptions.js";
import { parsePercent } from "./parsePercent.js";
import { parseEuros } from "./parseEuros.js";

/** What one row of the card-details form starts from. */
export type DetailRowInit = {
  cardId: string;
  name: string;
  balanceCents: number | null;
  paysInFull: boolean | null;
  ratePct: number | null;
  /** The rewards programme whose points are asked on this row (first card of it). */
  programName: string | null;
  points: number | null;
};

export type RowState = {
  balance: string;
  paysInFull: boolean | null;
  rate: string;
  points: string;
};

export type RowIssue = "balance" | "pays-in-full" | "rate" | "points";

/** Rows for the credit cards in `cardIds`. Points are asked on the first card
 *  of each programme only, and only when points can be saved at all. */
export function detailRows(i: {
  cardIds: readonly string[];
  balances: readonly CardBalance[];
  rewards: readonly RewardsBalance[];
  nameOf: (cardId: string) => string;
  askPoints: boolean;
}): DetailRowInit[] {
  const asked = new Set<string>();
  return [...new Set(i.cardIds)].map((cardId) => {
    const b = i.balances.find((x) => x.cardId === cardId);
    const program = i.askPoints ? programForCard(cardId) : null;
    const first = program !== null && !asked.has(norm(program));
    if (program !== null) asked.add(norm(program));
    const held = first ? i.rewards.find((r) => r.id === norm(program)) : undefined;
    return {
      cardId,
      name: i.nameOf(cardId),
      balanceCents: b?.balanceCents ?? null,
      paysInFull: b === undefined ? null : b.paysInFull,
      ratePct: b?.ratePct ?? null,
      programName: first ? program : null,
      points: held?.points ?? null,
    };
  });
}

const eurosText = (cents: number | null): string =>
  cents === null ? "" : String(Math.round(cents / 100));
const pctText = (n: number | null): string => (n === null ? "" : String(n).replace(".", ","));

export const initialState = (r: DetailRowInit): RowState => ({
  balance: eurosText(r.balanceCents),
  paysInFull: r.paysInFull,
  rate: pctText(r.ratePct),
  points: r.points === null ? "" : String(r.points),
});

const parsePoints = (t: string): number | null => {
  const s = t.replace(/[.\s ]/g, "");
  return /^\d{1,9}$/.test(s) ? Number(s) : null;
};

/** What is wrong with a row. An empty balance skips the card; a balance above
 *  zero needs the paid-in-full answer; a typed rate or points must parse. */
export function rowIssues(s: RowState, asksPoints: boolean): RowIssue[] {
  const out: RowIssue[] = [];
  const hasBalance = s.balance.trim() !== "";
  const balance = hasBalance ? parseEuros(s.balance) : null;
  if (hasBalance && balance === null) out.push("balance");
  if (balance !== null && balance > 0 && s.paysInFull === null) out.push("pays-in-full");
  if (s.paysInFull === false && s.rate.trim() !== "" && parsePercent(s.rate) === null)
    out.push("rate");
  if (asksPoints && s.points.trim() !== "" && parsePoints(s.points) === null) out.push("points");
  return out;
}

export type DetailsResult = {
  balances: CardBalance[];
  points: { program: string; points: number }[];
};

/** The rows as stored data. Rows with an empty balance and empty points give nothing. */
export function collectDetails(inits: readonly DetailRowInit[], states: readonly RowState[]): DetailsResult {
  const balances: CardBalance[] = [];
  const points: DetailsResult["points"] = [];
  inits.forEach((r, k) => {
    const s = states[k]!;
    const balance = s.balance.trim() === "" ? null : parseEuros(s.balance);
    if (balance !== null) {
      const paysInFull = balance === 0 ? true : s.paysInFull === true;
      const rate = !paysInFull && s.rate.trim() !== "" ? parsePercent(s.rate) : null;
      balances.push({
        cardId: r.cardId,
        balanceCents: balance,
        paysInFull,
        ...(rate === null ? {} : { ratePct: rate }),
      });
    }
    if (r.programName !== null && s.points.trim() !== "") {
      const n = parsePoints(s.points);
      if (n !== null) points.push({ program: r.programName, points: n });
    }
  });
  return { balances, points };
}

/** The name shown for a stated credit card: the catalogue name, the "other card"
 *  label, or the unknown label for an id the catalogue no longer has. */
export function cardName(cardId: string, otherLabel: string, unknownLabel: string): string {
  const label = cardLabel(cardId, otherLabel);
  return label === cardId ? unknownLabel : label;
}

/** The rewards list with the typed points stored. A balance whose number did not
 *  change keeps its row (and its updatedAt), so re-saving the form never makes
 *  an old balance look fresh. Null when nothing changed. */
export function applyPoints(
  rewards: readonly RewardsBalance[],
  points: DetailsResult["points"],
  asOf: string,
  upsert: (list: RewardsBalance[], b: RewardsBalance) => RewardsBalance[],
): RewardsBalance[] | null {
  let next = [...rewards];
  let changed = false;
  for (const pt of points) {
    const made = makeRewardsBalance({ program: pt.program, points: pt.points, updatedAt: asOf });
    const held = next.find((r) => r.id === made.id);
    if (held !== undefined && held.points === pt.points) continue;
    next = upsert(next, made);
    changed = true;
  }
  return changed ? next : null;
}

import { norm } from "./hash.js";

export type RewardsBalance = { id: string; program: string; points: number; updatedAt: string; note?: string };
export type RewardProgram = { name: string; centsPerPoint: number; category: string; note?: string };
export type AmexTransfer = { partner: string; ratio: number; note?: string };

/** One row per program: id is the normalized program name, so editing a
 *  program's balance updates the same row instead of duplicating it. */
export function makeRewardsBalance(r: Omit<RewardsBalance, "id">): RewardsBalance {
  return { ...r, id: norm(r.program) };
}

function findProgram(name: string, programs: readonly RewardProgram[]): RewardProgram | null {
  const n = norm(name);
  return programs.find((p) => norm(p.name) === n) ?? null;
}

/** Indicative euro value in cents using the program's cents-per-point, or null
 *  when the program isn't in the reference table (UI shows "waarde onbekend"). */
export function estimateValueCents(b: RewardsBalance, programs: readonly RewardProgram[] = REWARD_PROGRAMS): number | null {
  const p = findProgram(b.program, programs);
  if (!p) return null;
  return Math.round(b.points * p.centsPerPoint);
}

export function totalValueCents(balances: RewardsBalance[], programs: readonly RewardProgram[] = REWARD_PROGRAMS): number {
  return balances.reduce((sum, b) => sum + (estimateValueCents(b, programs) ?? 0), 0);
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** A balance is stale when it was last updated more than `maxDays` before asOf. */
export function isStale(b: RewardsBalance, asOf: string, maxDays = 90): boolean {
  return daysBetween(b.updatedAt, asOf) > maxDays;
}

export function amexTransferOptions(
  points: number,
  transfers: readonly AmexTransfer[] = AMEX_MR_TRANSFERS,
): { partner: string; miles: number; note?: string }[] {
  return transfers.map((t) => ({ partner: t.partner, miles: Math.round(points * t.ratio), note: t.note }));
}

/* Indicative reference — owner-maintained, re-verify periodically. cents/point
 * are rough "typical redemption" values; actual value varies by how you redeem. */
export const REWARDS_AS_OF = "2026-08-05";
export const REWARD_PROGRAMS: readonly RewardProgram[] = [
  { name: "American Express Membership Rewards", centsPerPoint: 1.0, category: "Creditcard", note: "0,5–2 ct/punt; transfer naar airline is vaak het meest waard" },
  { name: "Flying Blue (KLM/Air France)", centsPerPoint: 0.8, category: "Airline" },
  { name: "Avios (BA/Iberia)", centsPerPoint: 1.0, category: "Airline" },
  { name: "Miles & More (Lufthansa)", centsPerPoint: 0.8, category: "Airline" },
  { name: "Marriott Bonvoy", centsPerPoint: 0.6, category: "Hotel" },
  { name: "World of Hyatt", centsPerPoint: 1.5, category: "Hotel" },
  { name: "IHG One Rewards", centsPerPoint: 0.4, category: "Hotel" },
  { name: "Hilton Honors", centsPerPoint: 0.4, category: "Hotel" },
  { name: "bunq", centsPerPoint: 1.0, category: "Bank", note: "cashback in euro's" },
  { name: "ING", centsPerPoint: 1.0, category: "Bank", note: "ING NL heeft geen puntenprogramma — gebruik dit voor cashback/acties" },
];
export const AMEX_MR_TRANSFERS: readonly AmexTransfer[] = [
  { partner: "Flying Blue (KLM/Air France)", ratio: 1.0 },
  { partner: "Avios (BA/Iberia)", ratio: 1.0 },
  { partner: "Marriott Bonvoy", ratio: 1.0 },
  { partner: "Miles & More (Lufthansa)", ratio: 1.0, note: "controleer actuele ratio" },
];

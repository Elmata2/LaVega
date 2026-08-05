import { norm } from "./hash.js";

export type RewardsBalance = { id: string; program: string; points: number; updatedAt: string; note?: string };
export type RewardProgram = { name: string; category: string; note?: string };

/** One row per program: id is the normalized program name, so editing a
 *  program's balance updates the same row instead of duplicating it. */
export function makeRewardsBalance(r: Omit<RewardsBalance, "id">): RewardsBalance {
  return { ...r, id: norm(r.program) };
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

/** Reference list of known programs, used for the add-balance datalist.
 *  No value/transfer data here — value and transfer questions go to the
 *  LaVega chat assistant, which looks up current rates live. */
export const REWARD_PROGRAMS: readonly RewardProgram[] = [
  { name: "American Express Membership Rewards", category: "Creditcard" },
  { name: "Flying Blue (KLM/Air France)", category: "Airline" },
  { name: "Avios (BA/Iberia)", category: "Airline" },
  { name: "Miles & More (Lufthansa)", category: "Airline" },
  { name: "Marriott Bonvoy", category: "Hotel" },
  { name: "World of Hyatt", category: "Hotel" },
  { name: "IHG One Rewards", category: "Hotel" },
  { name: "Hilton Honors", category: "Hotel" },
  { name: "bunq", category: "Bank", note: "cashback in euro's" },
  { name: "ING", category: "Bank", note: "ING NL heeft geen puntenprogramma — gebruik dit voor cashback/acties" },
];

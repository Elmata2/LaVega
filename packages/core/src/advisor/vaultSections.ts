import type { AdvisorProfile, AdvisorProfileStore } from "./profile.js";
import { MAX_PROFILE_VERSIONS } from "./profile.js";

export type VaultSection = "profile" | "plan" | "learning" | "events";
export const VAULT_SECTIONS: readonly VaultSection[] = ["profile", "plan", "learning", "events"];

/** A value with the time it was written; newest write wins on merge. The
 *  payload is opaque here: the plan and AI steps fill the record types. */
export interface Stamped<T = unknown> {
  at: string;
  value: T;
}

export const PLAN_SNAPSHOT_LIMIT = 13;

/** `preferences`: one record, newest write wins. `snapshots`: keyed by
 *  `YYYY-MM`, newest write wins per month, the 13 newest months kept. */
export interface PlanSection {
  preferences: Stamped | null;
  snapshots: Record<string, Stamped>;
}
/** Concept state keyed by concept id, newest write wins per id. */
export type LearningSection = Record<string, Stamped>;

/** The envelope every event shares. Other fields ride along untouched, and an
 *  unknown `kind` is kept, so a later plan can add PlanEvent, ExplanationEvent
 *  and OutcomeEvent without an older device dropping them. */
export interface VaultEvent {
  id: string;
  kind: string;
  at: string;
  [extra: string]: unknown;
}

export interface SectionValue {
  profile: AdvisorProfileStore | null;
  plan: PlanSection;
  learning: LearningSection;
  events: VaultEvent[];
}

export const emptyPlanSection = (): PlanSection => ({ preferences: null, snapshots: {} });

/** Deterministic newest-wins: later `at` wins; equal `at` falls to a stable
 *  string compare so both devices pick the same record whichever is `a`. */
function newer<T extends Stamped>(a: T, b: T): T {
  if (a.at !== b.at) return a.at > b.at ? a : b;
  return JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}

function newerOrOnly<T extends Stamped>(
  a: T | null | undefined,
  b: T | null | undefined,
): T | null {
  if (a == null) return b ?? null;
  if (b == null) return a;
  return newer(a, b);
}

function mergeStampedRecords(
  a: Record<string, Stamped>,
  b: Record<string, Stamped>,
): Record<string, Stamped> {
  const out: Record<string, Stamped> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const mine = out[k];
    out[k] = mine === undefined ? v : newer(mine, v);
  }
  return out;
}

export function mergePlan(a: PlanSection, b: PlanSection): PlanSection {
  const merged = mergeStampedRecords(a.snapshots, b.snapshots);
  const newestMonths = Object.keys(merged).sort().slice(-PLAN_SNAPSHOT_LIMIT);
  const snapshots: Record<string, Stamped> = {};
  for (const month of newestMonths) snapshots[month] = merged[month]!;
  return { preferences: newerOrOnly(a.preferences, b.preferences), snapshots };
}

export const mergeLearning = (a: LearningSection, b: LearningSection): LearningSection =>
  mergeStampedRecords(a, b);

/** Union by id. The same id is the same event, so either copy will do; the
 *  earlier-sorted one is kept so the result does not depend on argument order.
 *  Output is ordered by `at`, then id. Idempotent, commutative, associative. */
export function mergeEvents(a: readonly VaultEvent[], b: readonly VaultEvent[]): VaultEvent[] {
  const byId = new Map<string, VaultEvent>();
  for (const e of [...a, ...b]) {
    const seen = byId.get(e.id);
    if (seen === undefined || JSON.stringify(e) < JSON.stringify(seen)) byId.set(e.id, e);
  }
  return [...byId.values()].sort((x, y) =>
    x.at === y.at ? (x.id < y.id ? -1 : x.id > y.id ? 1 : 0) : x.at < y.at ? -1 : 1,
  );
}

/** When a profile was last written: the latest `at` on any of its facts. */
export function profileUpdatedAt(p: AdvisorProfile): string {
  const ats: string[] = [];
  const addField = (f: { at: string } | undefined) => {
    if (f !== undefined) ats.push(f.at);
  };
  addField(p.household);
  addField(p.children);
  addField(p.housing);
  addField(p.savings);
  addField(p.buffer);
  addField(p.knowledge);
  addField(p.experience);
  addField(p.worries);
  addField(p.work);
  addField(p.statedCards);
  addField(p.statedDebitCards);
  for (const f of [...(p.incomeStreams ?? []), ...(p.fixedCosts ?? []), ...(p.goals ?? [])]) {
    addField(f);
  }
  for (const d of p.debts ?? []) addField(d);
  addField(p.risk);
  return ats.reduce((latest, at) => (at > latest ? at : latest), "");
}

/** The store with the later `updatedAt` wins (ties: stable JSON compare); the history is the union of both histories plus the
 *  losing current, newest first, de-duplicated, capped at 10. */
export function mergeProfileStores(
  a: AdvisorProfileStore,
  b: AdvisorProfileStore,
): AdvisorProfileStore {
  const aWins =
    a.updatedAt !== b.updatedAt
      ? a.updatedAt > b.updatedAt
      : JSON.stringify(a.current) >= JSON.stringify(b.current);
  const [win, lose] = aWins ? [a, b] : [b, a];
  const winKey = JSON.stringify(win.current);
  const seen = new Set<string>([winKey]);
  const versions: AdvisorProfile[] = [];
  const candidates = [...win.versions, lose.current, ...lose.versions].sort((x, y) => {
    const tx = profileUpdatedAt(x);
    const ty = profileUpdatedAt(y);
    return tx === ty ? 0 : tx > ty ? -1 : 1;
  });
  for (const p of candidates) {
    const key = JSON.stringify(p);
    if (seen.has(key)) continue;
    seen.add(key);
    versions.push(p);
  }
  return {
    current: win.current,
    versions: versions.slice(0, MAX_PROFILE_VERSIONS),
    updatedAt: win.updatedAt,
  };
}

/** One merge per section, for when two devices wrote. */
export const SECTION_MERGE = {
  profile: mergeProfileStores,
  plan: mergePlan,
  learning: mergeLearning,
  events: mergeEvents,
} as const;

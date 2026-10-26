import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  addSnapshot,
  computePlan,
  decodePlanState,
  changeBaseline,
  diffSnapshots,
  emptyPlanPreferences,
  encodePlanState,
  goalAnchorsOf,
  mergeEvents,
  planEventOf,
  planProfileOf,
  refreshDecision,
  snapshotOf,
  type Account,
  type AdvisorProfileStore,
  type CatalogueEntryLike,
  type ConversionMode,
  type EntityProfile,
  type LearnedFact,
  type OwnAccounts,
  type ChangeBaseline,
  type PlanDiff,
  type PlanEvent,
  type PlanInput,
  type PlanPreferences,
  type PlanResult,
  type PlanSection,
  type PlanSnapshot,
  type RateBenchmark,
  type RefreshTrigger,
  type RewardsBalance,
  type Rule,
  type Tx,
  type VaultEvent,
} from "@lavega/core";
import type { VaultStorage } from "@lavega/adapters";
import { MOVED_CATEGORIES } from "../components/blocks/statistics";
import { getCashbackAssumptionEnabled } from "../settings";
import { nowIso, todayIso } from "./clock";
import { buildHeldCards } from "./heldCards";

/** The three vault calls the plan needs; a full VaultStorage satisfies it. */
export type PlanStorage = Pick<VaultStorage, "getSection" | "putSection" | "appendEvents">;

export type UsePlanInput = {
  store: AdvisorProfileStore | null;
  storage: PlanStorage;
  /** UNSCOPED: the plan applies the personal scope itself. */
  accounts: Account[];
  txs: Tx[];
  entityProfiles: EntityProfile[];
  rules: Rule[];
  own: OwnAccounts;
  rewards: RewardsBalance[];
  facts: readonly LearnedFact[];
  catalogue: readonly CatalogueEntryLike[];
  rates: readonly RateBenchmark[];
  mode: ConversionMode;
  fxHistory: Record<string, Record<string, number>>;
  /** ISO day, fixed at app mount. */
  asOf: string;
  /** False while the app is still loading the data the plan reads; nothing is
   *  stored until it is true (a snapshot of half-loaded data would be wrong). */
  ready?: boolean;
};

export type UsePlan = {
  result: PlanResult;
  preferences: PlanPreferences;
  /** Every event in the vault log, including kinds that are not the plan's. */
  events: VaultEvent[];
  /** The live plan against the change-log baseline (see `changesSince`). */
  changes: PlanDiff;
  /** What `changes` is compared with: the newest earlier month's snapshot, else
   *  the first snapshot of this month. Null when nothing is stored yet. */
  changesSince: ChangesSince;
  /** The stored plan state has been read; writes before this would be dropped. */
  loaded: boolean;
  /** The stored plan section could not be decoded: it is left untouched and
   *  nothing new is written to it. */
  stateError: boolean;
  /** The last write failed; the state was rolled back to what is stored. */
  writeError: boolean;
  recompute(): Promise<void>;
  /** A function patch is applied to the preferences as they are when the write
   *  runs, so it can merge into a map without a lost update. */
  setPreference(
    patch: Partial<PlanPreferences> | ((current: PlanPreferences) => Partial<PlanPreferences>),
  ): Promise<void>;
  appendPlanEvent(e: PlanEvent): Promise<void>;
};

export type ChangesSince =
  | { kind: "earlier-month"; month: string }
  | { kind: "first-this-month" }
  | null;

const NO_CHANGES: PlanDiff = { changes: [], statusChanges: [], material: false, baseline: true };
const MOVED = new Set(MOVED_CATEGORIES.map((m) => m.category));

type Stored = {
  preferences: PlanPreferences;
  /** When the vault last stamped the preferences; null = it never held any. */
  prefsAt: string | null;
  snapshots: PlanSnapshot[];
  events: VaultEvent[];
  /** The stored plan section could not be decoded. */
  error: boolean;
};

export function usePlan(i: UsePlanInput): UsePlan {
  const { storage } = i;
  const ready = i.ready ?? true;
  // Tagged with the storage it was read from, so state read from another vault
  // (after a restore or sign-in) is never shown for this one.
  const [loaded, setLoaded] = useState<{ storage: PlanStorage; value: Stored } | null>(null);
  const stored = loaded?.storage === storage ? loaded.value : null;
  /** The storage the loaded state belongs to; ops queued for another one drop. */
  const current = useRef(storage);
  const [clockDay, setClockDay] = useState<string | null>(null);
  const ref = useRef<Stored | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [writeError, setWriteError] = useState(false);
  const blocked = useRef(false);

  const commit = useCallback(
    (next: Stored) => {
      ref.current = next;
      setLoaded({ storage, value: next });
    },
    [storage],
  );

  useEffect(() => {
    let alive = true;
    ref.current = null;
    blocked.current = false;
    current.current = storage;
    void (async () => {
      let section: PlanSection;
      let events: VaultEvent[];
      try {
        [section, events] = (await Promise.all([
          storage.getSection("plan"),
          storage.getSection("events"),
        ])) as [PlanSection, VaultEvent[]];
      } catch {
        if (!alive) return;
        blocked.current = true;
        commit({
          preferences: emptyPlanPreferences(),
          prefsAt: null,
          snapshots: [],
          events: [],
          error: true,
        });
        return;
      }
      if (!alive) return;
      try {
        const state = decodePlanState(section);
        commit({
          preferences: state.preferences,
          prefsAt: section.preferences?.at ?? null,
          snapshots: state.snapshots,
          events,
          error: false,
        });
      } catch {
        blocked.current = true;
        commit({
          preferences: emptyPlanPreferences(),
          prefsAt: null,
          snapshots: [],
          events,
          error: true,
        });
      }
    })();
    return () => {
      alive = false;
    };
  }, [storage, commit]);

  /** Every write goes through this one queue. An op reads the current state
   *  only after its clock stamp is taken and commits with no await in between,
   *  so concurrent callers cannot overwrite each other. The state moves first;
   *  if the write fails it goes back to what was stored and `writeError` is set. */
  const run = useCallback(
    (
      op: (s: Stored, at: string) => { next: Stored; write: () => Promise<void> } | null,
      touchesPlan: boolean,
    ): Promise<void> => {
      const owner = storage;
      const p = queue.current.then(async () => {
        const at = await nowIso();
        if (current.current !== owner) throw new Error("the vault changed; the write was dropped");
        if (touchesPlan && blocked.current) {
          throw new Error("the stored plan cannot be read; nothing was saved");
        }
        const s = ref.current;
        if (s === null) throw new Error("plan state is not loaded");
        const r = op(s, at);
        if (r === null) return;
        commit(r.next);
        try {
          await r.write();
          setWriteError(false);
        } catch (e) {
          commit(s);
          setWriteError(true);
          throw e;
        }
      });
      queue.current = p.catch(() => {});
      return p;
    },
    [commit, storage],
  );

  /** The plan section as stored. The preferences keep the vault's own stamp
   *  unless the user changed them, so a device that only stored a snapshot never
   *  wins a preferences merge. */
  const planWrite = useCallback(
    (next: Stored, at: string) => () => {
      const section = encodePlanState(
        { preferences: next.preferences, snapshots: next.snapshots },
        next.prefsAt ?? at,
      );
      return storage.putSection("plan", {
        ...section,
        preferences: next.prefsAt === null ? null : section.preferences,
      });
    },
    [storage],
  );

  const asOf = clockDay !== null && clockDay > i.asOf ? clockDay : i.asOf;
  const preferences = stored?.preferences ?? emptyPlanPreferences();
  const anchors = useMemo(() => goalAnchorsOf(stored?.events ?? []), [stored?.events]);
  const profile = useMemo(() => planProfileOf(i.store, anchors), [i.store, anchors]);
  const assumptionOn = useMemo(() => getCashbackAssumptionEnabled(), []);
  const events = stored?.events;
  const planEvents = useMemo(() => (events ?? []).flatMap((e) => planEventOf(e) ?? []), [events]);
  const heldCards = useMemo(
    () =>
      buildHeldCards({
        accounts: i.accounts,
        facts: i.facts,
        entries: i.catalogue,
        rewards: i.rewards,
        assumptionOn,
      }),
    [i.accounts, i.facts, i.catalogue, i.rewards, assumptionOn],
  );

  const inputAt = useCallback(
    (day: string): PlanInput => ({
      profile,
      txs: i.txs,
      accounts: i.accounts,
      entityProfiles: i.entityProfiles,
      rules: i.rules,
      own: i.own,
      rewards: i.rewards,
      catalogue: i.catalogue,
      rates: i.rates,
      heldCards,
      preferences,
      events: planEvents,
      mode: i.mode,
      fxHistory: i.fxHistory,
      movedCategories: MOVED,
      asOf: day,
    }),
    [
      profile,
      i.txs,
      i.accounts,
      i.entityProfiles,
      i.rules,
      i.own,
      i.rewards,
      i.catalogue,
      i.rates,
      heldCards,
      preferences,
      planEvents,
      i.mode,
      i.fxHistory,
    ],
  );
  const result = useMemo(() => computePlan(inputAt(asOf)), [inputAt, asOf]);

  /** Queue a snapshot of `r`. `when` is re-checked inside the queue against the
   *  state then current, so a repeated effect run cannot store twice. A month
   *  keeps its first snapshot: later ones in it store nothing. */
  const store = useCallback(
    (r: PlanResult, when: RefreshTrigger | "decide"): Promise<void> =>
      run((s, at) => {
        const prev = s.snapshots.at(-1) ?? null;
        let trigger: RefreshTrigger;
        if (when === "decide") {
          const why = refreshDecision(prev, r.asOf);
          if (why === null) return null;
          trigger = why;
        } else trigger = when;
        const snap = snapshotOf(r, trigger, profile.profileHash);
        const snapshots = addSnapshot(s.snapshots, snap);
        // This month already has its first snapshot, or the clock is behind
        // the newest one: nothing is stored.
        if (!snapshots.includes(snap)) return null;
        const next = { ...s, snapshots };
        return { next, write: planWrite(next, at) };
      }, true),
    [run, planWrite, profile.profileHash],
  );

  // On open and whenever the inputs move: queue a snapshot; the queue decides
  // whether the refresh rules ask for one.
  useEffect(() => {
    if (!ready || ref.current === null || blocked.current) return;
    store(result, "decide").catch(() => {});
  }, [ready, stored, result, store]);

  const recompute = useCallback(async () => {
    const today = await todayIso();
    const day = today > i.asOf ? today : i.asOf;
    setClockDay(day);
    await store(computePlan(inputAt(day)), "manual");
  }, [i.asOf, inputAt, store]);

  const setPreference = useCallback(
    (patch: Partial<PlanPreferences> | ((current: PlanPreferences) => Partial<PlanPreferences>)) =>
      run((s, at) => {
        const change = typeof patch === "function" ? patch(s.preferences) : patch;
        if (Object.keys(change).length === 0) return null;
        const next = { ...s, preferences: { ...s.preferences, ...change }, prefsAt: at };
        return { next, write: planWrite(next, at) };
      }, true),
    [run, planWrite],
  );

  const appendPlanEvent = useCallback(
    (e: PlanEvent) =>
      run((s) => {
        const next = { ...s, events: mergeEvents(s.events, [e]) };
        return { next, write: () => storage.appendEvents([e]) };
      }, false),
    [run, storage],
  );

  // The live plan against the baseline: what the change log shows. Derived, so
  // the moment of editing and a reload read the same.
  const { changes, changesSince } = useMemo((): {
    changes: PlanDiff;
    changesSince: ChangesSince;
  } => {
    if (stored === null || stored.error) return { changes: NO_CHANGES, changesSince: null };
    const base: ChangeBaseline | null = changeBaseline(stored.snapshots, result.asOf);
    if (base === null) return { changes: NO_CHANGES, changesSince: null };
    const diff = diffSnapshots(base.snapshot, snapshotOf(result, "manual", profile.profileHash));
    const alone =
      base.kind === "first-this-month" && stored.snapshots.length === 1 && !diff.material;
    return {
      // The only stored plan is this month's first and nothing differs: it is
      // still the first plan, not "nothing changed".
      changes: alone ? { ...diff, baseline: true } : diff,
      changesSince:
        base.kind === "earlier-month"
          ? { kind: "earlier-month", month: base.snapshot.asOf.slice(0, 7) }
          : { kind: "first-this-month" },
    };
  }, [stored, result, profile.profileHash]);

  return {
    result,
    preferences,
    events: stored?.events ?? [],
    changes,
    changesSince,
    loaded: stored !== null,
    stateError: stored?.error ?? false,
    writeError,
    recompute,
    setPreference,
    appendPlanEvent,
  };
}

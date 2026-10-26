import { useRef, useState } from "react";
import {
  commitProfile,
  emptyProfileStore,
  type AdvisorProfile,
  type AdvisorProfileStore,
} from "@lavega/core";

export type ProfileCommit = {
  store: AdvisorProfileStore;
  /** Apply a change and store it; rejects when the store cannot be written. */
  commit: (fn: (p: AdvisorProfile) => AdvisorProfile) => Promise<void>;
  /** Resolves true when the change is stored; false (and the notice) when not. */
  update: (fn: (p: AdvisorProfile) => AdvisorProfile) => Promise<boolean>;
  saveFailed: boolean;
  setSaveFailed: (failed: boolean) => void;
};

/** The one way a view changes the adviser profile. Saves run one after another:
 *  each starts when the one before has settled and builds on the store as it is
 *  then, so overlapping changes cannot overwrite each other or roll each other
 *  back. A failed save is rolled back only when nothing newer replaced it. */
export function useProfileCommit(
  initial: AdvisorProfileStore | null,
  onSave: (next: AdvisorProfileStore) => Promise<void>,
  now: () => string,
): ProfileCommit {
  const [store, setStore] = useState<AdvisorProfileStore>(
    () => initial ?? emptyProfileStore(now()),
  );
  const storeRef = useRef(store);
  const [saveFailed, setSaveFailed] = useState(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  function commit(fn: (p: AdvisorProfile) => AdvisorProfile): Promise<void> {
    const run = async (): Promise<void> => {
      const previous = storeRef.current;
      const next = commitProfile(previous, fn(previous.current), now());
      if (next === previous) return;
      storeRef.current = next;
      setStore(next);
      try {
        await onSave(next);
      } catch (e) {
        // Not stored: roll back, so the same answer given again is saved again
        // instead of being taken for a no-op. Only if nothing newer replaced it.
        if (storeRef.current === next) {
          storeRef.current = previous;
          setStore(previous);
        }
        throw e;
      }
      setSaveFailed(false);
    };
    const result = queue.current.then(run);
    queue.current = result.catch(() => undefined);
    return result;
  }

  const update = (fn: (p: AdvisorProfile) => AdvisorProfile): Promise<boolean> =>
    commit(fn).then(
      () => true,
      () => {
        setSaveFailed(true);
        return false;
      },
    );

  return { store, commit, update, saveFailed, setSaveFailed };
}

import { useEffect, useRef } from "react";
import { goalAnchorEventOf, goalAnchorsOf, type AdvisorProfileStore } from "@lavega/core";
import type { UsePlan } from "../usePlan.js";

/** Records the first anchor of each goal's straight-line schedule the first
 *  time the goal is seen: a (date, amount) pair, the goal's own date and typed
 *  saved-so-far. It is an append-only event with a fixed id per goal, so a
 *  second device that sees the goal first writes the same event and nothing
 *  already stored is overwritten. With no anchor the plan reads those same two
 *  values, so the figures do not change when this runs. A goal whose write
 *  failed is not retried until the page is opened again. */
export function useGoalAnchors(plan: UsePlan, store: AdvisorProfileStore | null): void {
  const tried = useRef(new Set<string>());
  const goals = store?.current.goals;
  const { loaded, stateError, events, appendPlanEvent } = plan;
  useEffect(() => {
    if (!loaded || stateError || goals === undefined) return;
    const anchored = goalAnchorsOf(events);
    for (const f of goals) {
      const id = f.value.id;
      if (anchored[id] !== undefined || tried.current.has(id)) continue;
      tried.current.add(id);
      appendPlanEvent(
        goalAnchorEventOf({
          goalId: id,
          at: f.at,
          startCents: f.value.startingBalanceCents ?? 0,
          first: true,
        }),
      ).catch(() => {});
    }
  }, [loaded, stateError, events, goals, appendPlanEvent]);
}

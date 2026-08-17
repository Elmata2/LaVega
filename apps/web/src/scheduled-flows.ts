import type { ScheduledFlow } from "@lavega/core";

/** Merge one view's saved flow list back into the FULL stored list.
 *
 *  Every view is handed only the flows of the scope it is showing, so the list
 *  it saves is a statement about THAT SUBSET and about nothing else. Writing it
 *  straight to storage would delete every flow the view never saw — silent and
 *  unrecoverable — which is exactly why Belasting used to be handed the whole
 *  unscoped list instead of its own.
 *
 *  So the save is a three-way merge. `shown` is precisely what the view was
 *  given, which is what makes a deletion legible: a flow that was in `shown` and
 *  is missing from `saved` was really removed, while a flow that was never in
 *  `shown` was not this view's business and is left untouched. Ids are
 *  content-hashed (core's `makeScheduledFlow`), so an edited flow arrives as a
 *  removal plus an addition rather than as a silent overwrite of a stored row.
 *
 *  `derived` is the flows that are COMPUTED on every render and never stored —
 *  today the ones projected from `expected` invoices. A view sees them like any
 *  other flow and hands them back, so they are dropped here. Storing one would
 *  double that invoice in the forecast and keep it there after the invoice was
 *  marked paid, which is a number the data no longer supports. */
export function mergeScheduledFlows(
  stored: readonly ScheduledFlow[],
  shown: readonly ScheduledFlow[],
  saved: readonly ScheduledFlow[],
  derived: readonly ScheduledFlow[],
): ScheduledFlow[] {
  const savedIds = new Set(saved.map((f) => f.id));
  const deletedIds = new Set(shown.filter((f) => !savedIds.has(f.id)).map((f) => f.id));
  const derivedIds = new Set(derived.map((f) => f.id));

  const byId = new Map<string, ScheduledFlow>();
  for (const f of stored) if (!deletedIds.has(f.id) && !derivedIds.has(f.id)) byId.set(f.id, f);
  for (const f of saved) if (!derivedIds.has(f.id)) byId.set(f.id, f);
  return [...byId.values()];
}

import type { Position } from "./model.js";

/** Who holds a position: one entity's account at one broker.
 *
 *  Two dated snapshots describe the same holding — the later one superseding
 *  the earlier — only when they share this identity. Entity and symbol alone
 *  are not enough: two brokers can hold the same instrument for the same
 *  entity, and reading their snapshots as one timeline makes whichever synced
 *  last erase the other.
 *
 *  `broker` and `account` are optional because snapshots persisted before
 *  provenance existed carry neither. Those legacy rows keep the key they have
 *  always had — one implicit account per entity — so reloading an old vault
 *  reconstructs exactly the quantity it used to. */
export type Ownership = { entity: string; broker?: string; account?: string };

/** The parts are JSON-encoded rather than joined on a separator character, so
 *  no broker or account name can be spelled to collide with another owner. */
export function ownershipKey(value: Ownership): string {
  return JSON.stringify([value.entity, value.broker ?? "", value.account ?? ""]);
}

function groupByOwnership<T extends Ownership>(values: readonly T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const key = ownershipKey(value);
    const group = groups.get(key);
    if (group) group.push(value);
    else groups.set(key, [value]);
  }
  return [...groups.values()];
}

/** The snapshots that still speak for their owner: per ownership key, the ones
 *  dated at that owner's latest `asOf`. Earlier dates are superseded anchors,
 *  and several rows sharing the newest date (a pie plus a direct holding, say)
 *  all count. */
export function latestOwnershipAnchors(positions: readonly Position[]): Position[] {
  return groupByOwnership(positions).flatMap((group) => {
    const latest = group
      .map((position) => position.asOf)
      .sort()
      .at(-1);
    return group.filter((position) => position.asOf === latest);
  });
}

/** Quantity these snapshots prove is held: reconstructed per ownership key,
 *  then summed for presentation. */
export function anchoredSnapshotQuantity(positions: readonly Position[]): number {
  return latestOwnershipAnchors(positions).reduce((sum, position) => sum + position.quantity, 0);
}

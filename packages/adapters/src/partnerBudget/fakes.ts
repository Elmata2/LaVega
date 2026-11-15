import type { PartnerBudgetClient, PartnerKey, PartnerSeen } from "./PartnerBudget.js";

/**
 * Test doubles for the promise seam. Not for production code: the immediate
 * budget never makes a caller wait, which is exactly what the guard must not do.
 */
export type PartnerBudgetCall =
  | { call: "awaitSlot"; key: PartnerKey; deadlineMs: number | undefined }
  | { call: "observe"; key: PartnerKey; seen: PartnerSeen }
  | { call: "reject"; key: PartnerKey; untilMs: number };

/** Grants every slot at once and remembers what it was asked. */
export function createImmediatePartnerBudget(): PartnerBudgetClient & {
  calls: PartnerBudgetCall[];
} {
  const calls: PartnerBudgetCall[] = [];
  return {
    calls,
    awaitSlot: async (key, deadlineMs) => {
      calls.push({ call: "awaitSlot", key, deadlineMs });
    },
    observe: async (key, seen) => {
      calls.push({ call: "observe", key, seen });
    },
    reject: async (key, untilMs) => {
      calls.push({ call: "reject", key, untilMs });
    },
  };
}

/** A budget whose store is down: every call rejects as `PartnerBudgetUnavailable` would. */
export function createFailingPartnerBudget(error: unknown): PartnerBudgetClient {
  return {
    awaitSlot: () => Promise.reject(error),
    observe: () => Promise.reject(error),
    reject: () => Promise.reject(error),
  };
}

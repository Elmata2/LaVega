import type { Account, EntityProfile, EntityScope, ScheduledFlow, Tx } from "@lavega/core";
import { entityScope } from "@lavega/core";

/* Persoonlijk | Zakelijk — the shell's one filter.
 *
 * The per-company selector is gone from the chrome (per-company splitting is
 * explicitly not a priority), but NOTHING about entities was removed: an
 * account still belongs to an entity, every view still receives an entity
 * scope, and Transacties/Rekeningen still filter per company. What changed is
 * which axis the shell asks about first.
 *
 * The classification is core's (`packages/core/src/entities.ts`): it lives on
 * the ENTITY, and an account answers through its entity. There is no second
 * axis here — these helpers only apply core's `entityScope()` to the three
 * lists the shell hands down (accounts, transactions, scheduled flows) so the
 * whole app narrows consistently and a business obligation can never surface
 * while you are looking at your private money.
 *
 * Pure: no I/O, no clock. */

/** Left to right, as the switch reads. */
export const SCOPE_ORDER: readonly EntityScope[] = ["personal", "business"] as const;

/** The switch's own wording (Alexander's: "Persoonlijk | Zakelijk"). Core's
 *  ENTITY_SCOPE_LABELS says "Privé" for the same value; this is the chrome's
 *  label, and the two must never be mixed inside one screen. */
export const SCOPE_LABELS: Record<EntityScope, string> = {
  personal: "Persoonlijk",
  business: "Zakelijk",
};

/** The transactions of the given accounts. Called with the already-scoped
 *  accounts, so a transaction follows its account's classification instead of
 *  being classified again on its own. */
export function txsForAccounts(accounts: readonly Account[], txs: readonly Tx[]): Tx[] {
  const keys = new Set(accounts.map((a) => a.key));
  return txs.filter((t) => keys.has(t.accountKey));
}

/** The scheduled flows (VAT set-asides, invoices, manual plans) of one scope.
 *  A flow carries its own entity — it can exist for an entity that has no
 *  account yet — so it is classified directly rather than via `accounts`. */
export function flowsForScope(
  flows: readonly ScheduledFlow[],
  scope: EntityScope,
  profiles: readonly EntityProfile[] = [],
): ScheduledFlow[] {
  return flows.filter((f) => entityScope(f.entity, profiles) === scope);
}

/** The entities present in the given accounts, in first-seen order. The list
 *  the per-company controls that survive (Transacties' filter, Belasting's
 *  per-BV modules) are built from — so they offer the companies inside the
 *  active scope and nothing else. */
export function entityOptionsFor(accounts: readonly Account[]): string[] {
  return Array.from(new Set(accounts.map((a) => a.entity).filter((e) => e.length > 0)));
}

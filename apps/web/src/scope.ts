import type { Account, EntityProfile, EntityScope, ScheduledFlow, Tx } from "@lavega/core";
import { entityScope } from "@lavega/core";
import type { View } from "./App";

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

/* --- The screen each half is left on --------------------------------------
 *
 * The bug this fixes: the switch changed WHICH money you see but nothing about
 * WHERE you were, and the two halves shared one set of view filters. Two things
 * followed, and between them they are exactly what "switching back does not
 * bring back what was there before" describes:
 *
 *   · An unclassified vault has an empty Zakelijk. Its one actionable line
 *     sends you to Rekeningen — "switching to Zakelijk shows only the
 *     accounts" — and switching back re-scoped the data while leaving you
 *     standing on that page. The Overzicht he was reading never came back.
 *   · A filter naming a PERSONAL account (Rekeningen → "4 transacties") stayed
 *     set when he crossed over, narrowing Zakelijk to nothing — an empty screen
 *     with no stated reason.
 *
 * So the switch now parks the screen of the half you leave and restores the
 * screen of the half you enter. A half you have never opened starts on the
 * module you are on now, with NO filters: an account/entity/category filter
 * names things that only exist in the half you just left, so carrying it across
 * can only mislead. Pure; the shell does the state-setting. */

/** Everything about the screen that belongs to one half of the money. */
export type ScopeScreen = {
  view: View;
  fEntity: string;
  fAccount: string;
  fSearch: string;
  fFrom: string;
  fTo: string;
  fCategory: string;
};

/** Where the parked screens live, keyed by half. A half with no entry has never
 *  been opened — which is not the same as "was opened and had nothing". */
export type ParkedScreens = Partial<Record<EntityScope, ScopeScreen>>;

/** The same module, none of the filters. What a half you have never opened
 *  shows the first time you cross into it. */
export function unfilteredScreen(view: View): ScopeScreen {
  return { view, fEntity: "", fAccount: "", fSearch: "", fFrom: "", fTo: "", fCategory: "" };
}

/** The screen to show after switching to `next`: the one that half was left on,
 *  else the current module with the filters dropped. */
export function screenOnSwitch(
  parked: ParkedScreens,
  next: EntityScope,
  current: ScopeScreen,
): ScopeScreen {
  return parked[next] ?? unfilteredScreen(current.view);
}

/** The entities present in the given accounts, in first-seen order. The list
 *  the per-company controls that survive (Transacties' filter, Belasting's
 *  per-BV modules) are built from — so they offer the companies inside the
 *  active scope and nothing else. */
export function entityOptionsFor(accounts: readonly Account[]): string[] {
  return Array.from(new Set(accounts.map((a) => a.entity).filter((e) => e.length > 0)));
}

import type { Account, Tx } from "./model.js";
import { norm } from "./hash.js";
import { consolidate } from "./ingest.js";

/* Personal vs. business (BACKLOG item 4).
 *
 * THE DECISION: this is a REFRAMING of `entity`, not a second axis on the
 * account. `entity` already answers "whose money is this" (privé, BV1, BV2) and
 * everything downstream — consolidate(), the forecast, VatSettings, the tax
 * packs — is keyed on it. A per-account `scope` living BESIDE `entity` would let
 * an account claim entity "BV1" + scope "personal", a contradiction nothing in
 * the app could resolve.
 *
 * What `entity` genuinely cannot carry is the one bit the owner is being asked
 * for: a free-text name does not tell the app whether "Holding" is a company or
 * "Vakantiepot" is a private pot. So the classification is stored ON THE ENTITY
 * (an `EntityProfile`), and every account answers through its entity. Every
 * account therefore still "gets a classification" — it just inherits it instead
 * of owning a field that could disagree with its entity.
 *
 * The default is PERSONAL and it is a hard default: an unclassified entity is
 * personal, full stop. `suggestEntityScope()` exists only so the UI can PREFILL
 * the picker from a name that reads like a legal form; it never resolves on its
 * own, so nothing is silently promoted to "business" behind the owner's back.
 *
 * Pure: no I/O, no clock. Every mutator returns fresh arrays. */

export const ENTITY_SCOPES = ["personal", "business"] as const;
export type EntityScope = (typeof ENTITY_SCOPES)[number];

/** An unclassified entity is personal. Item 4 asks for this explicitly. */
export const DEFAULT_ENTITY_SCOPE: EntityScope = "personal";

/** Dutch UI labels (Dutch in the UI, English in code identifiers). */
export const ENTITY_SCOPE_LABELS: Record<EntityScope, string> = {
  personal: "Privé",
  business: "Zakelijk",
};

/** The owner's classification of one entity. Stored per vault, keyed on the
 *  entity name as the owner spells it; matching is case/space-insensitive so
 *  "BV1" and "bv1 " are the same profile. */
export type EntityProfile = { entity: string; scope: EntityScope };

/** Tokens that mark a legal form or an explicitly business name. Matched as
 *  whole tokens after dots are stripped, so "B.V." → "bv" hits and "bvergadering"
 *  does not. Deliberately short: a false "business" suggestion is worse than no
 *  suggestion, because the picker is prefilled from it. */
const BUSINESS_TOKENS = new Set([
  "bv",
  "nv",
  "vof",
  "holding",
  "beheer",
  "eenmanszaak",
  "zzp",
  "bedrijf",
  "zakelijk",
  "gmbh",
  "ug",
  "gbr",
  "ohg",
  "kgaa",
  "sarl",
  "ltd",
  "llc",
  "inc",
  "business",
  "company",
]);
const PERSONAL_TOKENS = new Set([
  "prive",
  "persoonlijk",
  "personal",
  "huishouden",
  "gezin",
  "thuis",
  "prive-rekening",
]);

/** Lowercase, de-accented, dot-free tokens of an entity name. "Privé" → ["prive"],
 *  "Steunenberg B.V." → ["steunenberg","bv"]. */
function entityTokens(entity: string): string[] {
  return norm(entity)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\./g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** A SUGGESTION for the classification picker, never the resolved value: a
 *  legal-form token ⇒ business, an explicitly private name ⇒ personal, anything
 *  else ⇒ the personal default. Business wins a tie ("Privé Holding BV" is a
 *  company), because a legal form is the stronger signal. */
export function suggestEntityScope(entity: string): EntityScope {
  // A numbered entity is written as one token ("BV1", "BV2" — the very names
  // item 4 uses), so a trailing counter is stripped before the lookup.
  const tokens = entityTokens(entity).flatMap((t) => [t, t.replace(/\d+$/, "")]);
  if (tokens.some((t) => BUSINESS_TOKENS.has(t))) return "business";
  if (tokens.some((t) => PERSONAL_TOKENS.has(t))) return "personal";
  return DEFAULT_ENTITY_SCOPE;
}

function profileIndex(profiles: readonly EntityProfile[]): Map<string, EntityProfile> {
  const m = new Map<string, EntityProfile>();
  for (const p of profiles) m.set(norm(p.entity), p);
  return m;
}

/** The resolved classification of an entity: the owner's explicit profile, else
 *  personal. Never consults `suggestEntityScope` — the default is the default. */
export function entityScope(entity: string, profiles: readonly EntityProfile[] = []): EntityScope {
  return profileIndex(profiles).get(norm(entity))?.scope ?? DEFAULT_ENTITY_SCOPE;
}

/** The classification of one account, inherited from its entity. */
export function accountScope(
  account: Account,
  profiles: readonly EntityProfile[] = [],
): EntityScope {
  return entityScope(account.entity, profiles);
}

/** Upsert one entity's classification. Case/space-insensitive on the entity, so
 *  re-classifying "bv1" updates the "BV1" row instead of adding a second one;
 *  the stored spelling stays the one already on file. Immutable. */
export function setEntityScope(
  profiles: readonly EntityProfile[],
  entity: string,
  scope: EntityScope,
): EntityProfile[] {
  const key = norm(entity);
  let found = false;
  const next = profiles.map((p) => {
    if (norm(p.entity) !== key) return p;
    found = true;
    return { ...p, scope };
  });
  return found ? next : [...next, { entity, scope }];
}

/** Drop an entity's classification (back to the personal default). Immutable. */
export function clearEntityScope(
  profiles: readonly EntityProfile[],
  entity: string,
): EntityProfile[] {
  const key = norm(entity);
  return profiles.filter((p) => norm(p.entity) !== key);
}

export type EntitySummary = {
  entity: string;
  scope: EntityScope;
  /** true when the owner classified this entity himself; false = the default. */
  explicit: boolean;
  /** What the picker should prefill when `explicit` is false. */
  suggested: EntityScope;
  accountKeys: string[];
};

/** One row per entity present in `accounts`, with its resolved classification —
 *  the list behind a "classify your accounts" screen. Entities are grouped by
 *  their exact spelling on the account (that is what the rest of the app keys
 *  on) and sorted by name for determinism. */
export function entitySummaries(
  accounts: readonly Account[],
  profiles: readonly EntityProfile[] = [],
): EntitySummary[] {
  const byEntity = new Map<string, string[]>();
  for (const a of accounts) {
    const list = byEntity.get(a.entity);
    if (list) list.push(a.key);
    else byEntity.set(a.entity, [a.key]);
  }
  const explicitKeys = new Set(profileIndex(profiles).keys());
  return [...byEntity]
    .map(([entity, accountKeys]) => ({
      entity,
      scope: entityScope(entity, profiles),
      explicit: explicitKeys.has(norm(entity)),
      suggested: suggestEntityScope(entity),
      accountKeys,
    }))
    .sort((a, b) => a.entity.localeCompare(b.entity));
}

/** Rename an entity everywhere at once — the "call this one BV1" action, as
 *  opposed to `reassignEntity`, which moves a SINGLE account to another entity.
 *  Accounts on `from` move to `to`; the classification moves with them, except
 *  when `to` already exists, in which case the target's own classification wins
 *  (merging into an existing entity must not silently re-classify it). Pure;
 *  a no-op when the names are identical or `to` is blank. */
export function renameEntity(
  accounts: readonly Account[],
  profiles: readonly EntityProfile[],
  from: string,
  to: string,
): { accounts: Account[]; profiles: EntityProfile[] } {
  if (from === to || to.trim() === "") return { accounts: [...accounts], profiles: [...profiles] };
  const nextAccounts = accounts.map((a) => (a.entity === from ? { ...a, entity: to } : a));
  const index = profileIndex(profiles);
  const target = index.get(norm(to));
  const moved = index.get(norm(from));
  const rest = profiles.filter((p) => norm(p.entity) !== norm(from) && norm(p.entity) !== norm(to));
  if (target) return { accounts: nextAccounts, profiles: [...rest, target] };
  if (moved)
    return { accounts: nextAccounts, profiles: [...rest, { entity: to, scope: moved.scope }] };
  return { accounts: nextAccounts, profiles: [...profiles] };
}

/** The accounts of one scope. Pass the FULL accounts list. */
export function accountsInScope(
  accounts: readonly Account[],
  scope: EntityScope,
  profiles: readonly EntityProfile[] = [],
): Account[] {
  return accounts.filter((a) => accountScope(a, profiles) === scope);
}

/** Privé-vs-zakelijk rollup, built by re-labelling each account's entity with
 *  its scope and running the EXISTING `consolidate()` — so the in/out/balance
 *  semantics (a null balance anywhere makes the group unknown) are identical to
 *  the per-entity view by construction, not by a second copy of the rules.
 *  Per-entity consolidation is untouched; this is an extra lens on the same data.
 *  A tx whose account is missing lands under "onbekend", exactly as it does in
 *  `consolidate` — which is why the key type is `string`, not `EntityScope`. */
export function consolidateByScope(
  accounts: readonly Account[],
  txs: readonly Tx[],
  profiles: readonly EntityProfile[] = [],
): {
  byScope: Record<string, { in: number; out: number; balance: number | null }>;
  totalBalance: number | null;
} {
  const relabelled = accounts.map((a) => ({ ...a, entity: accountScope(a, profiles) as string }));
  const { byEntity, totalBalance } = consolidate(relabelled, [...txs]);
  return { byScope: byEntity, totalBalance };
}

/** De transacties van ÉÉN onderneming. Een `Tx` draagt alleen een `accountKey`,
 *  dus de entiteit komt van de rekening waar hij op staat.
 *
 *  Staat hier en niet in een scherm omdat er inmiddels meer dan één scherm deze
 *  vraag stelt (Belasting, en de btw-kaart op het overzicht). Dat is precies het
 *  patroon dat in deze repo eerder is misgegaan: twee kopieën van dezelfde regel
 *  die daarna uit elkaar lopen. Eén definitie, en beide schermen tellen dus
 *  gegarandeerd dezelfde transacties.
 *
 *  Een tx op een rekening die niet in `accounts` staat hoort bij geen enkele
 *  onderneming en valt buiten elke uitkomst — hem bij de gevraagde entiteit
 *  optellen zou een bedrag ophogen met geld waarvan niemand weet van wie het is. */
export function txsForEntity(
  txs: readonly Tx[],
  accounts: readonly Account[],
  entity: string,
): Tx[] {
  const keyToEntity = new Map<string, string>();
  for (const a of accounts) keyToEntity.set(a.key, a.entity);
  return txs.filter((t) => keyToEntity.get(t.accountKey) === entity);
}

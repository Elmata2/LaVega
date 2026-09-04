import type { Account, Tx } from "./model.js";
import type { OwnName } from "./categories.js";
import { isOwnName } from "./categories.js";
import { hash, norm } from "./hash.js";
import { entityScope, entitySummaries, type EntityProfile, type EntityScope } from "./entities.js";
import { ownAccounts, ownAccountNamed, type OwnAccounts } from "./views.js";
import { merchantKey } from "./subscriptions.js";
import { findIban } from "./parsers/primitives.js";
import type { FactSource } from "./facts.js";

/* ── DE GRENS TUSSEN PRIVÉ EN ZAKELIJK ──────────────────────────────────────
 *
 * Today a transfer from BV1 to Privé is categorised "Eigen overboeking" and
 * disappears. That is RIGHT for cash — the money did not leave the owner — and
 * WRONG for tax, because a business entity paying a personal one is the single
 * largest movement in a DGA's year and it is the one the app swallows. It is
 * also why his own review said the top-expenditure list "doesn't add much"
 * (review 2, item 6): the biggest rows are excluded from it by design.
 *
 * Both legs of such a transfer are in the vault, so the crossing is MEASURABLE
 * EXACTLY. This module measures it. It states no consequence.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO, so the next reader does not read
 * an absence as an oversight:
 *
 *  1. THERE IS NO GEBRUIKELIJKLOONMETER. The design proposed one — "salaris"
 *     crossings summed against the statutory minimum. The owner answered on
 *     20 August that it does not apply to him: "het is niet voor DGA's met
 *     loon, het is gewoon inkomen al belast met btw." There is no payroll, no
 *     loonstrook and no monthly loonheffing in his transactions, so a meter
 *     built on the assumption that there is one would compare a measurement
 *     against a rule that does not bind him. It is not built, and no statutory
 *     figure is imported here — this file reads no tax pack at all.
 *  2. THERE IS NO BOX-2 CALENDAR. The design called it "the closest thing to
 *     advice in the entire proposal", and it is: a bracket plus a date plus a
 *     measured dividend total is one verb away from telling him when to pay
 *     himself. Left unbuilt on purpose. Nothing in these types carries a rate,
 *     a bracket or a threshold, and nothing should be added.
 *  3. THE THIRD READING OF A CROSSING IS NOT A VALUE. In bookkeeping a
 *     business→personal movement that is neither salary nor dividend has a
 *     name: it describes a loan relationship between the owner and his own
 *     company. That name is a CONCLUSION ABOUT A LEGAL RELATIONSHIP, not
 *     something the vault measured, and it must never reach a screen. Here it
 *     collapses into "onbekend", which is what the data actually supports.
 *
 * THE LINE (design §7): LaVega may say what happened, when the next date is,
 * and what a published rule says. It may not say what he should do. That is why
 * every function here returns amounts, dates and counts — and why the one field
 * that carries an interpretation (`kind`) can only ever be filled in BY HIM.
 *
 * Pure: no I/O, no clock, `asOf` is passed in, money is integer cents. */

/** What ONE crossing was, according to him. Never inferred from the amount, the
 *  cadence or the description: LaVega can see that € 2.000 moved from BV1 to
 *  Privé on the 25th; it cannot see which of these it was, and the difference
 *  is a tax consequence. Absent an answer the value is "onbekend" — and see
 *  `kindSource`: "onbekend" with no source means NOBODY SAID, which is a real
 *  state and not a guess dressed as one. */
export type CrossScopeKind = "salaris" | "dividend" | "onbekend";

/**
 * WHY a row is on the list at all. The distinction carries the honesty of the
 * total, so it is a field and not a comment.
 *
 *  · `twee-benen`             — the outflow AND the inflow are both in the
 *                               vault and were paired. The strongest evidence
 *                               there is: nothing was inferred.
 *  · `eigen-rekening-genoemd` — one leg only, and the row names another of HIS
 *                               OWN accounts on the other side of the boundary
 *                               (the BV paying a private credit card direct:
 *                               the card's statement was never imported, so
 *                               there is no counter-leg to pair).
 *  · `eigen-naam-genoemd`     — one leg only, and the counterparty is HIS OWN
 *                               NAME, which he typed himself (see `OwnName`).
 *
 * A leftover leg with NEITHER of those is not on the list. That rule is what
 * keeps the headline number from being fiction: without a counter-leg and
 * without his own account or name on the row there is no evidence the money
 * went to him rather than to a supplier, and counting it would turn ordinary
 * payments into private draws. If a later change relaxes this to "any business
 * outflow we cannot explain", the module starts inventing.
 */
export type CrossScopeEvidence = "twee-benen" | "eigen-rekening-genoemd" | "eigen-naam-genoemd";

/**
 * Why there is no measurement — and each value is a different sentence on
 * screen, never € 0.
 *
 *  · `geen-zakelijke-entiteit`   — no entity is marked business. `entities.ts`
 *                                  defaults every entity to personal, so in a
 *                                  vault where he has classified nothing the
 *                                  crossing count is STRUCTURALLY zero: not
 *                                  because nothing crossed, but because nothing
 *                                  is classified. This is the "je saldi staan al
 *                                  op de beste plek" defect waiting to happen in
 *                                  a new place, and it is the reason this whole
 *                                  return type is a union.
 *  · `geen-persoonlijke-entiteit`— the mirror: everything is business, so there
 *                                  is no other side to cross to.
 *  · `geen-transacties`          — classified fine, but no transaction in the
 *                                  window sits on an account this module can
 *                                  place. See `unseen` for why.
 *  · `gemeten`                   — it was measured. An empty list here is a real
 *                                  zero and may be stated as one.
 */
export type CrossScopeState =
  | "geen-zakelijke-entiteit"
  | "geen-persoonlijke-entiteit"
  | "geen-transacties"
  | "gemeten";

/** One side of a crossing, as it stands in the vault. */
export type CrossScopeLeg = {
  txId: string;
  accountKey: string;
  entity: string;
  scope: EntityScope;
  date: string;
  /** Signed, in cents: negative left the account, positive arrived. */
  signedCents: number;
  counterparty: string;
};

/**
 * One movement across the boundary.
 *
 * `amountCents` is a POSITIVE magnitude (the `ScheduledFlow` convention) and it
 * is the amount of the crossing, NOT of its legs: a paired crossing carries two
 * legs and is still one movement of one amount. Any total that sums legs
 * instead of crossings doubles every paired row — there is a test that fails if
 * someone does.
 *
 * `date` is the day the money LEFT (the outflow leg). For a one-legged inflow
 * there is no outflow to date, so it is the day it arrived; `legs` says which
 * of the two it was.
 *
 * `toEntity` is null only for `eigen-naam-genoemd`: his own name on the other
 * side identifies the PERSON, not which of his personal entities received it.
 * Null is the honest answer there, and it is why the field is nullable at all.
 */
export type CrossScopeCrossing = {
  /** Stable across re-runs (derived from the leg tx ids, which are content
   *  hashes) so an answer he gave yesterday still lands on this row today. */
  id: string;
  /** The stream this crossing belongs to — the entity pair. Also an answer
   *  target: answering the stream answers every crossing in it. */
  streamKey: string;
  fromEntity: string | null;
  toEntity: string | null;
  fromScope: EntityScope;
  toScope: EntityScope;
  date: string;
  amountCents: number;
  currency: string;
  matched: boolean;
  evidence: CrossScopeEvidence;
  legs: CrossScopeLeg[];
  kind: CrossScopeKind;
  /** Who said so. `null` = nobody has answered; the kind is "onbekend" BY
   *  ABSENCE. "user" = he answered (possibly "onbekend" — "I don't know" is an
   *  answer and must not be asked again). */
  kindSource: FactSource | null;
};

/** One entity pair, rolled up — the level the screen speaks at, and the level
 *  he is asked at. The design's sentence comes out of exactly these fields:
 *  "EUR 12.400 ging in 2026 van BV1 naar Privé en LaVega weet van EUR 8.100
 *  daarvan niet wat het was" = totalCents / unknownCents. */
export type CrossScopeStream = {
  key: string;
  fromEntity: string | null;
  toEntity: string | null;
  fromScope: EntityScope;
  toScope: EntityScope;
  count: number;
  totalCents: number;
  /** Of the total: paired (both legs seen) versus single-legged. Split because
   *  they are different strengths of claim and must not be presented as one. */
  matchedCents: number;
  unmatchedCents: number;
  /** The part of the total carrying no answer — the "LaVega weet niet wat het
   *  was" half of the sentence. */
  unknownCents: number;
  unknownCount: number;
  firstDate: string;
  lastDate: string;
  kind: CrossScopeKind;
  kindSource: FactSource | null;
};

/** Rows this module could NOT place, counted rather than dropped silently. It
 *  is not optional and it sits on every state, so a caller cannot render a
 *  total without having the exclusions in hand. */
export type CrossScopeUnseen = {
  /** Transactions on an accountKey that is in no `Account`. They belong to no
   *  entity, so they have no scope — and there is no third scope value to say
   *  so. `accountScope()` would answer "personal" for them, which is a default
   *  pretending to be a fact, so they are excluded here instead. */
  noAccount: number;
  /** Transactions on an account whose `entity` is blank. Same reasoning: an
   *  account with no entity cannot inherit a classification. */
  noEntity: number;
};

/** The answer he gave, at the level he gave it. NOT a `LearnedFact`, and that
 *  was a decision, not an oversight — see the note above `resolveKind`. */
export type CrossScopeAnswer = {
  /** A `CrossScopeStream.key` or a `CrossScopeCrossing.id`. Both are produced
   *  by this module; nothing else may be a target. */
  target: string;
  kind: CrossScopeKind;
  source: FactSource;
  /** ISO date the answer was given. Optional; only used to break a tie between
   *  two answers on the same target from the same source. */
  updatedAt?: string;
};

export type CrossScopeInput = {
  /** The FULL accounts list, both halves of the boundary. See the note on
   *  `crossScopeTransfers`. */
  accounts: readonly Account[];
  /** The FULL transactions list. */
  txs: readonly Tx[];
  profiles: readonly EntityProfile[];
  asOf: string;
  /** Window start; defaults to 1 January of `asOf`'s year. */
  from?: string;
  /** His own name(s), when he has told the app what they are. Absent means no
   *  claim: without a name nothing is matched on one, and the
   *  `eigen-naam-genoemd` class simply yields nothing. */
  names?: readonly OwnName[];
  answers?: readonly CrossScopeAnswer[];
};

/** What every state carries, measured or not. */
type CrossScopeContext = {
  window: { from: string; to: string };
  entities: {
    /** Entities the owner explicitly marked business / personal, plus the ones
     *  nobody has classified — `unclassified` is what turns a silent zero into
     *  "je hebt nog geen entiteit als zakelijk gemarkeerd". */
    business: string[];
    personal: string[];
    unclassified: string[];
  };
  unseen: CrossScopeUnseen;
};

/**
 * A UNION, not an object with an empty array.
 *
 * An array cannot say why it is empty, and the one thing this feature must
 * never do is render € 0 at a man whose vault is simply unclassified. So the
 * measured fields DO NOT EXIST on the other states: `report.crossings` does not
 * typecheck until the caller has narrowed on `state`. The view cannot get this
 * wrong, in the same way `VatPosition` cannot be rendered without its basis.
 */
export type CrossScopeReport =
  | (CrossScopeContext & { state: Exclude<CrossScopeState, "gemeten"> })
  | (CrossScopeContext & {
      state: "gemeten";
      crossings: CrossScopeCrossing[];
      streams: CrossScopeStream[];
      /** Sum of `crossings[].amountCents`. Never a sum over legs. */
      totalCents: number;
      matchedCents: number;
      unmatchedCents: number;
      /** The first and last day this module actually saw data on, inside the
       *  window. "stand tot vandaag" needs this: the window is what we asked
       *  for, `observed` is what was there. */
      observed: { from: string; to: string };
      /** Outflow legs that had a same-magnitude candidate on the other side of
       *  the boundary, inside the date window, IN ANOTHER CURRENCY — and were
       *  therefore not paired, because pairing them would need an FX rate this
       *  module does not have and must not invent.
       *
       *  A FLOOR, NOT A TOTAL, and the comment has to say so: a genuine EUR→USD
       *  transfer has two DIFFERENT magnitudes, so it never becomes a candidate
       *  and is never counted here at all. This counts only the refusals we can
       *  see. Someone with a Wise balance is quietly short either way; this at
       *  least makes part of the shortfall visible. */
      currencyMismatch: number;
      /** One-legged INFLOW crossings dropped because an equal, same-direction
       *  one-legged outflow crossing already stands for that movement. See the
       *  mirror-suppression note in `crossScopeTransfers`. Counted rather than
       *  hidden: it is the one place this module deliberately reports less than
       *  it saw. */
      mirrorSuppressed: number;
      /** Outflows from a BUSINESS account that carried NO evidence at all — no
       *  pair, no own account and no own name on the row — and that printed an
       *  account number belonging to NO account in this vault.
       *
       *  WHY IT EXISTS. Without it there was a fourth road to the one screen
       *  the state union was built to prevent, and it walked around the union
       *  rather than through it: a vault holding a single € 12.400 transfer
       *  from BV1 to his own Rabobank privérekening — an account he never
       *  imported — reached state "gemeten" with totalCents 0, every exclusion
       *  counter at 0, and a screen saying that a measurement had found nothing
       *  crossing. € 12.400 crossed. The three classified-vault states cannot
       *  produce that sentence; this row could, because it was dropped and
       *  counted nowhere. Now it is counted, and the screen says what LaVega
       *  could not see instead of asserting there was nothing to see.
       *
       *  A COUNT, AND DELIBERATELY NOT AN AMOUNT. Most rows in it are ordinary
       *  payments to third parties — that is the entire reason a leg without
       *  evidence is not a crossing (see `CrossScopeEvidence`). A euro total
       *  beside them would read as money that might have gone to him, which is
       *  the insinuation this module exists to refuse. HOW MANY rows LaVega
       *  could not see through is a fact; WHAT they were is not.
       *
       *  Business side only, and that is a judgement about noise rather than a
       *  claim about symmetry. ASSUMED, not measured against his own export:
       *  the ING CSV carries the counter-IBAN in "Mededelingen"
       *  (`parsers/bankCsv.ts`), so an ordinary transfer row prints an account
       *  number, and on a privérekening most of those are the landlord and the
       *  Tikkies — rows nobody suspects of crossing anything. The BV paying out
       *  is the direction this boundary is about, so that is the side counted.
       *  One pass over a real statement should confirm or kill the assumption;
       *  if it is wrong, the cost is a caveat that never fires on the private
       *  side, not a wrong figure anywhere. */
      unknownCounterAccount: number;
      /** Whether he has told the app his own name at all. Not a count, not
       *  optional, and on the measured arm on purpose: without a name
       *  `isOwnName` returns false for every row, so the whole
       *  `eigen-naam-genoemd` class yields nothing and a one-legged transfer
       *  that names only him is invisible. A report built without a name
       *  measured with one of its three eyes shut, and the screen has to be
       *  able to say which. */
      ownNameKnown: boolean;
    });

/** ASSUMED, NOT MEASURED — and it is on the honest side of the trade.
 *
 *  A SEPA transfer between two of his own banks lands same-day or next-day; a
 *  credit-card account can lag a couple of days before it books the payment it
 *  received. Four days covers both with room. It has NOT been checked against
 *  his real export, because this lane has no access to one.
 *
 *  Which way each error goes: too NARROW turns a genuine pair into two
 *  unmatched legs, and an unmatched leg only counts with evidence, so the TOTAL
 *  DROPS. Too WIDE starts pairing unrelated rows that happen to share an
 *  amount, and the total INFLATES. Both are bad; the second is worse, because
 *  it is invisible. Hence four rather than fourteen. One pass over his own
 *  statements should replace this number with a measured one. */
const PAIR_WINDOW_DAYS = 4;

/** The same number, exported, so the SCREEN can state the window it measured
 *  with instead of printing its own copy of "4". A view that hardcodes it keeps
 *  claiming four days on the day someone replaces this constant with a measured
 *  one — and the claim, not the constant, is what he reads. */
export const CROSS_SCOPE_PAIR_WINDOW_DAYS = PAIR_WINDOW_DAYS;

/** How far apart two one-legged crossings may be and still be read as the SAME
 *  movement seen twice. Only used to suppress a mirror row, never to pair —
 *  see the note in `crossScopeTransfers`. ASSUMED, like `PAIR_WINDOW_DAYS`. */
const SAME_MOVEMENT_DAYS = 14;

function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

const cents = (amount: number): number => Math.round(Math.abs(amount) * 100);

/** The stream identity of an entity pair. Case/space-insensitive on both names,
 *  exactly as `EntityProfile` is, so "bv1 " and "BV1" are one stream.
 *
 *  A RENAME ORPHANS THE ANSWER, and that is the safe direction: after renaming
 *  BV1 the key changes, no answer is found, and the stream is asked about again
 *  — rather than an answer silently following a name onto a different company.
 *  (`renameFactSubject` solves the same problem the other way for facts; here
 *  re-asking costs one question and mislabelling costs a wrong tax figure.) */
export function crossScopeStreamKey(fromEntity: string | null, toEntity: string | null): string {
  return hash(["grens", norm(fromEntity ?? ""), norm(toEntity ?? "")].join("|"));
}

/** The identity of one crossing, built from the tx ids of its legs. Tx ids are
 *  content hashes (`txId`), so this survives a re-import of the same statement
 *  and an answer given yesterday still lands on the same row. */
function crossingId(txIds: readonly string[]): string {
  return hash(["grens", ...[...txIds].sort()].join("|"));
}

/**
 * THE ANSWER, AND WHY IT IS NOT A `LearnedFact`.
 *
 * The design said "per-stream LearnedFact (source: user)". It cannot be one,
 * and someone will try again unless the reason is written down here:
 *
 *  · `agentFacts.ts` is a REDACTION BOUNDARY, not a validator — the fact store
 *    is replayed into model calls. It refuses any subject outside a closed
 *    vocabulary (only `travel` has free text, and only for public brands), and
 *    it refuses any value carrying a 4+ digit run, money notation or an IBAN.
 *    A crossing is an amount between two of HIS OWN entity names. Storing it
 *    would mean weakening `carriesPersonalData` or inventing a hashed subject —
 *    punching a hole in the boundary to store something that never needed to
 *    leave the device.
 *  · The per-agent key list is closed, so a per-crossing key cannot exist at
 *    all; the finest granularity a fact could express is the entity pair, which
 *    would label a one-off € 30.000 with the answer he gave for a € 2.000
 *    monthly.
 *
 * So the answer stays a plain vault value with the ONE rule from `upsertFacts`
 * that actually matters here: A FACT FROM HIM OUTRANKS EVERY LATER GUESS.
 *
 * Resolution order, and source beats specificity on purpose:
 *   1. any answer he gave — the crossing first, then its stream;
 *   2. any answer an agent produced — same order;
 *   3. nothing: "onbekend", with `kindSource` null.
 * So a stream he answered himself is not overridden by a later per-row
 * inference, which is the whole point of the ranking.
 */
function resolveKind(
  answers: readonly CrossScopeAnswer[],
  targets: readonly string[],
): { kind: CrossScopeKind; kindSource: FactSource | null } {
  if (answers.length === 0) return { kind: "onbekend", kindSource: null };
  for (const source of ["user", "agent"] as const) {
    for (const target of targets) {
      let best: CrossScopeAnswer | null = null;
      for (const a of answers) {
        if (a.source !== source || a.target !== target) continue;
        if (!best || (a.updatedAt ?? "") >= (best.updatedAt ?? "")) best = a;
      }
      if (best) return { kind: best.kind, kindSource: best.source };
    }
  }
  return { kind: "onbekend", kindSource: null };
}

/** Record an answer. One row per target; an agent may fill a gap and refresh
 *  another agent's answer, and may never overwrite his. Immutable, and it is
 *  `upsertFacts`'s rule with the fact machinery left out. */
export function answerCrossScope(
  existing: readonly CrossScopeAnswer[],
  incoming: readonly CrossScopeAnswer[],
): CrossScopeAnswer[] {
  const byTarget = new Map(existing.map((a) => [a.target, a]));
  for (const a of incoming) {
    if (!a.target) continue;
    const prev = byTarget.get(a.target);
    if (prev && prev.source === "user" && a.source === "agent") continue; // hij wint
    byTarget.set(a.target, a);
  }
  return [...byTarget.values()];
}

/** One leg of a candidate crossing, with everything the matcher needs computed
 *  once instead of per candidate pair. */
type Leg = {
  tx: Tx;
  entity: string;
  scope: EntityScope;
  cents: number;
  sign: 1 | -1;
  /** An identifier of ANOTHER of his own accounts printed on this row, or null.
   *  One copy of the rule: `ownAccountNamed` is the same function `categorize`
   *  uses to reach "Eigen overboeking", so this module and the category can
   *  never drift apart on what counts as his own account. */
  namedId: string | null;
  /** His own NAME on the counterparty — only ever true for a name he supplied. */
  ownName: boolean;
};

type Placed = {
  legs: Leg[];
  context: CrossScopeContext;
  state: Exclude<CrossScopeState, "gemeten"> | null;
  observed: { from: string; to: string } | null;
  own: OwnAccounts;
  /** The resolved scope of an entity, memoised — `entityScope` rebuilds its
   *  profile index on every call and this runs once per transaction. */
  scopeFor: (entity: string) => EntityScope;
  /** identifier -> the entity that owns it; null when two accounts with
   *  different entities share it (ambiguous, so it proves nothing). */
  idOwner: Map<string, string | null>;
  window: { from: string; to: string };
};

/** Shared front half of both exported functions: classify the entities, place
 *  every transaction on one, and decide whether there is anything to measure at
 *  all. Both functions must answer the empty-vault question identically — that
 *  is why it is computed once here and not twice. */
function place(input: CrossScopeInput): Placed {
  const { accounts, txs, profiles, asOf } = input;
  const from = input.from ?? `${asOf.slice(0, 4)}-01-01`;
  const window = { from, to: asOf };

  // Entities, from the SAME summary the classification screen shows, so the
  // sentence "je hebt nog geen entiteit als zakelijk gemarkeerd" is true of the
  // very list he would go and edit. A blank entity is not an entity: it would
  // otherwise land in `personal` by the hard default and make the boundary look
  // classified when it is not.
  const summaries = entitySummaries(accounts, profiles).filter((s) => s.entity.trim() !== "");
  const entities = {
    business: summaries.filter((s) => s.scope === "business").map((s) => s.entity),
    personal: summaries.filter((s) => s.scope === "personal").map((s) => s.entity),
    unclassified: summaries.filter((s) => !s.explicit).map((s) => s.entity),
  };

  const byKey = new Map(accounts.map((a) => [a.key, a]));
  const own = ownAccounts([...accounts]);

  const idOwner = new Map<string, string | null>();
  for (const a of accounts) {
    const entity = (a.entity ?? "").trim();
    for (const id of own.byKey.get(a.key) ?? []) {
      if (!idOwner.has(id)) idOwner.set(id, entity || null);
      else if (idOwner.get(id) !== entity) idOwner.set(id, null); // ambiguous: proves nothing
    }
  }

  const scopeCache = new Map<string, EntityScope>();
  const scopeFor = (entity: string): EntityScope => {
    let s = scopeCache.get(entity);
    if (s === undefined) {
      s = entityScope(entity, profiles);
      scopeCache.set(entity, s);
    }
    return s;
  };

  const unseen: CrossScopeUnseen = { noAccount: 0, noEntity: 0 };
  const legs: Leg[] = [];
  let obsFrom: string | null = null;
  let obsTo: string | null = null;

  for (const t of txs) {
    if (t.date < from || t.date > asOf) continue;
    const account = byKey.get(t.accountKey);
    if (!account) {
      unseen.noAccount++;
      continue;
    }
    const entity = (account.entity ?? "").trim();
    if (!entity) {
      unseen.noEntity++;
      continue;
    }
    if (obsFrom === null || t.date < obsFrom) obsFrom = t.date;
    if (obsTo === null || t.date > obsTo) obsTo = t.date;
    const c = cents(t.amount);
    if (c === 0) continue; // a € 0 row moved nothing across anything
    legs.push({
      tx: t,
      entity,
      scope: scopeFor(entity),
      cents: c,
      sign: t.amount < 0 ? -1 : 1,
      namedId: ownAccountNamed(t, own),
      ownName: isOwnName(t.counterparty, input.names),
    });
  }

  const context: CrossScopeContext = { window, entities, unseen };
  const observed = obsFrom !== null && obsTo !== null ? { from: obsFrom, to: obsTo } : null;

  // The order of these three is the order of the sentences on screen: an
  // unclassified vault is told about its classification, not about its dates.
  let state: Exclude<CrossScopeState, "gemeten"> | null = null;
  if (entities.business.length === 0) state = "geen-zakelijke-entiteit";
  else if (entities.personal.length === 0) state = "geen-persoonlijke-entiteit";
  else if (observed === null) state = "geen-transacties";

  return { legs, context, state, observed, own, scopeFor, idOwner, window };
}

/**
 * WHAT MOVED ACROSS THE BOUNDARY, in the window, in cents.
 *
 * PASS THE FULL LISTS. This is the one measurement in the app that deliberately
 * looks across the privé/zakelijk switch. `apps/web/src/scope.ts` states the
 * opposite doctrine for every screen — "a business obligation can never surface
 * while you are looking at your private money" — and it is right for every
 * screen. It is wrong for this: fed the scope-filtered lists, standing in
 * Persoonlijk this function sees no business account and returns nothing, and
 * standing in Zakelijk it sees no private account and returns nothing. A zero
 * with a plausible screen behind it is the worst failure this project has.
 *
 * Matching, and it is deliberately stricter than `reconcileInvoices`:
 *  (a) EXACT cents on both sides. An internal transfer is not an invoice; it
 *      arrives whole, so there is no tolerance to allow. A tolerance here would
 *      start pairing near-miss amounts.
 *  (b) the same currency on both legs (see `currencyMismatch`);
 *  (c) the inflow lands 0..PAIR_WINDOW_DAYS after the outflow — never before,
 *      because money does not arrive before it leaves;
 *  (d) one leg business, one leg personal. Two business accounts moving money
 *      between them is not a crossing.
 * Legs are consumed ONE FOR ONE (the pool pattern `ingest` uses), so two
 * genuine € 1.000 crossings on one day stay two crossings totalling € 2.000 and
 * one leg can never be claimed twice.
 *
 * Where it can still be wrong, stated rather than hidden: two unrelated rows of
 * the same magnitude, one on each side of the boundary, inside four days, WILL
 * be paired. The tie-break prefers a candidate that names the other leg's own
 * account, so a real transfer beats a coincidence whenever the bank printed the
 * IBAN — but where it printed nothing, a coincidence is indistinguishable from
 * a transfer on this data.
 */
export function crossScopeTransfers(input: CrossScopeInput): CrossScopeReport {
  const placed = place(input);
  if (placed.state !== null) return { ...placed.context, state: placed.state };
  const observed = placed.observed!;
  const answers = input.answers ?? [];
  const { legs, own, idOwner, scopeFor } = placed;

  // Inflow pools per magnitude, spliced as they are claimed.
  const pools = new Map<number, Leg[]>();
  for (const l of legs) {
    if (l.sign !== 1) continue;
    const pool = pools.get(l.cents);
    if (pool) pool.push(l);
    else pools.set(l.cents, [l]);
  }

  const outs = legs
    .filter((l) => l.sign === -1)
    .sort((a, b) =>
      a.tx.date === b.tx.date ? a.tx.id.localeCompare(b.tx.id) : a.tx.date.localeCompare(b.tx.date),
    );

  const claimed = new Set<string>();
  const crossings: CrossScopeCrossing[] = [];
  let currencyMismatch = 0;

  const legOf = (l: Leg): CrossScopeLeg => ({
    txId: l.tx.id,
    accountKey: l.tx.accountKey,
    entity: l.entity,
    scope: l.scope,
    date: l.tx.date,
    signedCents: l.sign * l.cents,
    counterparty: l.tx.counterparty,
  });

  /** Does one leg print the OTHER leg's own account on it? Not required for a
   *  match — it only decides which candidate wins when several fit. */
  const linked = (a: Leg, b: Leg): boolean => {
    const idsA = own.byKey.get(a.tx.accountKey) ?? [];
    const idsB = own.byKey.get(b.tx.accountKey) ?? [];
    return (
      (a.namedId !== null && idsB.includes(a.namedId)) ||
      (b.namedId !== null && idsA.includes(b.namedId))
    );
  };

  for (const out of outs) {
    const pool = pools.get(out.cents) ?? [];
    let best: Leg | null = null;
    let bestScore: [number, number, string] | null = null;
    let blockedByCurrency = false;
    for (const cand of pool) {
      if (claimed.has(cand.tx.id)) continue;
      if (cand.scope === out.scope) continue; // (d) one side each
      const d = dayDiff(out.tx.date, cand.tx.date); // cand.date - out.date
      if (d < 0 || d > PAIR_WINDOW_DAYS) continue; // (c)
      if (norm(cand.tx.currency) !== norm(out.tx.currency)) {
        blockedByCurrency = true;
        continue;
      } // (b)
      const score: [number, number, string] = [linked(out, cand) ? 0 : 1, d, cand.tx.id];
      if (
        bestScore === null ||
        score[0] < bestScore[0] ||
        (score[0] === bestScore[0] && score[1] < bestScore[1]) ||
        (score[0] === bestScore[0] && score[1] === bestScore[1] && score[2] < bestScore[2])
      ) {
        best = cand;
        bestScore = score;
      }
    }
    if (!best) {
      if (blockedByCurrency) currencyMismatch++;
      continue;
    }
    claimed.add(out.tx.id);
    claimed.add(best.tx.id);
    const streamKey = crossScopeStreamKey(out.entity, best.entity);
    const id = crossingId([out.tx.id, best.tx.id]);
    crossings.push({
      id,
      streamKey,
      fromEntity: out.entity,
      toEntity: best.entity,
      fromScope: out.scope,
      toScope: best.scope,
      date: out.tx.date, // the day the money left
      amountCents: out.cents, // ONE amount for TWO legs
      currency: out.tx.currency,
      matched: true,
      evidence: "twee-benen",
      legs: [legOf(out), legOf(best)],
      ...resolveKind(answers, [id, streamKey]),
    });
  }

  // ── The one-legged crossings ───────────────────────────────────────────────
  //
  // Only on evidence printed on the row itself (see `CrossScopeEvidence`), and
  // OUTFLOWS FIRST — the order is load-bearing, see the suppression rule below.
  const evidenceFor = (
    l: Leg,
  ): {
    evidence: CrossScopeEvidence;
    otherEntity: string | null;
    otherScope: EntityScope;
  } | null => {
    if (l.namedId !== null) {
      const entity = idOwner.get(l.namedId) ?? null; // null = ambiguous or blank: proves nothing
      if (entity !== null) {
        const scope = scopeFor(entity);
        if (scope !== l.scope)
          return { evidence: "eigen-rekening-genoemd", otherEntity: entity, otherScope: scope };
      }
      return null; // his own account, but on THIS side of the boundary: BV1->BV2 is not a crossing
    }
    // His own name identifies the PERSON, so the other side is personal — the
    // same reading `categorize` already takes when it calls this "Eigen
    // overboeking". WHICH personal entity is not knowable, hence null. It only
    // crosses the boundary when this leg is on the business side; his own name
    // on a private row is privé-to-privé and not a crossing.
    if (l.ownName && l.scope === "business")
      return { evidence: "eigen-naam-genoemd", otherEntity: null, otherScope: "personal" };
    return null;
  };

  /* WHAT LaVega COULD NOT SEE THROUGH, and why it is counted instead of dropped.
   *
   * A row that names an account number LaVega has never met is the ONE shape of
   * evidence-less outflow where the module knows it is blind rather than
   * satisfied. "SEPA Overboeking NL77RABO0123456789" is his own privérekening
   * if he banks at Rabobank and a supplier if he does not, and nothing on the
   * row decides which — so it is not a crossing (that rule stands, see
   * `CrossScopeEvidence`) and it is not nothing either. It is a hole with a
   * size, and `unknownCounterAccount` is that size.
   *
   * `findIban` is the ONE definition of "an account number in this text" in the
   * codebase (`accounts.ts` builds account identity with it); a second regex
   * here would drift from it. Its known over-reach — it strips all whitespace,
   * so "BTW NL123456789B01" reads as an identifier — costs a caveat one row too
   * many, which claims LESS coverage than we have. That is the safe direction
   * for this particular number and the only one it is allowed to err in. */
  const namesUnknownAccount = (l: Leg): boolean => {
    if (l.namedId !== null) return false; // it names one of HIS: not a stranger
    const found = findIban(`${l.tx.counterparty} ${l.tx.description}`);
    if (found === null) return false;
    const id = norm(found).replace(/\s+/g, "");
    // Own identifiers are stored as normalized, space-stripped strings and may
    // be a BBAN where the row prints the full IBAN (or the other way round), so
    // containment either way still means "an account that IS in the vault" —
    // including this row's OWN account, which `ownAccountNamed` skips by design.
    return !own.all.some((o) => o === id || id.includes(o) || o.includes(id));
  };

  const byDateThenId = (a: Leg, b: Leg) =>
    a.tx.date === b.tx.date ? a.tx.id.localeCompare(b.tx.id) : a.tx.date.localeCompare(b.tx.date);

  const make = (
    l: Leg,
    ev: { evidence: CrossScopeEvidence; otherEntity: string | null; otherScope: EntityScope },
  ): CrossScopeCrossing => {
    const out = l.sign === -1;
    const fromEntity = out ? l.entity : ev.otherEntity;
    const toEntity = out ? ev.otherEntity : l.entity;
    const streamKey = crossScopeStreamKey(fromEntity, toEntity);
    const id = crossingId([l.tx.id]);
    return {
      id,
      streamKey,
      fromEntity,
      toEntity,
      fromScope: out ? l.scope : ev.otherScope,
      toScope: out ? ev.otherScope : l.scope,
      date: l.tx.date,
      amountCents: l.cents,
      currency: l.tx.currency,
      matched: false,
      evidence: ev.evidence,
      legs: [legOf(l)],
      ...resolveKind(answers, [id, streamKey]),
    };
  };

  const singles: CrossScopeCrossing[] = [];
  for (const l of legs.filter((x) => x.sign === -1 && !claimed.has(x.tx.id)).sort(byDateThenId)) {
    const ev = evidenceFor(l);
    if (ev) singles.push(make(l, ev));
  }

  /* THE MIRROR SUPPRESSION, and it is the difference between a total that is
   * right and one that is quietly double.
   *
   * When BOTH accounts are imported and the pair missed the four-day window
   * (a credit card that books late, a bank that dates the two sides
   * differently), each leg can carry its own evidence — the outflow names the
   * private IBAN, the inflow names the business one — and each would become a
   * one-legged crossing. That is ONE movement of € 5.000 reported as € 10.000.
   *
   * This is NOT a second, looser pairing rule: nothing is joined, the outflow
   * row keeps `matched: false`, and no crossing claims two legs it did not
   * pair. It only refuses to count the same magnitude, in the same direction,
   * twice — one suppressor per inflow, the pool pattern again, so three genuine
   * inflows against two outflows still leave one inflow standing.
   *
   * The outflow wins because it is the leg that PROVES money left an account.
   *
   * WHAT TWO ROWS MUST SHARE BEFORE THEY MAY BE THE SAME MOVEMENT. Every clause
   * below is here because without it REAL MONEY DISAPPEARED — measured against
   * this file on 2026-08-25, before the clauses existed:
   *
   *  · THE SAME ENTITIES, ON THE SAME SIDES. An amount plus a direction is not
   *    an identity. BV1 → Privé € 5.000 out on 10 March and BV2 → Privé € 5.000
   *    in on 16 March are two transfers of two different companies; matching on
   *    scope alone collapsed them into one, so € 5.000 was reported where
   *    € 10.000 crossed, BV2 vanished from the report entirely, and the row that
   *    survived was filed under the wrong company. The same held on the other
   *    side (Privé and Partner receiving € 3.000 each). A null entity is
   *    UNKNOWN, never "any": it occurs for `eigen-naam-genoemd` only, where his
   *    own name identifies the person but not which of his personal entities.
   *    Unknown may stand for a named one — that IS the mirror of a row the
   *    other bank spelled out in full — but two DIFFERENT names never stand for
   *    each other.
   *  · THE SAME CURRENCY. Pairing rule (b) refuses two legs of equal magnitude
   *    in different currencies rather than invent a rate; a suppressor that
   *    ignores currency deletes exactly what (b) declined to join.
   *  · THE INFLOW LANDS ON OR AFTER THE OUTFLOW. Rule (c), and the same physics:
   *    money does not arrive before it leaves. The gap used to be compared with
   *    `Math.abs`, so an inflow five days BEFORE the outflow suppressed it — the
   *    module refusing to count a movement it had itself declared impossible.
   *
   * SAME_MOVEMENT_DAYS is wider than the pairing window (the legs of one
   * movement land days apart, not weeks) and far short of a month, so two
   * genuine € 5.000 movements BETWEEN THE SAME TWO ENTITIES a fortnight apart
   * are still two rows. The error this leaves is an under-count of a rare
   * mirror inside one entity pair; the error it removes is a silent doubling,
   * and a doubled total is the one a reader cannot see. */

  /** Two entity names that may be the same party. `null` is UNKNOWN and may
   *  stand for a name; two different names never stand for each other. Compared
   *  through `norm` because that is what `crossScopeStreamKey` hashes with, so
   *  "BV1 " and "bv1" are one company here and one stream on the screen. */
  const sameParty = (a: string | null, b: string | null): boolean =>
    a === null || b === null || norm(a) === norm(b);

  /** Is `inflow` the other side of `out`, seen twice because the pair missed
   *  the four-day window? Deliberately NOT a looser pairing rule: nothing is
   *  joined and no crossing gains a leg — the only effect is that the inflow is
   *  not counted a second time. */
  const isMirror = (out: CrossScopeCrossing, inflow: CrossScopeCrossing): boolean => {
    const gap = dayDiff(out.date, inflow.date); // inflow.date - out.date
    return (
      out.amountCents === inflow.amountCents &&
      norm(out.currency) === norm(inflow.currency) &&
      out.fromScope === inflow.fromScope &&
      out.toScope === inflow.toScope &&
      sameParty(out.fromEntity, inflow.fromEntity) &&
      sameParty(out.toEntity, inflow.toEntity) &&
      gap >= 0 &&
      gap <= SAME_MOVEMENT_DAYS
    );
  };

  const suppressors = singles.map((c) => ({ c, used: false }));
  let mirrorSuppressed = 0;
  for (const l of legs.filter((x) => x.sign === 1 && !claimed.has(x.tx.id)).sort(byDateThenId)) {
    const ev = evidenceFor(l);
    if (!ev) continue;
    const candidate = make(l, ev);
    const hit = suppressors.find((s) => !s.used && isMirror(s.c, candidate));
    if (hit) {
      hit.used = true;
      mirrorSuppressed++;
      continue;
    }
    singles.push(candidate);
  }
  crossings.push(...singles);

  /* The blind spot, counted. Business outflows that produced no crossing at all
   * — not paired, no own account, no own name — and that printed an account
   * number this vault does not hold. Read after the pairing and the mirror pass
   * so a leg that DID become a crossing can never also be counted as one that
   * was not. */
  let unknownCounterAccount = 0;
  for (const l of legs) {
    if (l.sign !== -1 || l.scope !== "business") continue;
    if (claimed.has(l.tx.id)) continue;
    if (evidenceFor(l) !== null) continue;
    if (namesUnknownAccount(l)) unknownCounterAccount++;
  }

  crossings.sort((a, b) =>
    a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date),
  );

  // ── Streams ────────────────────────────────────────────────────────────────
  const streams: CrossScopeStream[] = [];
  const streamIndex = new Map<string, CrossScopeStream>();
  for (const c of crossings) {
    let s = streamIndex.get(c.streamKey);
    if (!s) {
      s = {
        key: c.streamKey,
        fromEntity: c.fromEntity,
        toEntity: c.toEntity,
        fromScope: c.fromScope,
        toScope: c.toScope,
        count: 0,
        totalCents: 0,
        matchedCents: 0,
        unmatchedCents: 0,
        unknownCents: 0,
        unknownCount: 0,
        firstDate: c.date,
        lastDate: c.date,
        ...resolveKind(answers, [c.streamKey]),
      };
      streamIndex.set(c.streamKey, s);
      streams.push(s);
    }
    s.count++;
    s.totalCents += c.amountCents; // crossings, never legs
    if (c.matched) s.matchedCents += c.amountCents;
    else s.unmatchedCents += c.amountCents;
    if (c.kind === "onbekend") {
      s.unknownCents += c.amountCents;
      s.unknownCount++;
    }
    if (c.date < s.firstDate) s.firstDate = c.date;
    if (c.date > s.lastDate) s.lastDate = c.date;
  }
  streams.sort((a, b) =>
    b.totalCents === a.totalCents ? a.key.localeCompare(b.key) : b.totalCents - a.totalCents,
  );

  const totalCents = crossings.reduce((n, c) => n + c.amountCents, 0);
  const matchedCents = crossings.reduce((n, c) => (c.matched ? n + c.amountCents : n), 0);

  return {
    ...placed.context,
    state: "gemeten",
    crossings,
    streams,
    totalCents,
    matchedCents,
    unmatchedCents: totalCents - matchedCents,
    observed,
    currencyMismatch,
    mirrorSuppressed,
    unknownCounterAccount,
    ownNameKnown: (input.names?.length ?? 0) > 0,
  };
}

/* ── HET BIJPRODUCT: ZAKELIJKE KOSTEN BETAALD VAN EEN PRIVÉREKENING ─────────
 *
 * One counterparty appearing as an outflow on BOTH sides of the boundary. That
 * is all this is: a counterparty and two totals.
 *
 * WHAT IT MUST NEVER BECOME, and the design says why: it does not classify
 * deductibility, it does not name any BTW figure, and it does not mention
 * reclaimable input tax. Without an invoice there is nothing to reclaim, so a
 * conclusion drawn from a bank row alone is a claim an absence cannot carry —
 * which is exactly why Direction C was deferred behind the invoice pipeline.
 * The honest slice available today is this measurement and nothing else.
 *
 * Known noise floor, and I would rather ship it visible than invent a filter: a
 * bank, a telco or an insurer legitimately appears on both sides, so this list
 * may well open with ING rather than with anything interesting. An exclusion
 * list is how a measurement quietly becomes an opinion; it should be looked at
 * against his own data before anyone adds one.
 */
export type PrivatelyPaidCostRow = {
  /** The group key (`merchantKey`), so "SIMYO B.V. 4839201" and "SIMYO" are one
   *  merchant instead of two streams of one. */
  merchant: string;
  /** The counterparty as spelled on the most recent row — for the screen. */
  label: string;
  businessCents: number;
  businessCount: number;
  personalCents: number;
  personalCount: number;
  /** The private rows themselves, so the screen can show WHICH payments it
   *  means instead of a number he has to go and find. */
  personalTxIds: string[];
  firstDate: string;
  lastDate: string;
};

export type PrivatelyPaidCostsReport =
  | (CrossScopeContext & { state: Exclude<CrossScopeState, "gemeten"> })
  | (CrossScopeContext & { state: "gemeten"; rows: PrivatelyPaidCostRow[] });

/** Counterparties paid from both sides of the boundary, in the window.
 *
 *  Only OUTFLOWS count on both sides: an incoming payment from a party you also
 *  pay is a customer, not a cost. His own money moving is excluded by
 *  construction — a row naming one of his own accounts, a row carrying his own
 *  name, or a row he labelled "Eigen overboeking" himself — because otherwise
 *  he appears on both sides as his own supplier and the list means nothing. */
export function businessCostsPaidPrivately(input: CrossScopeInput): PrivatelyPaidCostsReport {
  const placed = place(input);
  if (placed.state !== null) return { ...placed.context, state: placed.state };

  type Acc = {
    merchant: string;
    label: string;
    labelDate: string;
    businessCents: number;
    businessCount: number;
    personalCents: number;
    personalCount: number;
    personalTxIds: string[];
    firstDate: string;
    lastDate: string;
  };
  const byMerchant = new Map<string, Acc>();

  for (const l of placed.legs) {
    if (l.sign !== -1) continue; // costs only
    if (l.namedId !== null || l.ownName) continue; // his own money moving
    if (norm(l.tx.category) === "eigen overboeking") continue;
    const merchant = merchantKey(l.tx.counterparty);
    if (!merchant) continue; // no name on the row: refuse to invent one
    let a = byMerchant.get(merchant);
    if (!a) {
      a = {
        merchant,
        label: l.tx.counterparty.trim(),
        labelDate: l.tx.date,
        businessCents: 0,
        businessCount: 0,
        personalCents: 0,
        personalCount: 0,
        personalTxIds: [],
        firstDate: l.tx.date,
        lastDate: l.tx.date,
      };
      byMerchant.set(merchant, a);
    }
    if (l.scope === "business") {
      a.businessCents += l.cents;
      a.businessCount++;
    } else {
      a.personalCents += l.cents;
      a.personalCount++;
      a.personalTxIds.push(l.tx.id);
    }
    if (l.tx.date < a.firstDate) a.firstDate = l.tx.date;
    if (l.tx.date > a.lastDate) a.lastDate = l.tx.date;
    if (l.tx.date >= a.labelDate && l.tx.counterparty.trim()) {
      a.label = l.tx.counterparty.trim();
      a.labelDate = l.tx.date;
    }
  }

  const rows = [...byMerchant.values()]
    .filter((a) => a.businessCount > 0 && a.personalCount > 0) // BOTH sides, or it is not a crossing of anything
    .map(({ labelDate: _labelDate, ...row }) => row)
    .sort((a, b) =>
      b.personalCents === a.personalCents
        ? a.merchant.localeCompare(b.merchant)
        : b.personalCents - a.personalCents,
    );

  return { ...placed.context, state: "gemeten", rows };
}

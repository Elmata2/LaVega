import { Effect, Schema } from "effect";

/** An ISO date (`2026-10-22`) or ISO date-time. */
const ISO_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

/** True for a real calendar date (and a real clock time when one is given). */
function isRealIso(s: string): boolean {
  const m = ISO_PATTERN.exec(s);
  if (m === null) return false;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return false;
  if (m[4] !== undefined && (Number(m[4]) > 23 || Number(m[5]) > 59)) return false;
  return m[6] === undefined || Number(m[6]) <= 59;
}

const IsoDate = Schema.String.check(
  Schema.makeFilter((s: string) => isRealIso(s) || "not a real ISO date", { title: "ISO date" }),
);
const Cents = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const Id = Schema.String.check(Schema.isMinLength(1));

export const FieldSource = Schema.Literals(["derived", "confirmed", "stated"]);
export type FieldSource = Schema.Schema.Type<typeof FieldSource>;

/** Every profile fact: the value plus where it came from and when. A derived
 *  fact must carry the evidence it was derived from; a confirmed or stated
 *  fact may keep it (a confirmed card still shows what it was based on). */
const derivedNeedsEvidence = Schema.makeFilter(
  (f: { source: FieldSource; evidence?: readonly string[] }) =>
    f.source !== "derived" ||
    (f.evidence !== undefined && f.evidence.length > 0) ||
    "a derived field needs non-empty evidence",
  { title: "derived needs evidence" },
);

export const Field = <S extends Schema.Constraint>(value: S) =>
  Schema.Struct({
    value,
    source: FieldSource,
    at: IsoDate,
    evidence: Schema.optionalKey(Schema.Array(Schema.String)),
    // The filter only reads `source` and `evidence`, which every instantiation
    // has; the generic `value` slot defeats structural inference.
  }).check(derivedNeedsEvidence as never);

export const AccountRef = Schema.Struct({
  kind: Schema.Literals(["bank", "broker"]),
  id: Id,
});

/** Spec 4.7. The only goal schema; the plan references it and adds no field. */
export const Goal = Schema.Struct({
  id: Id,
  purpose: Schema.String,
  kind: Schema.Literals(["general", "child"]),
  childId: Schema.optionalKey(Id),
  targetCents: Cents,
  targetDate: IsoDate,
  priority: Schema.Literals(["flexible", "important", "must"]),
  plannedMonthlyCents: Schema.optionalKey(Cents),
  startingBalanceCents: Schema.optionalKey(Cents),
  accountRefs: Schema.Array(AccountRef),
}).check(
  Schema.makeFilter(
    (g) => (g.kind === "child") === (g.childId !== undefined) || "childId is set iff kind is child",
    {
      title: "childId iff child",
    },
  ),
);
export type Goal = Schema.Schema.Type<typeof Goal>;

/** Spec 4.7 debt shape, exactly. */
export const Debt = Schema.Struct({
  id: Id,
  lender: Id,
  monthlyCents: Cents,
  balanceCents: Schema.optionalKey(Cents),
  ratePct: Schema.optionalKey(Schema.Finite),
  source: FieldSource,
  at: IsoDate,
  evidence: Schema.optionalKey(Schema.Array(Schema.String)),
}).check(derivedNeedsEvidence);
export type Debt = Schema.Schema.Type<typeof Debt>;

const Household = Schema.Struct({
  kind: Schema.Literals(["alone", "together"]),
  partnerIncomeInScope: Schema.optionalKey(Schema.Boolean),
});
const Child = Schema.Struct({ id: Id, birthYear: Schema.Int });
const IncomeStream = Schema.Struct({
  id: Id,
  label: Schema.String,
  monthlyCents: Cents,
  regular: Schema.Boolean,
});
const Housing = Schema.Struct({
  kind: Schema.Literals(["rent", "mortgage", "other"]),
  monthlyCents: Cents,
});
const FixedCost = Schema.Struct({ id: Id, label: Schema.String, monthlyCents: Cents });
const Savings = Schema.Struct({ totalCents: Cents });
const Buffer = Schema.Struct({ months: Schema.Finite });
/** `answers` (question id -> option id) and `investedBefore` are kept as given,
 *  so a half-finished block resumes; `correct` is then the count so far. */
const Knowledge = Schema.Struct({
  correct: Schema.Int,
  of: Schema.Int,
  answers: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  investedBefore: Schema.optionalKey(Schema.Boolean),
});
const CentsRange = Schema.Struct({ lowCents: Cents, highCents: Cents });
/** What the user typed when there was no data to read it from: net income and
 *  total spending per month, each as a range. Only used for the stated room. */
const StatedRanges = Schema.Struct({
  income: Schema.optionalKey(CentsRange),
  spend: Schema.optionalKey(CentsRange),
});

/** Tolerance, asked in block 3. Capacity is computed from data and never stored. */
export const Risk = Schema.Struct({
  /** Absent while fewer answers than the scale needs are given. */
  score: Schema.optionalKey(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 5 }))),
  /** Contract: item id -> chosen option id, as in `RISK_SCALE` of `scaleId`.
   *  `scoreTolerance` consumes exactly this shape, so the score can be
   *  recomputed after a scale change. Points are never stored here. */
  answers: Schema.Record(Schema.String, Schema.String),
  scaleId: Id,
  at: IsoDate,
});
export type Risk = Schema.Schema.Type<typeof Risk>;

export const Experience = Schema.Literals(["beginner", "some", "experienced"]);

export class AdvisorProfile extends Schema.Class<AdvisorProfile>("AdvisorProfile")({
  household: Schema.optionalKey(Field(Household)),
  children: Schema.optionalKey(Field(Schema.Array(Child))),
  incomeStreams: Schema.optionalKey(Schema.Array(Field(IncomeStream))),
  housing: Schema.optionalKey(Field(Housing)),
  fixedCosts: Schema.optionalKey(Schema.Array(Field(FixedCost))),
  debts: Schema.optionalKey(Schema.Array(Debt)),
  savings: Schema.optionalKey(Field(Savings)),
  goals: Schema.optionalKey(Schema.Array(Field(Goal))),
  buffer: Schema.optionalKey(Field(Buffer)),
  risk: Schema.optionalKey(Risk),
  knowledge: Schema.optionalKey(Field(Knowledge)),
  experience: Schema.optionalKey(Field(Experience)),
  worries: Schema.optionalKey(Field(Schema.String)),
  statedRanges: Schema.optionalKey(Field(StatedRanges)),
  /** Evidence fingerprints of derived facts the user removed. */
  removed: Schema.Array(Schema.String),
  intake: Schema.Struct({
    blocksDone: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 })),
    step0: Schema.NullOr(Schema.Literals(["bank", "upload", "none"])),
  }),
}) {}

export const AdvisorProfileStoreSchema = Schema.Struct({
  current: AdvisorProfile,
  versions: Schema.mutable(Schema.Array(AdvisorProfile)),
  /** ISO datetime of the last write, passed in by the caller. Merge across
   *  devices compares this, so a remove-only write (which changes no fact's
   *  `at`) still counts as newer. */
  updatedAt: IsoDate,
});
/** `versions` is newest first, at most MAX_PROFILE_VERSIONS. */
export type AdvisorProfileStore = Schema.Schema.Type<typeof AdvisorProfileStoreSchema>;

export const MAX_PROFILE_VERSIONS = 10;
export const EPOCH = "1970-01-01T00:00:00Z";

export const emptyProfile = (): AdvisorProfile =>
  new AdvisorProfile({ removed: [], intake: { blocksDone: 0, step0: null } });

export const emptyProfileStore = (at: string = EPOCH): AdvisorProfileStore => ({
  current: emptyProfile(),
  versions: [],
  updatedAt: at,
});

const sameProfile = (a: AdvisorProfile, b: AdvisorProfile): boolean =>
  a === b ||
  JSON.stringify(Schema.encodeSync(AdvisorProfile)(a)) ===
    JSON.stringify(Schema.encodeSync(AdvisorProfile)(b));

/** The new write becomes current and the previous current is pushed onto
 *  versions. A write equal to the current profile changes nothing. `at` is the
 *  write time (no clock in core). */
export function commitProfile(
  store: AdvisorProfileStore,
  next: AdvisorProfile,
  at: string,
): AdvisorProfileStore {
  if (sameProfile(store.current, next)) return store;
  return {
    current: next,
    versions: [store.current, ...store.versions].slice(0, MAX_PROFILE_VERSIONS),
    updatedAt: at,
  };
}

export const removeDerived = (profile: AdvisorProfile, fp: string): AdvisorProfile =>
  profile.removed.includes(fp)
    ? profile
    : new AdvisorProfile({ ...profile, removed: [...profile.removed, fp] });

export const isSuppressed = (profile: AdvisorProfile, fp: string): boolean =>
  profile.removed.includes(fp);

export class ProfileDecodeError extends Schema.TaggedError<ProfileDecodeError>()(
  "ProfileDecodeError",
  { message: Schema.String },
) {}

/** The vault boundary: untrusted JSON in, typed store or ProfileDecodeError out. */
export const decodeProfileStore = (
  input: unknown,
): Effect.Effect<AdvisorProfileStore, ProfileDecodeError> =>
  Schema.decodeUnknownEffect(AdvisorProfileStoreSchema)(input).pipe(
    Effect.mapError((e) => new ProfileDecodeError({ message: e.message })),
  );

/** What the vault holds for the profile. `corrupt` means a blob exists but no
 *  longer decodes; it is never reported as `absent`, so callers cannot mistake
 *  it for a fresh vault and overwrite it unknowingly. */
export type ProfileRead =
  | { kind: "absent" }
  | { kind: "corrupt" }
  | { kind: "ok"; store: AdvisorProfileStore };

/** Plain-JSON form of a store, for the vault blob. */
export const encodeProfileStore = (store: AdvisorProfileStore): unknown =>
  Schema.encodeSync(AdvisorProfileStoreSchema)(store);

const KNOWN_STORE_KEYS: ReadonlySet<string> = new Set(
  Object.keys(AdvisorProfileStoreSchema.fields),
);
const KNOWN_PROFILE_KEYS: ReadonlySet<string> = new Set(Object.keys(AdvisorProfile.fields));

const isRecord = (u: unknown): u is Record<string, unknown> =>
  typeof u === "object" && u !== null && !Array.isArray(u);

/** Decode strips keys the schema does not know, so a build that re-saves a
 *  profile written by a newer build would drop the newer sections. Before the
 *  vault overwrites its stored blob it calls this to copy the old blob's
 *  unknown keys (top level and on `current`) onto the freshly encoded one.
 *  Known keys are never copied, so a deliberately cleared section stays
 *  cleared. Unknown keys inside `versions` are not carried. */
export function carryUnknownKeys(previousRaw: unknown, encoded: unknown): unknown {
  if (!isRecord(previousRaw) || !isRecord(encoded)) return encoded;
  const out: Record<string, unknown> = { ...encoded };
  for (const [k, v] of Object.entries(previousRaw)) {
    if (!KNOWN_STORE_KEYS.has(k) && !(k in out)) out[k] = v;
  }
  const prevCurrent = previousRaw["current"];
  const nextCurrent = out["current"];
  if (isRecord(prevCurrent) && isRecord(nextCurrent)) {
    const current: Record<string, unknown> = { ...nextCurrent };
    for (const [k, v] of Object.entries(prevCurrent)) {
      if (!KNOWN_PROFILE_KEYS.has(k) && !(k in current)) current[k] = v;
    }
    out["current"] = current;
  }
  return out;
}

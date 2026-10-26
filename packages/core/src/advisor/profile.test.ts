import { Effect, Schema } from "effect";
import { expect, test } from "vitest";
import { fingerprint } from "./evidence.js";
import {
  AdvisorProfile,
  AdvisorProfileStoreSchema,
  Debt,
  Field,
  Goal,
  ProfileDecodeError,
  commitProfile,
  decodeProfileStore,
  emptyProfile,
  emptyProfileStore,
  encodeProfileStore,
  isSuppressed,
  removeDerived,
} from "./profile.js";

const withWorries = (w: string) =>
  new AdvisorProfile({
    ...emptyProfile(),
    worries: { value: w, source: "stated", at: "2026-10-22" },
  });

test("derived field without evidence is rejected; confirmed without evidence is fine", () => {
  const F = Field(Schema.String);
  const decode = Schema.decodeUnknownSync(F);
  expect(() => decode({ value: "x", source: "derived", at: "2026-10-22" })).toThrow();
  expect(() => decode({ value: "x", source: "derived", at: "2026-10-22", evidence: [] })).toThrow();
  expect(decode({ value: "x", source: "derived", at: "2026-10-22", evidence: ["t1"] }).value).toBe(
    "x",
  );
  expect(decode({ value: "x", source: "confirmed", at: "2026-10-22" }).source).toBe("confirmed");
  expect(() => decode({ value: "x", source: "stated", at: "not a date" })).toThrow();
});

test("commitProfile keeps newest as current and caps versions at 10", () => {
  let s = emptyProfileStore();
  for (let i = 0; i < 12; i++)
    s = commitProfile(s, withWorries(`w${i}`), `2026-10-22T10:00:${String(i).padStart(2, "0")}Z`);
  expect(s.current.worries?.value).toBe("w11");
  expect(s.versions).toHaveLength(10);
  expect(s.versions[0]!.worries?.value).toBe("w10");
  expect(s.versions[9]!.worries?.value).toBe("w1");
});

test("fingerprint is order-independent and differs when evidence changes", () => {
  expect(fingerprint(["a", "b", "c"])).toBe(fingerprint(["c", "a", "b"]));
  expect(fingerprint(["a", "b", "c"])).toBe(fingerprint(["a", "b", "b", "c"]));
  expect(fingerprint(["a", "b", "c"])).not.toBe(fingerprint(["a", "b", "d"]));
});

test("removed fingerprint suppresses the same evidence, not a changed one", () => {
  const p = removeDerived(emptyProfile(), fingerprint(["a", "b", "c"]));
  expect(isSuppressed(p, fingerprint(["c", "b", "a"]))).toBe(true);
  expect(isSuppressed(p, fingerprint(["a", "b", "c", "d"]))).toBe(false);
  expect(removeDerived(p, fingerprint(["a", "b", "c"])).removed).toHaveLength(1);
});

test("Schema round-trips through JSON decode (vault blob)", async () => {
  const profile = new AdvisorProfile({
    ...emptyProfile(),
    household: { value: { kind: "together" }, source: "stated", at: "2026-10-22" },
    goals: [
      {
        value: {
          id: "g1",
          purpose: "Buffer",
          kind: "general",
          targetCents: 500000,
          targetDate: "2028-01-01",
          priority: "must",
          accountRefs: [{ kind: "bank", id: "acc1" }],
        },
        source: "confirmed",
        at: "2026-10-22",
      },
    ],
    debts: [
      {
        id: "d1",
        lender: "DUO",
        monthlyCents: 8000,
        source: "derived",
        at: "2026-10-22",
        evidence: ["t1", "t2", "t3"],
      },
    ],
    risk: { score: 3, answers: { "loss-20": "do-nothing" }, scaleId: "scale-x", at: "2026-10-22" },
    experience: { value: "some", source: "stated", at: "2026-10-22" },
    intake: { blocksDone: 2, step0: "bank" },
  });
  const store = commitProfile(emptyProfileStore(), profile, "2026-10-22T10:00:00Z");
  const blob = JSON.parse(JSON.stringify(encodeProfileStore(store)));
  const back = await Effect.runPromise(decodeProfileStore(blob));
  expect(back.current).toBeInstanceOf(AdvisorProfile);
  expect(back).toEqual(store);
});

test("decodeProfileStore fails with ProfileDecodeError on junk and bad risk score", async () => {
  const err = await Effect.runPromise(Effect.flip(decodeProfileStore({ nope: 1 })));
  expect(err).toBeInstanceOf(ProfileDecodeError);
  const bad = JSON.parse(JSON.stringify(encodeProfileStore(emptyProfileStore())));
  bad.current.risk = { score: 6, answers: {}, scaleId: "s", at: "2026-10-22" };
  await expect(Effect.runPromise(decodeProfileStore(bad))).rejects.toBeTruthy();
  expect(Schema.is(AdvisorProfileStoreSchema)).toBeTypeOf("function");
});

test("Goal: childId required iff kind is child; accountRefs accepts bank and broker refs", () => {
  const base = {
    id: "g",
    purpose: "p",
    targetCents: 1,
    targetDate: "2030-01-01",
    priority: "flexible",
    accountRefs: [
      { kind: "bank", id: "a" },
      { kind: "broker", id: "b" },
    ],
  };
  const decode = Schema.decodeUnknownSync(Goal);
  expect(decode({ ...base, kind: "general" }).accountRefs).toHaveLength(2);
  expect(decode({ ...base, kind: "child", childId: "c1" }).childId).toBe("c1");
  expect(() => decode({ ...base, kind: "child" })).toThrow();
  expect(() => decode({ ...base, kind: "general", childId: "c1" })).toThrow();
  expect(() =>
    decode({ ...base, kind: "general", accountRefs: [{ kind: "cash", id: "x" }] }),
  ).toThrow();
});

test("Debt rejects a missing lender or monthlyCents", () => {
  const decode = Schema.decodeUnknownSync(Debt);
  const ok = { id: "d", lender: "DUO", monthlyCents: 100, source: "stated", at: "2026-10-22" };
  expect(decode(ok).lender).toBe("DUO");
  expect(() => decode({ ...ok, lender: undefined })).toThrow();
  expect(() => decode({ ...ok, monthlyCents: undefined })).toThrow();
  expect(() => decode({ ...ok, lender: "" })).toThrow();
});

test("Debt: derived needs non-empty evidence; stated does not; amounts are non-negative integers", () => {
  const decode = Schema.decodeUnknownSync(Debt);
  const base = { id: "d", lender: "DUO", monthlyCents: 100, at: "2026-10-22" };
  expect(() => decode({ ...base, source: "derived" })).toThrow();
  expect(() => decode({ ...base, source: "derived", evidence: [] })).toThrow();
  expect(decode({ ...base, source: "derived", evidence: ["t1"] }).evidence).toEqual(["t1"]);
  expect(decode({ ...base, source: "stated" }).source).toBe("stated");
  expect(() => decode({ ...base, source: "stated", monthlyCents: -1 })).toThrow();
  expect(() => decode({ ...base, source: "stated", monthlyCents: 1.5 })).toThrow();
  expect(() => decode({ ...base, source: "stated", balanceCents: -5 })).toThrow();
});

test("impossible dates are rejected", () => {
  const decode = Schema.decodeUnknownSync(Field(Schema.String));
  for (const at of ["2026-13-45", "2026-02-30", "2026-00-10", "2026-10-22T25:00:00Z"]) {
    expect(() => decode({ value: "x", source: "stated", at })).toThrow();
  }
  expect(decode({ value: "x", source: "stated", at: "2028-02-29" }).at).toBe("2028-02-29");
  expect(decode({ value: "x", source: "stated", at: "2026-10-22T10:00:00.123Z" }).at).toBeTruthy();
});

test("commitProfile with an equal profile returns the store unchanged", () => {
  const s = commitProfile(emptyProfileStore(), withWorries("a"), "2026-10-22T10:00:00Z");
  expect(commitProfile(s, withWorries("a"), "2026-10-22T11:00:00Z")).toBe(s);
  expect(commitProfile(s, withWorries("b"), "2026-10-22T11:00:00Z").updatedAt).toBe(
    "2026-10-22T11:00:00Z",
  );
});

test("statedRanges round-trips through the vault encoding", async () => {
  const p = new AdvisorProfile({
    ...emptyProfile(),
    statedRanges: {
      value: { income: { lowCents: 250_000, highCents: 300_000 } },
      source: "stated",
      at: "2026-10-22",
    },
  });
  const store = commitProfile(emptyProfileStore(), p, "2026-10-22T10:00:00Z");
  const back = await Effect.runPromise(decodeProfileStore(encodeProfileStore(store)));
  expect(back.current.statedRanges?.value.income?.highCents).toBe(300_000);
});

test("a partial risk section and partial knowledge answers round-trip", async () => {
  const p = new AdvisorProfile({
    ...emptyProfile(),
    risk: { answers: { sleep: "never-worry" }, scaleId: "lavega-draft-1", at: "2026-10-22" },
    knowledge: {
      value: { correct: 1, of: 3, answers: { interest: "more-than-102" }, investedBefore: false },
      source: "stated",
      at: "2026-10-22",
    },
  });
  const store = commitProfile(emptyProfileStore(), p, "2026-10-22T10:00:00Z");
  const back = await Effect.runPromise(decodeProfileStore(encodeProfileStore(store)));
  expect(back.current.risk?.score).toBeUndefined();
  expect(back.current.risk?.answers["sleep"]).toBe("never-worry");
  expect(back.current.knowledge?.value.answers?.["interest"]).toBe("more-than-102");
  expect(back.current.knowledge?.value.investedBefore).toBe(false);
});

test("decodes a stored profile without the wizard keys", async () => {
  const p = await Effect.runPromise(
    Schema.decodeUnknownEffect(AdvisorProfile)({
      removed: [],
      intake: { blocksDone: 2, step0: "none" },
    }),
  );
  expect(p.intake.lastScreen).toBeUndefined();
  expect(p.intake.noUserDebts).toBeUndefined();
});

test("round-trips lastScreen and noUserDebts", async () => {
  const intake = { blocksDone: 1, step0: "none", lastScreen: "savings", noUserDebts: true } as const;
  const p = new AdvisorProfile({ removed: [], intake });
  const store = commitProfile(emptyProfileStore(), p, "2026-10-26T10:00:00Z");
  const back = await Effect.runPromise(decodeProfileStore(encodeProfileStore(store)));
  expect(back.current.intake).toEqual(intake);
});

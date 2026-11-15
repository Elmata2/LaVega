import { Schema } from "effect";

/** A figure taken from outside LaVega (gift-tax allowance, box 3, Nibud). It
 *  may only be shown once somebody has checked it against its source. */
export const PublicFact = Schema.Struct({
  id: Schema.String,
  textKey: Schema.String,
  value: Schema.Union([Schema.String, Schema.Finite]),
  source: Schema.String,
  sourceUrl: Schema.String,
  /** ISO date of the last check against `sourceUrl`. Absent = not verified. */
  verifiedOn: Schema.optionalKey(Schema.String),
  verifiedBy: Schema.optionalKey(Schema.String),
});
export type PublicFact = Schema.Schema.Type<typeof PublicFact>;

export class PublicFactNotShowable extends Schema.TaggedError<PublicFactNotShowable>()(
  "PublicFactNotShowable",
  { factId: Schema.String, reason: Schema.String },
) {}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Throws PublicFactNotShowable unless the fact has a real `verifiedOn` date,
 *  a `verifiedBy`, and a source URL. Run it over every fact in a build check. */
export function assertShowable(fact: PublicFact): void {
  const fail = (reason: string): never => {
    throw new PublicFactNotShowable({ factId: fact.id, reason });
  };
  if (fact.verifiedOn === undefined || !ISO_DATE.test(fact.verifiedOn)) {
    fail("verifiedOn is missing or not an ISO date");
  }
  if (fact.verifiedBy === undefined || fact.verifiedBy.trim() === "") fail("verifiedBy is missing");
  if (fact.sourceUrl.trim() === "") fail("sourceUrl is missing");
}

export function isShowable(fact: PublicFact): boolean {
  try {
    assertShowable(fact);
    return true;
  } catch (e) {
    if (e instanceof PublicFactNotShowable) return false;
    throw e;
  }
}

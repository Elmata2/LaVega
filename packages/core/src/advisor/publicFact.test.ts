import { expect, test } from "vitest";
import {
  PublicFactNotShowable,
  assertShowable,
  isShowable,
  type PublicFact,
} from "./publicFact.js";

const fact: PublicFact = {
  id: "f1",
  textKey: "fact.test",
  value: 1,
  source: "Test source",
  sourceUrl: "https://example.org/x",
  verifiedOn: "2026-10-22",
  verifiedBy: "owner",
};

test("a PublicFact without verifiedOn is not showable", () => {
  const { verifiedOn: _omit, ...unverified } = fact;
  expect(() => assertShowable(unverified)).toThrow(PublicFactNotShowable);
  expect(isShowable(unverified)).toBe(false);
  expect(isShowable({ ...fact, verifiedOn: "yesterday" })).toBe(false);
  expect(isShowable({ ...fact, verifiedBy: " " })).toBe(false);
  expect(isShowable({ ...fact, sourceUrl: "" })).toBe(false);
});

test("a verified PublicFact is showable", () => {
  expect(() => assertShowable(fact)).not.toThrow();
  expect(isShowable(fact)).toBe(true);
});

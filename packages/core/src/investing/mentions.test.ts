import { expect, test } from "vitest";
import { findMentions } from "./mentions.js";

const agents = [
  { id: "warren_buffett", displayName: "Warren Buffett" },
  { id: "charlie_munger", displayName: "Charlie Munger" },
  { id: "ben_graham", displayName: "Ben Graham" },
  { id: "peter_lynch", displayName: "Peter Lynch" },
  { id: "bill_ackman", displayName: "Bill Ackman" },
];

test("a tag matches full, first or last name in any case", () => {
  expect(findMentions("@Warren Buffett thoughts?", agents).map((a) => a.id)).toEqual([
    "warren_buffett",
  ]);
  expect(findMentions("@warren thoughts?", agents).map((a) => a.id)).toEqual(["warren_buffett"]);
  expect(findMentions("@MUNGER thoughts?", agents).map((a) => a.id)).toEqual(["charlie_munger"]);
  expect(findMentions("@Ben   Graham thoughts?", agents).map((a) => a.id)).toEqual(["ben_graham"]);
});

test("tags keep their order and appear once", () => {
  expect(findMentions("@Lynch then @ackman, and @peter again", agents).map((a) => a.id)).toEqual([
    "peter_lynch",
    "bill_ackman",
  ]);
});

test("a tag needs a whole name at the start of the text or after whitespace", () => {
  expect(findMentions("write a@buffett.com", agents)).toEqual([]);
  expect(findMentions("@warrenton", agents)).toEqual([]);
  expect(findMentions("@nobody and @", agents)).toEqual([]);
  expect(findMentions("ask (@Munger)", agents)).toEqual([]);
  expect(findMentions("hi\n@Munger", agents).map((a) => a.id)).toEqual(["charlie_munger"]);
});

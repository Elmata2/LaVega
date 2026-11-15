import type { UIMessage } from "ai";
import { expect, test } from "vitest";
import { attributeHistory, findMentions } from "./agentMentions.js";

test("a tag matches full, first or last name in any case", () => {
  expect(findMentions("@Warren Buffett thoughts?")).toEqual(["warren_buffett"]);
  expect(findMentions("@warren thoughts?")).toEqual(["warren_buffett"]);
  expect(findMentions("@MUNGER thoughts?")).toEqual(["charlie_munger"]);
  expect(findMentions("@Ben   Graham thoughts?")).toEqual(["ben_graham"]);
  expect(findMentions("@Stanley Druckenmiller")).toEqual(["stanley_druckenmiller"]);
});

test("tags keep their order and appear once", () => {
  expect(findMentions("@Lynch then @ackman, and @peter again")).toEqual([
    "peter_lynch",
    "bill_ackman",
  ]);
});

test("a tag needs a whole name at the start of the text or after whitespace", () => {
  expect(findMentions("write a@buffett.com")).toEqual([]);
  expect(findMentions("@warrenton")).toEqual([]);
  expect(findMentions("@nobody and @")).toEqual([]);
  expect(findMentions("ask (@Munger)")).toEqual([]);
  expect(findMentions("hi\n@Munger")).toEqual(["charlie_munger"]);
});

const user = (text: string): UIMessage => ({
  id: text,
  role: "user",
  parts: [{ type: "text", text }],
});
const assistant = (text: string, agentId?: string): UIMessage => ({
  id: text,
  role: "assistant",
  ...(agentId ? { metadata: { agentId } } : {}),
  parts: [{ type: "text", text }],
});

test("a thread with no guest is returned untouched", () => {
  const messages = [user("hi"), assistant("hello"), assistant("again", "charlie_munger")];
  expect(attributeHistory(messages, "charlie_munger", "charlie_munger")).toBe(messages);
});

test("a guest turn labels every assistant reply, defaulting to the host", () => {
  const messages = [user("hi"), assistant("hello"), assistant("my view", "warren_buffett")];
  const labelled = attributeHistory(messages, "warren_buffett", "charlie_munger");
  expect(labelled.map((message) => message.parts[0])).toEqual([
    { type: "text", text: "hi" },
    { type: "text", text: "[Charlie Munger]: hello" },
    { type: "text", text: "[Warren Buffett]: my view" },
  ]);
});

test("an earlier guest reply labels the thread even when the host answers", () => {
  const messages = [assistant("my view", "warren_buffett"), user("and you?")];
  expect(attributeHistory(messages, "charlie_munger", "charlie_munger")[0]?.parts[0]).toEqual({
    type: "text",
    text: "[Warren Buffett]: my view",
  });
});

test("metadata that names no agent is read as the host", () => {
  const labelled = attributeHistory([assistant("x", "nobody")], "ben_graham", "charlie_munger");
  expect(labelled[0]?.parts[0]).toEqual({ type: "text", text: "[Charlie Munger]: x" });
});

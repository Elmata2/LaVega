// @vitest-environment jsdom
import { beforeEach, expect, test } from "vitest";
import { getAiAssistantEnabled, setAiAssistantEnabled } from "./settings";

beforeEach(() => localStorage.clear());

test("never set means off: nothing is sent until the owner accepts", () => {
  expect(getAiAssistantEnabled("u1")).toBe(false);
});

test("accepting persists per account, under lavega.aiAssistant.<id>", () => {
  setAiAssistantEnabled("u1", true);
  expect(localStorage.getItem("lavega.aiAssistant.u1")).toBe("1");
  expect(getAiAssistantEnabled("u1")).toBe(true);
  setAiAssistantEnabled("u1", false);
  expect(localStorage.getItem("lavega.aiAssistant.u1")).toBe("0");
  expect(getAiAssistantEnabled("u1")).toBe(false);
});

test("A8: a second account on the same browser is asked itself; switching one off leaves the other alone", () => {
  setAiAssistantEnabled("u1", true);
  expect(getAiAssistantEnabled("u2")).toBe(false);
  setAiAssistantEnabled("u2", true);
  setAiAssistantEnabled("u1", false);
  expect(getAiAssistantEnabled("u1")).toBe(false);
  expect(getAiAssistantEnabled("u2")).toBe(true);
});

test("the old browser-wide key is not honoured", () => {
  localStorage.setItem("lavega.aiAssistant", "1");
  expect(getAiAssistantEnabled("u1")).toBe(false);
});

test("an account id that is empty is never opted in", () => {
  setAiAssistantEnabled("", true);
  expect(getAiAssistantEnabled("")).toBe(false);
});

test("storage that throws reads as off", () => {
  const original = Storage.prototype.getItem;
  Storage.prototype.getItem = () => {
    throw new Error("blocked");
  };
  try {
    expect(getAiAssistantEnabled("u1")).toBe(false);
  } finally {
    Storage.prototype.getItem = original;
  }
});

// @vitest-environment jsdom
import { beforeEach, expect, test } from "vitest";
import {
  getShareNetWorthEnabled,
  getShareNetWorthPendingDelete,
  setShareNetWorthEnabled,
  setShareNetWorthPendingDelete,
} from "./settings";

beforeEach(() => localStorage.clear());

test("never set means off — no total leaves the browser until the owner opts in", () => {
  expect(localStorage.getItem("lavega.shareNetWorth")).toBeNull();
  expect(getShareNetWorthEnabled()).toBe(false);
});

test("turning it on and off round-trips", () => {
  setShareNetWorthEnabled(true);
  expect(getShareNetWorthEnabled()).toBe(true);
  setShareNetWorthEnabled(false);
  expect(getShareNetWorthEnabled()).toBe(false);
});

test("garbage in storage counts as off, not on", () => {
  localStorage.setItem("lavega.shareNetWorth", "yes");
  expect(getShareNetWorthEnabled()).toBe(false);
});

test("pending delete is never set means false, round-trips true and back to false", () => {
  expect(getShareNetWorthPendingDelete()).toBe(false);
  setShareNetWorthPendingDelete(true);
  expect(getShareNetWorthPendingDelete()).toBe(true);
  setShareNetWorthPendingDelete(false);
  expect(getShareNetWorthPendingDelete()).toBe(false);
  expect(localStorage.getItem("lavega.shareNetWorthPendingDelete")).toBeNull();
});

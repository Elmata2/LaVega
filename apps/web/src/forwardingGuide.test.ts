// @vitest-environment jsdom
import { DateTime } from "effect";
import { afterEach, beforeEach, expect, test } from "vitest";
import {
  GMAIL_FILTER_QUERY,
  TEST_WINDOW_MS,
  applySignals,
  applySetupFetch,
  currentConfirmation,
  retryCodeWait,
  dismissUnreadable,
  guideStage,
  TEST_POLL_MS,
  RULE_WORDS,
  emptyGuideState,
  isPollingActive,
  loadGuideState,
  newTestCode,
  saveGuideState,
  startTest,
  testStatus,
  testSubject,
  toggleTick,
} from "./forwardingGuide";

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

test("the Gmail filter search is the spec's, verbatim", () => {
  expect(GMAIL_FILTER_QUERY).toBe(
    "has:attachment filename:pdf (factuur OR invoice OR rekening OR nota OR receipt)",
  );
});

test("a test subject starts with the core classifier's prefix and carries a filter word", () => {
  expect(testSubject("k3x9", "nl")).toBe("LaVega test k3x9 factuur");
  expect(testSubject("k3x9", "en")).toBe("LaVega test k3x9 invoice");
});

test("newTestCode is four characters from an unambiguous alphabet", () => {
  for (let i = 0; i < 50; i++) expect(newTestCode()).toMatch(/^[a-km-z2-9]{4}$/);
  expect(newTestCode(() => new Uint8Array(4))).toBe("aaaa");
  expect(newTestCode(() => Uint8Array.of(31, 32, 63, 255))).toBe("9a99");
});

test("a confirmation code is remembered, and the latest one wins", () => {
  let s = emptyGuideState();
  s = applySignals(s, [{ kind: "forwarding-confirmation", code: "111" }], 1000);
  s = applySignals(s, [{ kind: "forwarding-confirmation", code: "222" }], 2000);
  expect(s.confirmation).toEqual({ code: "222", receivedAtMs: 2000, seenAtMs: 2000 });
});

test("a test passes with the same code", () => {
  let s = startTest(emptyGuideState(), "k3x9", 0);
  expect(testStatus(s, 1000)).toBe("pending");
  s = applySignals(s, [{ kind: "setup-test", code: "k3x9" }], 5000);
  expect(testStatus(s, 6000)).toBe("passed");
  expect(s.passedAtMs).toBe(5000);
});

test("a test with another code counts as received but says so", () => {
  let s = startTest(emptyGuideState(), "k3x9", 0);
  s = applySignals(s, [{ kind: "setup-test", code: "zzzz" }], 5000);
  expect(testStatus(s, 6000)).toBe("passed-other-code");
  expect(s.passedAtMs).toBe(5000);
});

test("a stray test mail with no test started proves nothing (anyone who knows the address can send one)", () => {
  const s = applySignals(emptyGuideState(), [{ kind: "setup-test", code: "k3x9" }], 7000);
  expect(s.passedAtMs).toBeNull();
  expect(testStatus(s, 8000)).toBe("none");
});

test("without a result the test times out after ten minutes, and polling stops", () => {
  const s = startTest(emptyGuideState(), "k3x9", 0);
  expect(isPollingActive(s, TEST_WINDOW_MS)).toBe(true);
  expect(testStatus(s, TEST_WINDOW_MS + 1)).toBe("timed-out");
  expect(isPollingActive(s, TEST_WINDOW_MS + 1)).toBe(false);
});

test("a result that arrives after the window, or after a reload, still counts", () => {
  let s = startTest(emptyGuideState(), "k3x9", 0);
  s = applySignals(s, [{ kind: "setup-test", code: "k3x9" }], TEST_WINDOW_MS * 5);
  expect(testStatus(s, TEST_WINDOW_MS * 6)).toBe("passed");
});

test("ticking Gmail step 1 starts waiting for the code; the code ends the wait", () => {
  let s = toggleTick(emptyGuideState(), "gmail:1", 100);
  expect(s.ticks).toContain("gmail:1");
  expect(isPollingActive(s, 200)).toBe(true);
  s = applySignals(s, [{ kind: "forwarding-confirmation", code: "9" }], 300);
  expect(isPollingActive(s, 400)).toBe(false);
  s = toggleTick(s, "gmail:1", 500);
  expect(s.ticks).not.toContain("gmail:1");
});

test("the code wait also ends after ten minutes", () => {
  const s = toggleTick(emptyGuideState(), "gmail:1", 0);
  expect(isPollingActive(s, TEST_WINDOW_MS + 1)).toBe(false);
});

test("state survives a save and a load", () => {
  const s = startTest(emptyGuideState(), "k3x9", 123);
  saveGuideState(s);
  expect(loadGuideState()).toEqual(s);
});

test("garbage in localStorage loads as the empty state and does not throw", () => {
  for (const junk of ["not json", "{}", '{"tab":"fax"}', "null", '{"test":{"code":1}}']) {
    localStorage.setItem("lavega.forwardingGuide.v1", junk);
    expect(loadGuideState(), junk).toEqual(emptyGuideState());
  }
});

test("a blocked localStorage does not throw on load or save", () => {
  const original = Storage.prototype.getItem;
  const originalSet = Storage.prototype.setItem;
  Storage.prototype.getItem = () => {
    throw new Error("blocked");
  };
  Storage.prototype.setItem = () => {
    throw new Error("blocked");
  };
  try {
    expect(loadGuideState()).toEqual(emptyGuideState());
    expect(() => saveGuideState(emptyGuideState())).not.toThrow();
  } finally {
    Storage.prototype.getItem = original;
    Storage.prototype.setItem = originalSet;
  }
});

test("the exact ten-minute boundary is still pending; one millisecond later it times out", () => {
  const s = startTest(emptyGuideState(), "k3x9", 1000);
  expect(testStatus(s, 1000 + TEST_WINDOW_MS - 1)).toBe("pending");
  expect(testStatus(s, 1000 + TEST_WINDOW_MS)).toBe("pending");
  expect(isPollingActive(s, 1000 + TEST_WINDOW_MS)).toBe(true);
  expect(testStatus(s, 1000 + TEST_WINDOW_MS + 1)).toBe("timed-out");
});

test("constants carry the brief's exact values", () => {
  expect(TEST_POLL_MS).toBe(20_000);
  expect(TEST_WINDOW_MS).toBe(600_000);
  expect(RULE_WORDS).toBe("factuur, invoice, rekening, nota, receipt");
});

test("a confirmation's header time is kept for display; junk falls back to the fetch time", () => {
  const iso = "2026-10-21T12:02:00Z";
  const ms = DateTime.toEpochMillis(DateTime.makeUnsafe(iso));
  const t = ms + 60_000;
  const a = applySignals(
    emptyGuideState(),
    [{ kind: "forwarding-confirmation", code: "1", receivedAt: iso }],
    t,
  );
  expect(a.confirmation).toEqual({ code: "1", receivedAtMs: ms, seenAtMs: t });
  for (const junk of ["", "garbage", "2026-13-45T99:99", " ", "2999-01-01T00:00:00Z"]) {
    const b = applySignals(
      emptyGuideState(),
      [{ kind: "forwarding-confirmation", code: "1", receivedAt: junk }],
      t,
    );
    expect(b.confirmation?.seenAtMs, junk).toBe(t);
    expect(b.confirmation?.receivedAtMs, junk).toBeLessThanOrEqual(t);
  }
});

test("a test's passedAtMs is the fetch time even if the header says otherwise", () => {
  const s = applySignals(
    startTest(emptyGuideState(), "k3x9", 0),
    [{ kind: "setup-test", code: "k3x9", receivedAt: "2000-01-01T00:00:00Z" }],
    5000,
  );
  expect(s.passedAtMs).toBe(5000);
});

test("a skewed-early header code still ends the wait and is shown", () => {
  let s = toggleTick(emptyGuideState(), "gmail:1", 100_000);
  s = applySignals(
    s,
    [{ kind: "forwarding-confirmation", code: "42", receivedAt: "2000-01-01T00:00:00Z" }],
    130_000,
  );
  expect(isPollingActive(s, 140_000)).toBe(false);
  expect(guideStage(s, 140_000, true)).toBe("code-shown");
  expect(currentConfirmation(s, 140_000)?.code).toBe("42");
});

test("a stale persisted code is not current after a new wait starts, or with no wait", () => {
  let s = toggleTick(emptyGuideState(), "gmail:1", 0);
  s = applySignals(s, [{ kind: "forwarding-confirmation", code: "old" }], 1000);
  saveGuideState(s);
  const reloaded = loadGuideState();
  expect(currentConfirmation(reloaded, 2000)?.code).toBe("old");
  const untick = toggleTick(reloaded, "gmail:1", 3000);
  expect(currentConfirmation(untick, 3000)).toBeNull();
  const again = toggleTick(untick, "gmail:1", 4000);
  expect(currentConfirmation(again, 4000)).toBeNull();
  expect(guideStage(again, 4000, true)).toBe("waiting-for-code");
  expect(isPollingActive(again, 4000)).toBe(true);
  const fresh = applySignals(again, [{ kind: "forwarding-confirmation", code: "new" }], 5000);
  expect(currentConfirmation(fresh, 5000)?.code).toBe("new");
});

test("the code wait times out at exactly ten minutes, and retry restarts it", () => {
  let s = toggleTick(emptyGuideState(), "gmail:1", 1000);
  expect(guideStage(s, 1000 + TEST_WINDOW_MS, true)).toBe("waiting-for-code");
  expect(isPollingActive(s, 1000 + TEST_WINDOW_MS)).toBe(true);
  const late = 1000 + TEST_WINDOW_MS + 1;
  expect(guideStage(s, late, true)).toBe("code-wait-timed-out");
  expect(isPollingActive(s, late)).toBe(false);
  s = retryCodeWait(s, late);
  expect(guideStage(s, late, true)).toBe("waiting-for-code");
  expect(isPollingActive(s, late)).toBe(true);
  expect(guideStage(s, late + TEST_WINDOW_MS + 1, true)).toBe("code-wait-timed-out");
});

test("duplicate entries change nothing the second time", () => {
  const sig = { kind: "setup-test", code: "k3x9" } as const;
  let s = startTest(emptyGuideState(), "k3x9", 0);
  s = applySignals(s, [sig, sig], 5000);
  const again = applySignals(s, [sig], 9000);
  expect(testStatus(again, 9500)).toBe("passed");
  expect(again.test?.receivedAtMs).toBe(5000);
  const c = { kind: "forwarding-confirmation", code: "7" } as const;
  expect(applySignals(emptyGuideState(), [c, c], 1).confirmation).toEqual({
    code: "7",
    receivedAtMs: 1,
    seenAtMs: 1,
  });
});

test("when the matching code and an older code arrive together, the match wins", () => {
  let s = startTest(emptyGuideState(), "k3x9", 0);
  s = applySignals(
    s,
    [
      { kind: "setup-test", code: "zzzz" },
      { kind: "setup-test", code: "k3x9" },
    ],
    5000,
  );
  expect(testStatus(s, 6000)).toBe("passed");
});

test("a matching test after an other-code one upgrades the result", () => {
  let s = startTest(emptyGuideState(), "k3x9", 0);
  s = applySignals(s, [{ kind: "setup-test", code: "zzzz" }], 5000);
  s = applySignals(s, [{ kind: "setup-test", code: "k3x9" }], 6000);
  expect(testStatus(s, 7000)).toBe("passed");
});

test("unreadable setup mails are surfaced until dismissed, and not persisted", () => {
  let s = applySetupFetch(emptyGuideState(), { setup: [], setupDropped: 2 }, 100);
  expect(s.setupUnreadable).toBe(2);
  s = applySetupFetch(s, { setup: [], setupDropped: 1 }, 200);
  expect(s.setupUnreadable).toBe(3);
  s = applySetupFetch(s, { setup: [], setupDropped: 0 }, 300);
  expect(s.setupUnreadable).toBe(3);
  saveGuideState(s);
  expect(loadGuideState().setupUnreadable).toBe(0);
  expect(dismissUnreadable(s).setupUnreadable).toBe(0);
});

test("applySetupFetch also applies the signals", () => {
  const s = applySetupFetch(
    emptyGuideState(),
    { setup: [{ kind: "forwarding-confirmation", code: "55" }], setupDropped: 0 },
    10,
  );
  expect(s.confirmation).toEqual({ code: "55", receivedAtMs: 10, seenAtMs: 10 });
});

test("the six guide stages", () => {
  const none = emptyGuideState();
  expect(guideStage(none, 0, false)).toBe("no-address");
  expect(guideStage(none, 0, true)).toBe("address-ready");
  const waiting = toggleTick(none, "gmail:1", 0);
  expect(guideStage(waiting, 1, true)).toBe("waiting-for-code");
  const shown = applySignals(waiting, [{ kind: "forwarding-confirmation", code: "9" }], 2);
  expect(guideStage(shown, 3, true)).toBe("code-shown");
  const pending = startTest(shown, "k3x9", 4);
  expect(guideStage(pending, 5, true)).toBe("test-pending");
  expect(guideStage(pending, 4 + TEST_WINDOW_MS + 1, true)).toBe("test-timed-out");
  const passed = applySignals(pending, [{ kind: "setup-test", code: "k3x9" }], 6);
  expect(guideStage(passed, 7, true)).toBe("test-passed");
  expect(guideStage(passed, 7, false)).toBe("no-address");
});

test("a pending test with no confirmation yet is still polling, and a stray test marks passed", () => {
  const s = startTest(emptyGuideState(), "k3x9", 0);
  expect(isPollingActive(s, 20_000)).toBe(true);
});

test("a passed test is remembered across a reload", () => {
  let s = startTest(emptyGuideState(), "k3x9", 0);
  s = applySignals(s, [{ kind: "setup-test", code: "k3x9" }], 5000);
  saveGuideState(s);
  expect(loadGuideState().passedAtMs).toBe(5000);
});

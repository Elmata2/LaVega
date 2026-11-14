// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forgetPopupMemory,
  isSnoozed,
  markShownThisSession,
  nextPopup,
  readDismissed,
  wasShownThisSession,
  writeDismissed,
} from "./popups";

const base = {
  view: "overview",
  inviteKind: null,
  unconnectedCount: 0,
  dismissed: {},
  shownThisSession: false,
  blocked: false,
  now: "2026-11-13T10:00:00Z",
} as const;

beforeEach(() => {
  forgetPopupMemory();
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe("nextPopup", () => {
  it("is null outside the overview", () => {
    expect(nextPopup({ ...base, view: "forecast", inviteKind: "intake" })).toBeNull();
  });
  it("is null when blocked", () => {
    expect(nextPopup({ ...base, inviteKind: "intake", blocked: true })).toBeNull();
  });
  it("is null when one was shown this session", () => {
    expect(nextPopup({ ...base, inviteKind: "intake", shownThisSession: true })).toBeNull();
  });
  it("intake wins over connect", () => {
    expect(nextPopup({ ...base, inviteKind: "round2", unconnectedCount: 2 })).toBe("intake:round2");
  });
  it("connect shows for unconnected accounts", () => {
    expect(nextPopup({ ...base, unconnectedCount: 1 })).toBe("connect");
  });
  it("is null with nothing to show", () => {
    expect(nextPopup(base)).toBeNull();
  });
  it("snoozes a dismissed popup for 7 days", () => {
    const dismissed = { "intake:intake": "2026-11-10T10:00:00Z" };
    const input = { ...base, inviteKind: "intake", unconnectedCount: 1, dismissed } as const;
    expect(nextPopup(input)).toBe("connect");
    expect(nextPopup({ ...input, unconnectedCount: 0 })).toBeNull();
    expect(nextPopup({ ...input, now: "2026-11-17T10:00:01Z" })).toBe("intake:intake");
  });
  it("a dismissed intake does not silence new-questions", () => {
    const dismissed = { "intake:intake": "2026-11-12T10:00:00Z" };
    expect(nextPopup({ ...base, inviteKind: "new-questions", dismissed })).toBe(
      "intake:new-questions",
    );
  });
});

describe("isSnoozed", () => {
  it("is false when never dismissed", () => {
    expect(isSnoozed(undefined, base.now)).toBe(false);
  });
  it("is false for an unparsable timestamp", () => {
    expect(isSnoozed("not a date", base.now)).toBe(false);
  });
  it("is true inside the window", () => {
    expect(isSnoozed("2026-11-12T10:00:00Z", base.now)).toBe(true);
  });
});

describe("storage", () => {
  it("readDismissed gives {} when getItem throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readDismissed()).toEqual({});
  });
  it("readDismissed gives {} when the value is not an object", () => {
    window.localStorage.setItem("lavega.popups", "[1,2]");
    expect(readDismissed()).toEqual({});
    window.localStorage.setItem("lavega.popups", "7");
    expect(readDismissed()).toEqual({});
    window.localStorage.setItem("lavega.popups", "{oops");
    expect(readDismissed()).toEqual({});
  });
  it("round-trips a dismissal", () => {
    writeDismissed("connect", "2026-11-13T10:00:00Z");
    expect(readDismissed()).toEqual({ connect: "2026-11-13T10:00:00Z" });
  });
  it("writeDismissed does not throw when setItem throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => writeDismissed("connect", base.now)).not.toThrow();
  });
  it("shown-this-session survives blocked sessionStorage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(wasShownThisSession()).toBe(false);
    markShownThisSession();
    expect(wasShownThisSession()).toBe(true);
  });
});

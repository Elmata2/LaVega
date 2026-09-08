import { expect, test } from "vitest";
import {
  APP_BASE,
  isAppPathname,
  normalizeAppLocation,
  pathForView,
  takePendingEbParams,
  viewFromPathname,
} from "./appRoutes";

test("overview is /app; other views get a segment", () => {
  expect(pathForView("overview")).toBe("/app");
  expect(pathForView("transactions")).toBe("/app/transactions");
  expect(pathForView("profiel")).toBe("/app/profiel");
});

test("pathname resolves back to the view", () => {
  expect(viewFromPathname("/app")).toBe("overview");
  expect(viewFromPathname("/app/")).toBe("overview");
  expect(viewFromPathname("/app/overview")).toBe("overview");
  expect(viewFromPathname("/app/transactions")).toBe("transactions");
  expect(viewFromPathname("/app/facturen")).toBe("facturen");
  expect(viewFromPathname("/")).toBeNull();
  expect(viewFromPathname("/privacy")).toBeNull();
  expect(viewFromPathname("/app/unknown")).toBeNull();
});

test("isAppPathname covers /app and unknown /app segments", () => {
  expect(isAppPathname("/app")).toBe(true);
  expect(isAppPathname("/app/transactions")).toBe(true);
  expect(isAppPathname("/app/nope")).toBe(true);
  expect(isAppPathname("/")).toBe(false);
  expect(isAppPathname(APP_BASE)).toBe(true);
});

test("normalizeAppLocation rewrites legacy #app into /app", () => {
  const writes: string[] = [];
  normalizeAppLocation({ pathname: "/", search: "", hash: "#app" }, (url) => writes.push(url));
  expect(writes).toEqual(["/app"]);
});

test("normalizeAppLocation strips eb= off the URL immediately and hands it off in-memory", () => {
  const writes: string[] = [];
  normalizeAppLocation({ pathname: "/", search: "?eb=sess-1", hash: "" }, (url) =>
    writes.push(url),
  );
  expect(writes).toEqual(["/app"]);
  expect(writes.join("")).not.toContain("eb");
  expect(takePendingEbParams()).toEqual({ session: "sess-1", error: null });
});

test("normalizeAppLocation strips eb= even when already on /app, keeping unrelated params", () => {
  const writes: string[] = [];
  normalizeAppLocation({ pathname: "/app", search: "?eb=sess-1&foo=bar", hash: "" }, (url) =>
    writes.push(url),
  );
  expect(writes).toEqual(["/app?foo=bar"]);
  expect(takePendingEbParams()).toEqual({ session: "sess-1", error: null });
});

test("normalizeAppLocation strips eb_error= the same way", () => {
  const writes: string[] = [];
  normalizeAppLocation({ pathname: "/", search: "?eb_error=denied", hash: "" }, (url) =>
    writes.push(url),
  );
  expect(writes).toEqual(["/app"]);
  expect(takePendingEbParams()).toEqual({ session: null, error: "denied" });
});

test("takePendingEbParams is one-shot and null when nothing is pending", () => {
  expect(takePendingEbParams()).toBeNull();
  normalizeAppLocation({ pathname: "/", search: "?eb=sess-2", hash: "" }, () => {});
  expect(takePendingEbParams()).toEqual({ session: "sess-2", error: null });
  expect(takePendingEbParams()).toBeNull();
});

test("normalizeAppLocation is a no-op without #app or eb params", () => {
  const writes: string[] = [];
  normalizeAppLocation({ pathname: "/app/transactions", search: "", hash: "" }, (url) =>
    writes.push(url),
  );
  expect(writes).toEqual([]);
});

test("a legacy #app bookmark that also carries eb= is stripped in the same step", () => {
  const replaced: string[] = [];
  normalizeAppLocation({ pathname: "/", search: "?eb=sess-1", hash: "#app" }, (url) =>
    replaced.push(url),
  );
  expect(replaced).toEqual(["/app"]);
  expect(takePendingEbParams()).toEqual({ session: "sess-1", error: null });
});

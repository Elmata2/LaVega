import { expect, test } from "vitest";
import {
  APP_BASE,
  isAppPathname,
  normalizeAppLocation,
  pathForView,
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

test("normalizeAppLocation rewrites legacy #app and /?eb= into /app", () => {
  const writes: string[] = [];
  normalizeAppLocation({ pathname: "/", search: "", hash: "#app" }, (url) => writes.push(url));
  expect(writes).toEqual(["/app"]);

  writes.length = 0;
  normalizeAppLocation({ pathname: "/", search: "?eb=sess-1", hash: "" }, (url) =>
    writes.push(url),
  );
  expect(writes).toEqual(["/app?eb=sess-1"]);

  writes.length = 0;
  normalizeAppLocation({ pathname: "/app", search: "?eb=sess-1", hash: "" }, (url) =>
    writes.push(url),
  );
  expect(writes).toEqual([]);
});

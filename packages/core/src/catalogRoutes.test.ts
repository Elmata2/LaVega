import { expect, test } from "vitest";
import { ladderOrder, runLadder, type RouteAttempt } from "./catalogRoutes.js";
import { isCovered, type CatalogValue } from "./catalog.js";

const value = (route: CatalogValue["route"]): CatalogValue => ({
  value: 1.4, route, sourceUrl: "https://x", checkedAt: "2026-08-18",
  conditions: null, conditionsKnown: true,
});

test("the ladder prefers the provider's own document over anything derived", () => {
  expect(ladderOrder()).toEqual(["provider-page", "provider-pdf", "wayback", "comparison", "agent"]);
});

test("the first route that answers wins, and later ones are not run", async () => {
  let agentRan = false;
  const attempts: RouteAttempt[] = [
    { route: "provider-page", run: async () => null },
    { route: "provider-pdf", run: async () => value("provider-pdf") },
    { route: "agent", run: async () => { agentRan = true; return value("agent"); } },
  ];
  const out = await runLadder(attempts);

  expect(out.value?.route).toBe("provider-pdf");
  expect(agentRan).toBe(false); // the expensive route is not paid for unnecessarily
  expect(out.tried).toEqual(["provider-page", "provider-pdf"]);
});

test("a route that throws does not end the sweep — the next one is still tried", async () => {
  const attempts: RouteAttempt[] = [
    { route: "provider-page", run: async () => { throw new Error("connection killed"); } },
    { route: "comparison", run: async () => value("comparison") },
  ];
  const out = await runLadder(attempts);

  expect(out.value?.route).toBe("comparison");
  expect(out.tried).toEqual(["provider-page", "comparison"]);
});

test("when every route fails the reason is recorded, never a zero", async () => {
  const out = await runLadder([
    { route: "provider-page", run: async () => { throw new Error("403 Cloudflare"); } },
    { route: "wayback", run: async () => null },
  ]);

  expect(out.value).toBeNull();
  expect(out.reason).toContain("403");
  expect(out.tried).toEqual(["provider-page", "wayback"]);
});

test("a figure whose conditions were never established does not stop the ladder", async () => {
  // The provider-page rung reads a percentage out of stripped HTML and cannot
  // establish a cap, so it returns conditionsKnown: false — deliberately, and
  // Task 5 REFUSES such a figure. But provider-page sorts ABOVE provider-pdf, so
  // treating it as "an answer" stops the ladder one rung short of the tariff PDF,
  // which is the only rung that carries conditions. The product then reaches the
  // server, is refused, and counts as uncovered — with the source that would have
  // covered it never fetched.
  //
  // 96 of the 124 products in docs/catalog/state.json are readable=yes with a
  // termsUrl, so this is the default shape, not an edge case. ING escapes it today
  // only because ing.nl kills the connection and rung 1 throws (measured: curl 92,
  // still) — that is the host's behaviour, not the ladder's design.
  let pdfRan = false;
  const out = await runLadder([
    { route: "provider-page", run: async () => ({ ...value("provider-page"), conditionsKnown: false }) },
    { route: "provider-pdf", run: async () => { pdfRan = true; return value("provider-pdf"); } },
  ]);

  expect(pdfRan).toBe(true);
  expect(out.value?.route).toBe("provider-pdf");
  expect(out.value?.conditionsKnown).toBe(true);
  expect(out.tried).toEqual(["provider-page", "provider-pdf"]);
});

test("a partial figure is kept when nothing better exists, with the reason it fell short", async () => {
  // Not covered is not the same as not found. Discarding this would throw away a
  // real figure from the provider's own page; returning it as though it were an
  // answer is the Revolut mistake. So it comes back WITH the reason, and
  // isCovered() stays the thing that decides whether the server serves it.
  const partial: CatalogValue = { ...value("provider-page"), conditionsKnown: false };
  const out = await runLadder([
    { route: "provider-page", run: async () => partial },
    { route: "wayback", run: async () => null },
  ]);

  expect(out.value).toEqual(partial);
  expect(isCovered(out.value ?? undefined)).toBe(false);
  expect(out.reason).toContain("conditions not established");
  expect(out.tried).toEqual(["provider-page", "wayback"]);
});

test("attempts are tried in ladder order however the caller listed them", async () => {
  // The sweep pushes provider-pdf FIRST — Task 4 builds the pdf attempt before the
  // page attempt — so the ladder's own ordering, not the caller's array order, has
  // to decide. Verified: delete the sort in runLadder and every other test in this
  // file still passes, because they all happen to pass their attempts already in
  // ladder order. This is the only test holding the ladder's shape.
  const seen: string[] = [];
  const out = await runLadder([
    { route: "agent", run: async () => { seen.push("agent"); return value("agent"); } },
    { route: "provider-pdf", run: async () => { seen.push("provider-pdf"); return null; } },
    { route: "provider-page", run: async () => { seen.push("provider-page"); return null; } },
  ]);

  expect(seen).toEqual(["provider-page", "provider-pdf", "agent"]);
  expect(out.tried).toEqual(["provider-page", "provider-pdf", "agent"]);
  expect(out.value?.route).toBe("agent"); // the paid rung, and only after the free ones
});

test("the recorded reason names which of the four parts was missing", async () => {
  // A product that fails with a recorded reason is a correct outcome, so the reason
  // has to be true. "no source" and "conditions not established" send whoever reads
  // the sweep output to different places, and one standing in for the other is the
  // kind of report this project has been burned by.
  const cases: [Partial<CatalogValue>, string][] = [
    [{ sourceUrl: "" }, "provider-page: no source"],
    [{ checkedAt: "" }, "provider-page: no date"],
    [{ value: Number.NaN }, "provider-page: not a number"],
    [{ conditionsKnown: false }, "provider-page: conditions not established"],
  ];

  for (const [over, expected] of cases) {
    const out = await runLadder([
      { route: "provider-page", run: async () => ({ ...value("provider-page"), ...over }) },
    ]);
    expect(out.reason).toBe(expected);
    expect(isCovered(out.value ?? undefined)).toBe(false);
  }
});

import { expect, test } from "vitest";
import { ladderOrder, partialOrder, runLadder, type RouteAttempt } from "./catalogRoutes.js";
import { isCovered, type CatalogValue } from "@lavega/core";

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

test("when nothing is covered the best-EVIDENCED partial is kept, not the highest rung's", async () => {
  // Measured live on 2026-08-18 and the reason this rule is not the ladder's.
  // ABN AMRO's tariff page states 1,2% for the debit card and 2,00% for the credit
  // card and for cash withdrawal, one under the other. The provider-page regex
  // takes 2%; the model quotes "Met Betaalpas € 0,15 en 1,2% valutakoersopslag per
  // keer" under "Betalen via betaalautomaat buitenland in buitenlands geld" and
  // reports 1,2%, which is the truth. Neither is covered — the page never settles
  // the conditions — so the ladder runs out and one of the two is written to
  // docs/catalog/state.json and catalog.json. Keeping the higher RUNG wrote 2%.
  const regex: CatalogValue = { ...value("provider-page"), value: 2, conditionsKnown: false };
  const model: CatalogValue = { ...value("agent"), value: 1.2, conditionsKnown: false };
  const out = await runLadder([
    { route: "provider-page", run: async () => regex },
    { route: "agent", run: async () => model },
  ]);

  expect(out.value).toEqual(model);
  expect(isCovered(out.value ?? undefined)).toBe(false); // still refused, as it must be
  // Both shortfalls are still reported: the surviving partial does not erase the
  // fact that the free rung also produced something.
  expect(out.tried).toEqual(["provider-page", "agent"]);
  expect(out.reason).toBe("provider-page: conditions not established · agent: conditions not established");
});

test("the partial order is by evidence, and the caller can read it", () => {
  // The quote-checked rungs first (the model's reply is rejected unless the
  // sentence is in the page, the number is in that sentence, and the heading
  // stands at or before it), then the tariff-PDF parser, then the two that
  // pattern-match a percentage with nothing tying it to the product asked about.
  expect(partialOrder()).toEqual(["wayback", "agent", "provider-pdf", "provider-page", "comparison"]);
  // And it is NOT the ladder order — if these ever coincide, one of them is wrong.
  expect(partialOrder()).not.toEqual(ladderOrder());
});

test("a covered answer still beats a better-evidenced partial, and stops the ladder", async () => {
  // The evidence order governs partials ONLY. A covered figure from any rung ends
  // the ladder where it stands, which is what keeps the free rungs worth running.
  let agentRan = false;
  const out = await runLadder([
    { route: "provider-pdf", run: async () => value("provider-pdf") },
    { route: "agent", run: async () => { agentRan = true; return value("agent"); } },
  ]);

  expect(out.value?.route).toBe("provider-pdf");
  expect(agentRan).toBe(false);
});

test("the earlier rung wins when two partials sit in the same evidence group", async () => {
  // wayback and agent are both model-extracted and both quote-checked, so nothing
  // separates them on evidence; the archive sorts first because it is the rung the
  // sweep only reaches when the live page cannot be read at all.
  const archived: CatalogValue = { ...value("wayback"), value: 1.4, conditionsKnown: false };
  const live: CatalogValue = { ...value("agent"), value: 1.9, conditionsKnown: false };
  const out = await runLadder([
    { route: "agent", run: async () => live },
    { route: "wayback", run: async () => archived },
  ]);

  expect(out.value).toEqual(archived);
});

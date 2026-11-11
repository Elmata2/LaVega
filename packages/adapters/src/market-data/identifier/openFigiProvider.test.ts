import { afterEach, expect, test, vi } from "vitest";
import {
  createFailingPartnerBudget,
  createImmediatePartnerBudget,
} from "../../partnerBudget/fakes.js";
import { PartnerBudgetUnavailable } from "../../partnerBudget/PartnerBudget.js";
import { createOpenFigiIdentifierProvider } from "./openFigiProvider.js";

type Post = (url: string, body: unknown) => Promise<unknown>;
function countingPost(impl: (call: number) => Promise<unknown>) {
  let calls = 0;
  const post: Post = async (_url, _body) => {
    calls += 1;
    return impl(calls);
  };
  return { post, calls: () => calls };
}

/* Slots come at once here. How the budget spaces them is the PartnerBudget's
 * own contract; this file is about when the provider asks and what it reports. */
const instant = () => ({ now: () => 0, partnerBudget: createImmediatePartnerBudget() });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("caches successful OpenFIGI resolutions", async () => {
  const { post, calls } = countingPost(async () => [
    { data: [{ ticker: "ASML", exchCode: "AMS", name: "ASML" }] },
  ]);
  const provider = createOpenFigiIdentifierProvider({ client: { postJson: post }, ...instant() });

  await expect(provider.get({ isin: "NL0010273215" })).resolves.toMatchObject({
    match: { ticker: "ASML" },
  });
  await expect(provider.get({ isin: "nl0010273215" })).resolves.toMatchObject({
    match: { ticker: "ASML" },
  });
  expect(calls()).toBe(1);
});

test("retries rate-limited requests and does not cache the failure", async () => {
  const { post, calls } = countingPost(async (call) =>
    call === 1
      ? Promise.reject(
          Object.assign(new Error("OpenFIGI HTTP 429"), { status: 429, retryAfterMs: 1 }),
        )
      : Promise.resolve([{ data: [{ ticker: "ASML" }] }]),
  );
  const provider = createOpenFigiIdentifierProvider({ client: { postJson: post }, ...instant() });

  await expect(provider.get({ isin: "NL0010273215" })).resolves.toMatchObject({
    match: { ticker: "ASML" },
    problems: [],
  });
  expect(calls()).toBe(2);
});

test("non-retryable errors surface as problems without retry", async () => {
  const { post, calls } = countingPost(async () =>
    Promise.reject(Object.assign(new Error("OpenFIGI HTTP 404"), { status: 404 })),
  );
  const provider = createOpenFigiIdentifierProvider({ client: { postJson: post }, ...instant() });

  const result = await provider.get({ isin: "NL0000" });
  if (!result) throw new Error("openfigi provider unexpectedly returned null");
  expect(result.problems).toHaveLength(1);
  expect(calls()).toBe(1);
});

test("every attempt, retries included, takes a slot of openfigi:mapping first", async () => {
  const order: string[] = [];
  const partnerBudget = createImmediatePartnerBudget();
  const original = partnerBudget.awaitSlot;
  partnerBudget.awaitSlot = async (key, deadline) => {
    order.push("slot");
    return original(key, deadline);
  };
  const { post } = countingPost(async (call) => {
    order.push("post");
    return call < 3
      ? Promise.reject(Object.assign(new Error("OpenFIGI HTTP 503"), { status: 503 }))
      : Promise.resolve([{ data: [{ ticker: "ASML" }] }]);
  });
  const provider = createOpenFigiIdentifierProvider({
    client: { postJson: post },
    now: () => 0,
    partnerBudget,
  });

  await provider.get({ isin: "NL0010273215" });
  expect(order).toEqual(["slot", "post", "slot", "post", "slot", "post"]);
  expect(partnerBudget.calls.map((call) => call.key)).toEqual(
    Array(3 + 2).fill({ partner: "openfigi", endpoint: "mapping", scopeId: "shared" }),
  );
});

test("a rejection tells the budget when the key opens again: backoff by attempt, capped at 60 s", async () => {
  const partnerBudget = createImmediatePartnerBudget();
  const { post } = countingPost(async () =>
    Promise.reject(Object.assign(new Error("OpenFIGI HTTP 429"), { status: 429 })),
  );
  const provider = createOpenFigiIdentifierProvider({
    client: { postJson: post },
    now: () => 1_000_000,
    partnerBudget,
  });

  const result = await provider.get({ isin: "NL0010273215" });
  expect(result?.problems).toHaveLength(1);
  const rejections = partnerBudget.calls.filter((call) => call.call === "reject");
  expect(rejections.map((call) => (call as { untilMs: number }).untilMs)).toEqual([
    1_005_000, 1_010_000, 1_015_000, 1_020_000, 1_025_000,
  ]);
});

test("Retry-After in seconds replaces the backoff and is capped at 120 s", async () => {
  const partnerBudget = createImmediatePartnerBudget();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 429, headers: { "retry-after": "300" } })),
  );
  const provider = createOpenFigiIdentifierProvider({ now: () => 1_000, partnerBudget });

  await provider.get({ isin: "NL0010273215" });
  const first = partnerBudget.calls.find((call) => call.call === "reject");
  expect(first).toMatchObject({ untilMs: 1_000 + 120_000 });
});

test("Retry-After as an HTTP date is read as the instant it names", async () => {
  vi.useFakeTimers({ now: new Date("2031-01-01T00:00:00Z"), toFake: ["Date"] });
  const partnerBudget = createImmediatePartnerBudget();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("{}", {
          status: 429,
          headers: { "retry-after": "Wed, 01 Jan 2031 00:00:30 GMT" },
        }),
    ),
  );
  const provider = createOpenFigiIdentifierProvider({ now: () => 5_000, partnerBudget });

  await provider.get({ isin: "NL0010273215" });
  expect(partnerBudget.calls.find((call) => call.call === "reject")).toMatchObject({
    untilMs: 5_000 + 30_000,
  });
});

test("a budget store that is down sends no request, is not retried, and is not cached", async () => {
  const { post, calls } = countingPost(async () => [{ data: [{ ticker: "ASML" }] }]);
  const provider = createOpenFigiIdentifierProvider({
    client: { postJson: post },
    now: () => 0,
    partnerBudget: createFailingPartnerBudget(new PartnerBudgetUnavailable({ message: "down" })),
  });

  const result = await provider.get({ isin: "NL0010273215" });
  expect(calls()).toBe(0);
  expect(result?.match.ticker).toBe("");
  expect(result?.problems[0]).toContain("OpenFIGI identifier request failed");
  await provider.get({ isin: "NL0010273215" });
  expect(calls()).toBe(0); // still no request, and nothing cached as an answer
});

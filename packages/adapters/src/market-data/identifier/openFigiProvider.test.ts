import { DateTime } from "effect";
import { afterEach, expect, test, vi } from "vitest";
import {
  createFailingPartnerBudget,
  createImmediatePartnerBudget,
} from "../../partnerBudget/fakes.js";
import { PartnerBudgetUnavailable, PartnerWait } from "../../partnerBudget/PartnerBudget.js";
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

test("a budget store that is down sends no request, is not retried, is not cached, and is rethrown", async () => {
  const { post, calls } = countingPost(async () => [{ data: [{ ticker: "ASML" }] }]);
  const provider = createOpenFigiIdentifierProvider({
    client: { postJson: post },
    now: () => 0,
    partnerBudget: createFailingPartnerBudget(new PartnerBudgetUnavailable({ message: "down" })),
  });

  await expect(provider.get({ isin: "NL0010273215" })).rejects.toBeInstanceOf(
    PartnerBudgetUnavailable,
  );
  expect(calls()).toBe(0);
  await expect(provider.get({ isin: "NL0010273215" })).rejects.toBeInstanceOf(
    PartnerBudgetUnavailable,
  );
  expect(calls()).toBe(0); // still no request, and nothing cached as an answer
});

test("a slot past the deadline sends no request, rethrows the wait, and caches nothing", async () => {
  const slots: Array<number | undefined> = [];
  const partnerBudget = createImmediatePartnerBudget();
  let granted = false;
  partnerBudget.awaitSlot = async (_key, deadlineMs) => {
    slots.push(deadlineMs);
    if (!granted) throw new PartnerWait({ until: DateTime.makeUnsafe(Date.now() + 60_000) });
  };
  const { post, calls } = countingPost(async () => [
    { data: [{ ticker: "ASML", exchCode: "AMS" }] },
  ]);
  const provider = createOpenFigiIdentifierProvider({
    client: { postJson: post },
    now: () => 0,
    partnerBudget,
  });

  await expect(provider.get({ isin: "NL0010273215", deadlineMs: 123_456 })).rejects.toBeInstanceOf(
    PartnerWait,
  );
  expect(slots).toEqual([123_456]);
  expect(calls()).toBe(0);

  // Nothing was cached for the failed lookup: the next one asks again.
  granted = true;
  const retry = await provider.get({ isin: "NL0010273215" });
  expect(calls()).toBe(1);
  expect(retry?.match.ticker).toBe("ASML");
});

/* WS5 / Jev-03 (issue #136): candidate selection. The provider is the seam;
 * the selector is injected, so every test asserts what a caller observes: which
 * match comes back, whether a selector call happened, and what is cached. */

import type { IdentifierCandidateSelector, IdentifierSelection } from "../lanes.js";

const RAW_CANDIDATES = [
  { ticker: "VUAA", exchCode: "LSE", name: "Vanguard S&P 500 UCITS ETF", currency: "USD" },
  { ticker: "VUAA", exchCode: "XETRA", name: "Vanguard S&P 500 UCITS ETF", currency: "EUR" },
];
const CANDIDATES = [
  { ticker: "VUAA", exchange: "LSE", name: "Vanguard S&P 500 UCITS ETF", currency: "USD" },
  { ticker: "VUAA", exchange: "XETRA", name: "Vanguard S&P 500 UCITS ETF", currency: "EUR" },
];
const TWO_CANDIDATES = [{ data: RAW_CANDIDATES }];

function countingSelector(answer: IdentifierSelection | (() => IdentifierSelection)) {
  const calls: Array<Parameters<IdentifierCandidateSelector>[0]> = [];
  const selector: IdentifierCandidateSelector = async (input) => {
    calls.push(input);
    return typeof answer === "function" ? answer() : answer;
  };
  return { selector, calls: () => calls };
}

const withCandidates = (data: unknown[]) => countingPost(async () => [{ data }]);

test("one candidate is taken with zero selector calls and is cached", async () => {
  const { post, calls } = withCandidates([{ ticker: "ASML", exchCode: "AMS" }]);
  const fake = countingSelector({ kind: "no-match", confidence: 0.1 });
  const provider = createOpenFigiIdentifierProvider({
    client: { postJson: post },
    selector: fake.selector,
    ...instant(),
  });

  const first = await provider.get({ isin: "NL0010273215", allowModelSelection: true });
  const second = await provider.get({ isin: "NL0010273215", allowModelSelection: true });

  expect(first).toMatchObject({
    match: { ticker: "ASML", exchange: "AMS" },
    problems: [],
    resolution: { tier: "provider", confidence: null },
  });
  expect(second).toBe(first);
  expect(fake.calls()).toHaveLength(0);
  expect(calls()).toBe(1);
});

test("zero candidates keeps the existing problem and calls no selector", async () => {
  const { post, calls } = withCandidates([]);
  const fake = countingSelector({ kind: "selected", ticker: "ASML", confidence: 0.9 });
  const provider = createOpenFigiIdentifierProvider({
    client: { postJson: post },
    selector: fake.selector,
    ...instant(),
  });

  const result = (await provider.get({ isin: "NL0000", allowModelSelection: true }))!;

  expect(result.match.ticker).toBe("");
  expect(result.problems).toEqual(["OpenFIGI identifier request failed: ISIN not found"]);
  expect(result.resolution).toMatchObject({ tier: "unresolved", candidates: [] });
  expect(fake.calls()).toHaveLength(0);
  expect(calls()).toBe(1);
});

test("an ambiguous identifier goes to the selector, and the returned ticker is a candidate", async () => {
  const { post, calls } = withCandidates(RAW_CANDIDATES);
  const fake = countingSelector({
    kind: "selected",
    ticker: "VUAA",
    exchange: "XETRA",
    confidence: 0.82,
  });
  const provider = createOpenFigiIdentifierProvider({
    client: { postJson: post },
    selector: fake.selector,
    ...instant(),
  });

  const result = (await provider.get({
    isin: "IE00BFMXXD54",
    instrument: { name: "Vanguard S&P 500", currency: "EUR" },
    allowModelSelection: true,
  }))!;

  expect(result.match).toEqual({
    isin: "IE00BFMXXD54",
    ticker: "VUAA",
    exchange: "XETRA",
    name: "Vanguard S&P 500 UCITS ETF",
    currency: "EUR",
  });
  expect(result.problems).toEqual([]);
  expect(result.resolution.tier).toBe("model");
  expect(result.resolution.confidence).toBeCloseTo(0.82);
  expect(result.resolution.candidates).toEqual(CANDIDATES);
  // The selector sees the provider's own candidate set and the instrument context.
  expect(fake.calls()).toHaveLength(1);
  expect(fake.calls()[0]).toEqual({
    isin: "IE00BFMXXD54",
    instrument: { name: "Vanguard S&P 500", currency: "EUR" },
    candidates: CANDIDATES,
  });
  // Selection adds no OpenFIGI requests.
  expect(calls()).toBe(1);
});

test("a selected ticker outside the candidate set is refused, never normalised", async () => {
  const { post, calls } = withCandidates(RAW_CANDIDATES);
  const fake = countingSelector({ kind: "selected", ticker: "SPY", confidence: 0.99 });
  const provider = createOpenFigiIdentifierProvider({
    client: { postJson: post },
    selector: fake.selector,
    ...instant(),
  });

  const result = (await provider.get({ isin: "IE00BFMXXD54", allowModelSelection: true }))!;

  expect(result.match.ticker).toBe("");
  expect(result.problems).toHaveLength(1);
  expect(result.resolution.tier).toBe("unresolved");
  // Nothing was cached: the next call asks again.
  await provider.get({ isin: "IE00BFMXXD54", allowModelSelection: true });
  expect(calls()).toBe(2);
});

test("a no-match selection leaves the identifier unresolved with the existing shape", async () => {
  const { post, calls } = withCandidates(RAW_CANDIDATES);
  const fake = countingSelector({ kind: "no-match", confidence: 0.7 });
  const provider = createOpenFigiIdentifierProvider({
    client: { postJson: post },
    selector: fake.selector,
    ...instant(),
  });

  const result = (await provider.get({ isin: "IE00BFMXXD54", allowModelSelection: true }))!;

  expect(result.match).toEqual({ isin: "IE00BFMXXD54", ticker: "" });
  expect(result.problems).toEqual([
    "OpenFIGI identifier request failed: none of the candidates fits this holding",
  ]);
  expect(result.resolution).toMatchObject({ tier: "unresolved" });
  // A refusal is not cached as an answer: the next call asks the provider again.
  await provider.get({ isin: "IE00BFMXXD54", allowModelSelection: true });
  expect(calls()).toBe(2);
});

test("a selection is cached, so the same decision is not paid for twice", async () => {
  const { post, calls } = withCandidates(RAW_CANDIDATES);
  const fake = countingSelector({ kind: "selected", ticker: "VUAA", confidence: 0.8 });
  const provider = createOpenFigiIdentifierProvider({
    client: { postJson: post },
    selector: fake.selector,
    ...instant(),
  });

  await provider.get({ isin: "IE00BFMXXD54", allowModelSelection: true });
  const second = (await provider.get({ isin: "IE00BFMXXD54", allowModelSelection: true }))!;

  expect(second.match.ticker).toBe("VUAA");
  expect(fake.calls()).toHaveLength(1);
  expect(calls()).toBe(1);
});

test("without consent/enable, ambiguity keeps today's behaviour: first candidate, no model call", async () => {
  const { post } = withCandidates(TWO_CANDIDATES[0]!.data);
  const fake = countingSelector({ kind: "selected", ticker: "VUAA", confidence: 0.8 });
  const provider = createOpenFigiIdentifierProvider({
    client: { postJson: post },
    selector: fake.selector,
    ...instant(),
  });

  const result = (await provider.get({ isin: "IE00BFMXXD54" }))!;

  expect(result.match).toMatchObject({ ticker: "VUAA", exchange: "LSE" });
  expect(result.resolution).toMatchObject({ tier: "provider", confidence: null });
  expect(result.resolution.candidates).toHaveLength(2);
  expect(fake.calls()).toHaveLength(0);
});

test("an owner override outranks a stored model selection and asks nobody", async () => {
  const { post, calls } = withCandidates(RAW_CANDIDATES);
  const fake = countingSelector({
    kind: "selected",
    ticker: "VUAA",
    exchange: "LSE",
    confidence: 0.6,
  });
  const provider = createOpenFigiIdentifierProvider({
    client: { postJson: post },
    selector: fake.selector,
    ...instant(),
  });

  await provider.get({ isin: "IE00BFMXXD54", allowModelSelection: true });
  const overridden = await provider.get({
    isin: "IE00BFMXXD54",
    allowModelSelection: true,
    override: { ticker: "VUSA", exchange: "AMS" },
  });

  expect(overridden).toMatchObject({
    match: { ticker: "VUSA", exchange: "AMS" },
    problems: [],
    resolution: { tier: "owner-override", confidence: null },
  });
  // The cached model selection was not used and no new request went out.
  expect(fake.calls()).toHaveLength(1);
  expect(calls()).toBe(1);
});

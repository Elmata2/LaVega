import { DateTime } from "effect";
import { afterEach, expect, test, vi } from "vitest";
import {
  createFailingPartnerBudget,
  createImmediatePartnerBudget,
} from "../../partnerBudget/fakes.js";
import { PartnerBudgetUnavailable, PartnerWait } from "../../partnerBudget/PartnerBudget.js";
import { firstProviderResult } from "../providerRouter.js";
import { YahooHttpClient } from "./http.js";
import { createYahooPriceProvider } from "./priceProvider.js";

/* How the Yahoo client uses the PartnerBudget: one shared key, a slot before
 * every outbound request, and rejections that hold everyone back. */

const NOW = Date.parse("2031-01-01T00:00:00Z");
const KEY = { partner: "yahoo", endpoint: "any", scopeId: "shared" };

afterEach(() => {
  vi.useRealTimers();
});

type Step = "cookie" | "crumb" | "data";
function yahooFetch(script: (step: Step, call: number) => Response) {
  const log: Array<{ step: Step; url: string }> = [];
  const calls = { data: 0 };
  const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const step: Step =
      url === "https://fc.yahoo.com/" ? "cookie" : url.includes("getcrumb") ? "crumb" : "data";
    if (step === "data") calls.data += 1;
    log.push({ step, url });
    return script(step, calls.data);
  });
  return { fetchFn, log };
}
const ok = (step: Step) =>
  step === "cookie"
    ? new Response("", { headers: { "set-cookie": "A=B; Path=/" } })
    : step === "crumb"
      ? new Response("crumb-value")
      : new Response(JSON.stringify({ ok: true }));

test("a crumb request takes three slots: cookie, crumb, then the data request", async () => {
  const budget = createImmediatePartnerBudget();
  const { fetchFn, log } = yahooFetch(ok);
  await new YahooHttpClient(fetchFn, 20_000, 1, { partnerBudget: budget }).fetchJsonWithCrumb(
    "https://query1.finance.yahoo.com/v8/finance/chart/AAPL",
  );
  expect(log.map((entry) => entry.step)).toEqual(["cookie", "crumb", "data"]);
  expect(budget.calls.map((call) => call.call)).toEqual(["awaitSlot", "awaitSlot", "awaitSlot"]);
  expect(budget.calls.every((call) => JSON.stringify(call.key) === JSON.stringify(KEY))).toBe(true);
});

test("each slot is taken before its request, retries included", async () => {
  const order: string[] = [];
  const budget = createImmediatePartnerBudget();
  const slot = budget.awaitSlot;
  budget.awaitSlot = async (key, deadline) => {
    order.push("slot");
    return slot(key, deadline);
  };
  const { fetchFn } = yahooFetch((step, call) => {
    order.push(`fetch:${step}`);
    return step === "data" && call === 1 ? new Response("busy", { status: 503 }) : ok(step);
  });
  await new YahooHttpClient(fetchFn, 20_000, 1, { partnerBudget: budget }).fetchJson(
    "https://query1.finance.yahoo.com/v1/finance/search?q=x",
  );
  expect(order).toEqual(["slot", "fetch:data", "slot", "fetch:data"]);
});

test("a 429 tells the budget until the loop's own backoff, then retries", async () => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const budget = createImmediatePartnerBudget();
  const { fetchFn } = yahooFetch((step, call) =>
    step === "data" && call <= 2 ? new Response("Too Many Requests", { status: 429 }) : ok(step),
  );
  await new YahooHttpClient(fetchFn, 20_000, 1_500, { partnerBudget: budget }).fetchJson(
    "https://query1.finance.yahoo.com/v1/finance/search?q=x",
  );
  const rejections = budget.calls.filter((call) => call.call === "reject");
  // min(30_000, 1_500 * 2 ** attempt) for attempt 0 and 1
  expect(rejections.map((call) => (call as { untilMs: number }).untilMs)).toEqual([
    NOW + 1_500,
    NOW + 3_000,
  ]);
});

test("the backoff is capped at 30 s as before", async () => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const budget = createImmediatePartnerBudget();
  const { fetchFn } = yahooFetch((step, call) =>
    step === "data" && call <= 3 ? new Response("no", { status: 429 }) : ok(step),
  );
  await new YahooHttpClient(fetchFn, 20_000, 20_000, { partnerBudget: budget }).fetchJson(
    "https://query1.finance.yahoo.com/v1/finance/search?q=x",
  );
  const untils = budget.calls
    .filter((call) => call.call === "reject")
    .map((call) => (call as { untilMs: number }).untilMs - NOW);
  expect(untils).toEqual([20_000, 30_000, 30_000]);
});

test("Retry-After, in seconds or as a date, replaces the backoff and is capped at 120 s", async () => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const headers = ["45", "Thu, 01 Jan 2031 00:01:10 GMT", "900"];
  const budget = createImmediatePartnerBudget();
  let data = 0;
  const { fetchFn } = yahooFetch((step) => {
    if (step !== "data") return ok(step);
    data += 1;
    return data <= 3
      ? new Response("slow down", { status: 429, headers: { "retry-after": headers[data - 1]! } })
      : ok(step);
  });
  await new YahooHttpClient(fetchFn, 20_000, 1, { partnerBudget: budget }).fetchJson(
    "https://query1.finance.yahoo.com/v1/finance/search?q=x",
  );
  const untils = budget.calls
    .filter((call) => call.call === "reject")
    .map((call) => (call as { untilMs: number }).untilMs - NOW);
  expect(untils).toEqual([45_000, 70_000, 120_000]);
});

test("a 403 is reported to the budget like a 429", async () => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const budget = createImmediatePartnerBudget();
  const { fetchFn } = yahooFetch((step, call) =>
    step === "data" && call === 1 ? new Response("Forbidden", { status: 403 }) : ok(step),
  );
  await new YahooHttpClient(fetchFn, 20_000, 1_500, { partnerBudget: budget }).fetchJson(
    "https://query1.finance.yahoo.com/v1/finance/search?q=x",
  );
  expect(budget.calls).toContainEqual({ call: "reject", key: KEY, untilMs: NOW + 1_500 });
});

test("a 401 clears the crumb, is reported to the budget, and the retry negotiates a new crumb", async () => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const budget = createImmediatePartnerBudget();
  const { fetchFn, log } = yahooFetch((step, call) =>
    step === "data" && call === 1 ? new Response("Unauthorized", { status: 401 }) : ok(step),
  );
  await new YahooHttpClient(fetchFn, 20_000, 1_500, { partnerBudget: budget }).fetchJsonWithCrumb(
    "https://query1.finance.yahoo.com/v10/finance/quoteSummary/AAPL",
  );
  expect(log.map((entry) => entry.step)).toEqual([
    "cookie",
    "crumb",
    "data",
    "cookie",
    "crumb",
    "data",
  ]);
  expect(budget.calls.filter((call) => call.call === "awaitSlot")).toHaveLength(6);
  expect(budget.calls).toContainEqual({ call: "reject", key: KEY, untilMs: NOW + 1_500 });
});

test("a failed crumb answer of 429 is reported to the budget too", async () => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  const budget = createImmediatePartnerBudget();
  let crumbs = 0;
  const { fetchFn } = yahooFetch((step) => {
    if (step === "crumb") {
      crumbs += 1;
      return crumbs === 1 ? new Response("", { status: 429 }) : ok(step);
    }
    return ok(step);
  });
  await new YahooHttpClient(fetchFn, 20_000, 1_500, { partnerBudget: budget }).fetchJsonWithCrumb(
    "https://query1.finance.yahoo.com/v10/finance/quoteSummary/AAPL",
  );
  expect(budget.calls).toContainEqual({ call: "reject", key: KEY, untilMs: NOW + 1_500 });
});

test("a server error backs off locally and does not hold the shared key", async () => {
  const budget = createImmediatePartnerBudget();
  const { fetchFn } = yahooFetch((step, call) =>
    step === "data" && call === 1 ? new Response("bad gateway", { status: 502 }) : ok(step),
  );
  await new YahooHttpClient(fetchFn, 20_000, 1, { partnerBudget: budget }).fetchJson(
    "https://query1.finance.yahoo.com/v1/finance/search?q=x",
  );
  expect(budget.calls.filter((call) => call.call === "reject")).toEqual([]);
});

test("a slot after the deadline sends no request and is not retried", async () => {
  const wait = new PartnerWait({ until: DateTime.makeUnsafe(NOW + 5_000) });
  const { fetchFn } = yahooFetch(ok);
  const budget = createFailingPartnerBudget(wait);
  const reserve = vi.spyOn(budget, "awaitSlot");
  const client = new YahooHttpClient(fetchFn, 20_000, 1, { partnerBudget: budget });
  await expect(client.fetchJson("https://query1.finance.yahoo.com/v1/x")).rejects.toBe(wait);
  expect(fetchFn).not.toHaveBeenCalled();
  expect(reserve).toHaveBeenCalledTimes(1);
});

test("a budget store that is down sends no request and is not retried", async () => {
  const down = new PartnerBudgetUnavailable({ message: "down" });
  const { fetchFn } = yahooFetch(ok);
  const budget = createFailingPartnerBudget(down);
  const reserve = vi.spyOn(budget, "awaitSlot");
  const client = new YahooHttpClient(fetchFn, 20_000, 1, { partnerBudget: budget });
  await expect(client.fetchJsonWithCrumb("https://query1.finance.yahoo.com/v1/x")).rejects.toBe(
    down,
  );
  expect(fetchFn).not.toHaveBeenCalled();
  expect(reserve).toHaveBeenCalledTimes(1);
});

test("a deadline view hands its deadline to every slot and shares the crumb", async () => {
  const budget = createImmediatePartnerBudget();
  const { fetchFn, log } = yahooFetch(ok);
  const client = new YahooHttpClient(fetchFn, 20_000, 1, { partnerBudget: budget });
  await client.fetchJsonWithCrumb("https://query1.finance.yahoo.com/v1/a");
  await client.withDeadline(NOW).fetchJsonWithCrumb("https://query1.finance.yahoo.com/v1/b");
  expect(log.map((entry) => entry.step)).toEqual(["cookie", "crumb", "data", "data"]);
  expect(budget.calls.map((call) => (call as { deadlineMs?: number }).deadlineMs)).toEqual([
    undefined,
    undefined,
    undefined,
    NOW,
  ]);
});

test("the price provider lets a slot past the deadline through instead of calling it a price problem", async () => {
  const wait = new PartnerWait({ until: DateTime.makeUnsafe(NOW + 5_000) });
  const { fetchFn } = yahooFetch(ok);
  const client = new YahooHttpClient(fetchFn, 20_000, 1, {
    partnerBudget: createFailingPartnerBudget(wait),
  });
  const provider = createYahooPriceProvider({ client });
  await expect(
    provider.get({
      ticker: "AAPL_US_EQ",
      exchange: "",
      symbol: "AAPL_US_EQ",
      currency: "USD",
      listing: "AAPL",
    }),
  ).rejects.toBe(wait);
  expect(fetchFn).not.toHaveBeenCalled();
});

test("the router does not turn a slot past the deadline into a failed provider", async () => {
  const wait = new PartnerWait({ until: DateTime.makeUnsafe(NOW + 5_000) });
  await expect(
    firstProviderResult([{ sourceKey: "yahoo", priority: 1, get: () => Promise.reject(wait) }], {}),
  ).rejects.toBe(wait);
});

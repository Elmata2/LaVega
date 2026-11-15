import { expect, test, vi } from "vitest";
import {
  PartnerBudget,
  PartnerWait,
  createPartnerBudgetClient,
} from "../../partnerBudget/PartnerBudget.js";
import { cookieHeaderFromSetCookie } from "./setCookie.js";
import { YahooHttpClient } from "./http.js";
import { createImmediatePartnerBudget } from "../../partnerBudget/fakes.js";

test("gets cookie and crumb, then appends crumb to protected requests", async () => {
  const urls: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url === "https://fc.yahoo.com/")
      return new Response("", { headers: { "set-cookie": "A=B; Path=/" } });
    if (url.includes("getcrumb")) return new Response("crumb-value");
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  await new YahooHttpClient(fetchFn, 20_000, 1, {
    partnerBudget: createImmediatePartnerBudget(),
  }).fetchJsonWithCrumb<{ ok: boolean }>("https://query1.finance.yahoo.com/test");
  expect(urls.at(-1)).toContain("crumb=crumb-value");
});

test("keeps Yahoo cookies whose Expires date contains a comma", async () => {
  let crumbCookie: string | undefined;
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://fc.yahoo.com/") {
      const headers = new Headers();
      headers.append(
        "set-cookie",
        "A3=d=AQ; Expires=Wed, 18 Aug 2027 22:00:00 GMT; Path=/; HttpOnly",
      );
      headers.append("set-cookie", "A1=foo; Path=/");
      return new Response("", { headers });
    }
    if (url.includes("getcrumb")) {
      crumbCookie = new Headers(init?.headers).get("cookie") ?? undefined;
      return new Response("crumb-value");
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  await new YahooHttpClient(fetchFn, 20_000, 1, {
    partnerBudget: createImmediatePartnerBudget(),
  }).fetchJsonWithCrumb<{ ok: boolean }>("https://query1.finance.yahoo.com/test");
  expect(crumbCookie).toBe("A3=d=AQ; A1=foo");
});

test("does not split combined Set-Cookie on the Expires comma", () => {
  const headers = {
    getSetCookie: () => [] as string[],
    get: (name: string) =>
      name === "set-cookie"
        ? "A3=d=AQ; Expires=Wed, 18 Aug 2027 22:00:00 GMT; Path=/; HttpOnly, A1=foo; Path=/"
        : null,
  } as unknown as Headers;
  expect(cookieHeaderFromSetCookie(headers)).toBe("A3=d=AQ; A1=foo");
});

test("two views share one crumb negotiation: the short deadline fails alone, the long one succeeds", async () => {
  vi.useFakeTimers({ now: 1_000_000 });
  try {
    const urls: string[] = [];
    const fetchFn = (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url === "https://fc.yahoo.com/")
        return new Response("", { headers: { "set-cookie": "A=B; Path=/" } });
      if (url.includes("getcrumb")) {
        await new Promise((resolve) => setTimeout(resolve, 5_000)); // a slow crumb answer
        return new Response("crumb-value");
      }
      return new Response(JSON.stringify({ ok: true }));
    }) as typeof fetch;
    const client = new YahooHttpClient(fetchFn, 20_000, 1, {
      partnerBudget: createPartnerBudgetClient(PartnerBudget.memoryLayer),
    });
    const now = Date.now();
    let shortSettledAt = Infinity;
    // The short view starts the negotiation, the long one joins it.
    const short = client
      .withDeadline(now + 2_000)
      .fetchJsonWithCrumb<{ ok: boolean }>("https://query1.finance.yahoo.com/a")
      .catch((error: unknown) => {
        shortSettledAt = Date.now();
        return error;
      });
    const long = client
      .withDeadline(now + 60_000)
      .fetchJsonWithCrumb<{ ok: boolean }>("https://query1.finance.yahoo.com/b");
    await vi.advanceTimersByTimeAsync(30_000);

    expect(await short).toBeInstanceOf(PartnerWait);
    // It gives up at its own deadline, not when the negotiation ends.
    expect(shortSettledAt).toBeLessThanOrEqual(now + 2_000);
    expect(await long).toEqual({ ok: true });
    expect(urls.filter((url) => url.includes("getcrumb"))).toHaveLength(1);
    expect(urls.filter((url) => url === "https://fc.yahoo.com/")).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});

import { expect, test } from "vitest";
import { cookieHeaderFromSetCookie } from "./setCookie.js";
import { YahooHttpClient } from "./http.js";

test("gets cookie and crumb, then appends crumb to protected requests", async () => {
  const urls: string[] = [];
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = String(input); urls.push(url);
    if (url === "https://fc.yahoo.com/") return new Response("", { headers: { "set-cookie": "A=B; Path=/" } });
    if (url.includes("getcrumb")) return new Response("crumb-value");
    return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  await new YahooHttpClient(fetchFn).fetchJsonWithCrumb<{ ok: boolean }>("https://query1.finance.yahoo.com/test");
  expect(urls.at(-1)).toContain("crumb=crumb-value");
});

test("keeps Yahoo cookies whose Expires date contains a comma", async () => {
  let crumbCookie: string | undefined;
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://fc.yahoo.com/") {
      const headers = new Headers();
      headers.append("set-cookie", "A3=d=AQ; Expires=Wed, 18 Aug 2027 22:00:00 GMT; Path=/; HttpOnly");
      headers.append("set-cookie", "A1=foo; Path=/");
      return new Response("", { headers });
    }
    if (url.includes("getcrumb")) {
      crumbCookie = new Headers(init?.headers).get("cookie") ?? undefined;
      return new Response("crumb-value");
    }
    return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  await new YahooHttpClient(fetchFn).fetchJsonWithCrumb<{ ok: boolean }>("https://query1.finance.yahoo.com/test");
  expect(crumbCookie).toBe("A3=d=AQ; A1=foo");
});

test("does not split combined Set-Cookie on the Expires comma", () => {
  const headers = {
    getSetCookie: () => [] as string[],
    get: (name: string) => name === "set-cookie"
      ? "A3=d=AQ; Expires=Wed, 18 Aug 2027 22:00:00 GMT; Path=/; HttpOnly, A1=foo; Path=/"
      : null,
  } as unknown as Headers;
  expect(cookieHeaderFromSetCookie(headers)).toBe("A3=d=AQ; A1=foo");
});

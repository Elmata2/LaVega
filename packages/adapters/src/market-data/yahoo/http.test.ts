import { expect, test } from "vitest";
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

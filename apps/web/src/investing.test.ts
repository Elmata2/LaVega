import { expect, test, vi } from "vitest";
import { investingReachable, resolveInvestingUrl } from "./investing";

/* The investing app is a separate deploy. Until this round the link to it was a
 * hardcoded `http://127.0.0.1:8790` — the port of a docker container that
 * exists on one developer machine and nowhere else, so on lavega.dev the
 * "Investing" tab opened a browser error page. Two rules come out of that:
 * the URL is configuration, and the link is only shown when something actually
 * answers at it. A dead link is worse than no link. */

test("with nothing configured, dev points at the local container and production at the same origin", () => {
  expect(resolveInvestingUrl({ DEV: true })).toBe("http://127.0.0.1:8790");
  // Same-origin path: the day the server serves the investing app under
  // /investing the link appears by itself, and until then the probe below
  // keeps it hidden. No rebuild, no baked-in URL.
  expect(resolveInvestingUrl({ DEV: false })).toBe("/investing");
});

test("a configured URL wins, without its trailing slash", () => {
  expect(resolveInvestingUrl({ VITE_INVESTING_URL: "https://investing.lavega.dev/", DEV: false })).toBe(
    "https://investing.lavega.dev",
  );
  expect(resolveInvestingUrl({ VITE_INVESTING_URL: "  /beleggen  ", DEV: true })).toBe("/beleggen");
});

test("configuring it blank switches the link off entirely", () => {
  expect(resolveInvestingUrl({ VITE_INVESTING_URL: "", DEV: true })).toBeNull();
  expect(resolveInvestingUrl({ VITE_INVESTING_URL: "   ", DEV: false })).toBeNull();
});

test("no URL means no probe and no link", async () => {
  const fetchImpl = vi.fn();
  expect(await investingReachable(null, fetchImpl as unknown as typeof fetch)).toBe(false);
  expect(fetchImpl).not.toHaveBeenCalled();
});

test("same origin is verified properly: only the investing server's own health answer counts", async () => {
  const health = (body: unknown, init: ResponseInit = {}) =>
    (async () => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, ...init })) as unknown as typeof fetch;

  expect(await investingReachable("/investing", health({ ok: true, service: "investing-server" }))).toBe(true);

  // The SPA's catch-all answers 200 with index.html for any unknown path. That
  // is exactly the false positive we cannot afford, so the body must say ok.
  const spaFallback = (async () =>
    new Response("<!doctype html><title>LaVega</title>", { headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
  expect(await investingReachable("/investing", spaFallback)).toBe(false);

  expect(await investingReachable("/investing", health({ ok: false }, { status: 503 }))).toBe(false);
  expect(await investingReachable("/investing", health({ ok: false }))).toBe(false);
});

test("same origin asks the investing server's health route", async () => {
  const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
    new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } }));
  await investingReachable("/investing", fetchImpl as unknown as typeof fetch);
  expect(fetchImpl.mock.calls[0]?.[0]).toBe("/investing/health");
});

test("a cross-origin URL can only be reached, not read — and reaching it is enough", async () => {
  // No CORS headers on the investing server, so the response is opaque: the
  // status is unreadable. What IS readable is the difference between "a server
  // answered" and "connection refused", which is the whole question here.
  const calls: RequestInit[] = [];
  const answered = (async (_url: unknown, init: RequestInit = {}) => {
    calls.push(init);
    return Response.error();
  }) as unknown as typeof fetch;
  expect(await investingReachable("http://127.0.0.1:8790", answered)).toBe(true);
  expect(calls[0]?.mode).toBe("no-cors");

  const refused = (async () => {
    throw new TypeError("Failed to fetch");
  }) as unknown as typeof fetch;
  expect(await investingReachable("http://127.0.0.1:8790", refused)).toBe(false);
});

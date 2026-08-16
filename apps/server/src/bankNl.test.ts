import { expect, test, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { fetchBankNl, getBankNlTable, resetBankNl, BANK_NL_SNAPSHOT } from "./bankNl.js";

/* The real page, saved verbatim on 2026-08-16 (HTTP 200, 96 kB, browser UA).
 * No test here touches the network — `fetchImpl` is injected everywhere. */
const PAGE = readFileSync(
  fileURLToPath(new URL("../../../packages/core/src/__fixtures__/bank-nl-betalen-in-buitenland-2026-08-16.html", import.meta.url)),
  "utf8",
);

type Call = { url: string; headers: Record<string, string> };

/** A fetch stub that records what was asked for. */
function stub(body: string, status = 200): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
    return new Response(body, { status });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

beforeEach(() => resetBankNl());

test("the live page is fetched with a real browser User-Agent", async () => {
  // Not decoration: the UA is what decides access on these sites. ABN AMRO's
  // own page times out without one and returns 200 with one.
  const { fetchImpl, calls } = stub(PAGE);
  await fetchBankNl({ fetchImpl });
  expect(calls).toHaveLength(1);
  expect(calls[0].url).toBe("https://www.bank.nl/kennisbank/betalen-in-buitenland/");
  expect(calls[0].headers["User-Agent"]).toMatch(/^Mozilla\/5\.0 .*Chrome/);
});

test("the live page parses into the seven banks it actually prices", async () => {
  const { fetchImpl } = stub(PAGE);
  const table = (await fetchBankNl({ fetchImpl }))!;
  expect(table.checkedAt).toBe("2026-01-15");
  expect([...new Set(table.rows.map((r) => r.bank))]).toEqual([
    "ABN AMRO", "ING", "Rabobank", "ASN Bank", "Triodos Bank", "Knab", "Bunq",
  ]);
  // Including the two that refuse us directly: ING 403s/hangs, Rabobank 403s.
  expect(table.rows.find((r) => r.bank === "ING" && r.card === "betaalpas")!.fxFeePct).toBe(1.4);
  expect(table.rows.find((r) => r.bank === "Rabobank" && r.card === "creditcard")!.fxFeePct).toBe(2);
});

test("a non-200 answer yields null instead of an exception", async () => {
  const { fetchImpl } = stub("<html>Forbidden</html>", 403);
  expect(await fetchBankNl({ fetchImpl })).toBeNull();
});

test("a network failure yields null instead of taking the caller down", async () => {
  const failing = (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch;
  expect(await fetchBankNl({ fetchImpl: failing })).toBeNull();
});

test("a page that parses to almost nothing is treated as broken, not as the truth", async () => {
  // Serving two rows would quietly shrink the comparison instead of falling
  // back to a snapshot that is whole.
  const thin =
    '<h2>Testbank</h2><figure class="wp-block-table"><table>' +
    "<thead><tr><th></th><th>Met betaalpas</th></tr></thead>" +
    "<tbody><tr><td>Betalen in vreemde valuta</td><td>1,4% koersopslag</td></tr></tbody>" +
    "</table></figure>";
  const { fetchImpl } = stub(thin);
  expect(await fetchBankNl({ fetchImpl })).toBeNull();
});

test("a good fetch is cached, so a second ask does not hit the site again", async () => {
  const { fetchImpl, calls } = stub(PAGE);
  await getBankNlTable({ fetchImpl });
  await getBankNlTable({ fetchImpl });
  expect(calls).toHaveLength(1);
});

test("when the fetch fails the last good table is served, not the snapshot", async () => {
  const good = stub(PAGE);
  await getBankNlTable({ fetchImpl: good.fetchImpl });

  // Age the cache past its TTL so the next ask re-fetches, and let that fail.
  const realNow = Date.now;
  Date.now = () => realNow() + 8 * 24 * 60 * 60 * 1000;
  try {
    const failing = (async () => { throw new Error("down"); }) as unknown as typeof fetch;
    const table = await getBankNlTable({ fetchImpl: failing });
    // Stale but real, and richer than the snapshot (it carries the page's own
    // footnotes) — the same ladder rates.ts uses.
    expect(table.rows).toHaveLength(12);
    expect(table.rows.find((r) => r.bank === "ABN AMRO")!.note).toContain("Mastercard-koers");
  } finally {
    Date.now = realNow;
  }
});

test("with no cache and no network the bundled snapshot is served", async () => {
  const failing = (async () => { throw new Error("down"); }) as unknown as typeof fetch;
  expect(await getBankNlTable({ fetchImpl: failing })).toBe(BANK_NL_SNAPSHOT);
});

test("the bundled snapshot matches what the real page says", async () => {
  const { fetchImpl } = stub(PAGE);
  const live = (await fetchBankNl({ fetchImpl }))!;
  const key = (r: { bank: string; card: string; fxFeePct: number }) => `${r.bank}|${r.card}|${r.fxFeePct}`;
  // A snapshot that disagrees with the source is worse than no snapshot: it is
  // a wrong figure with a confident face on it.
  expect(BANK_NL_SNAPSHOT.rows.map(key)).toEqual(live.rows.map(key));
  expect(BANK_NL_SNAPSHOT.checkedAt).toBe(live.checkedAt);
});

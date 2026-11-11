/* One-off live verification for issue #88, and the sort-order check issue #304
 * depends on: unlock the local vault, hit the real Trading 212 API, capture
 * sanitized response shapes, then run the adapter and compare its parsed output
 * against what we saw raw.
 *
 * Usage: bun scripts/t212-verify.ts [--write-fixture] [--sort-order]
 * Requires LAVEGA_VAULT_PASSPHRASE in env (or .env) and T212 credentials stored.
 *
 * `--sort-order` reads only the first two pages of each history endpoint and
 * reports whether page 1 is newest-first. A tail read may only be enabled for
 * a stream whose order is proven; fewer than 51 rows cannot prove it. */
import { createFileCredentialStore } from "../src/fileCredentialStore.js";
import { createTrading212Adapter } from "@lavega/adapters";

const redact = (v: unknown, depth = 0): unknown => {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v))
    return { __array: v.length, sample: v.length ? redact(v[0], depth + 1) : undefined };
  if (typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as object).map(([k, val]) => [k, redact(val, depth + 1)]),
    );
  }
  if (typeof v === "number") return `<number:${v}>`; // amounts kept: signs matter for verification
  if (typeof v === "string") return /^\d{4}-\d{2}-\d{2}/.test(v) ? v : `<str:len${v.length}>`;
  return typeof v;
};

const store = createFileCredentialStore();
if (!(await store.unlock(process.env.LAVEGA_VAULT_PASSPHRASE ?? "")))
  throw new Error("vault unlock failed");
const cred = await store.getCredentials("local", "trading212");
if (!cred) throw new Error("no Trading 212 credentials in vault");
console.log("vault unlocked; T212 credentials present");

const base = process.env.TRADING212_BASE_URL ?? "https://live.trading212.com";
const auth = "Basic " + Buffer.from(`${cred.token}:${cred.secret ?? ""}`).toString("base64");
const get = async (path: string) =>
  (await fetch(base + path, { headers: { Authorization: auth } })).json();

// 0. Sort-order check (#304). Two pages per endpoint, nothing further.
if (process.argv.includes("--sort-order")) {
  const endpoints = ["orders", "transactions", "dividends"] as const;
  const timestampOf = (kind: (typeof endpoints)[number], row: Record<string, unknown>) => {
    const nested = (row.fill ?? row.instrument ?? {}) as Record<string, unknown>;
    const value =
      kind === "orders"
        ? (nested.filledAt ?? row.filledAt)
        : kind === "dividends"
          ? row.paidOn
          : row.dateTime;
    return typeof value === "string" && Number.isFinite(Date.parse(value))
      ? Date.parse(value)
      : null;
  };
  const report: Array<Record<string, unknown>> = [];
  for (const kind of endpoints) {
    const first = await get(`/api/v0/equity/history/${kind}?limit=50`);
    const firstItems = Array.isArray(first?.items)
      ? (first.items as Record<string, unknown>[])
      : [];
    const next: string | null = typeof first?.nextPagePath === "string" ? first.nextPagePath : null;
    const second = next ? await get(next.startsWith("http") ? next : next) : null;
    const secondItems = Array.isArray(second?.items)
      ? (second.items as Record<string, unknown>[])
      : [];
    const firstTimes = firstItems
      .map((row) => timestampOf(kind, row))
      .filter((t): t is number => t !== null);
    const secondTimes = secondItems
      .map((row) => timestampOf(kind, row))
      .filter((t): t is number => t !== null);
    const pageIsDescending = firstTimes.every(
      (time, index) => index === 0 || firstTimes[index - 1]! >= time,
    );
    const crosses =
      firstTimes.length > 0 && secondTimes.length > 0
        ? Math.min(...firstTimes) >= Math.max(...secondTimes)
        : null;
    report.push({
      endpoint: kind,
      rowsOnFirstPage: firstItems.length,
      hasSecondPage: next !== null,
      pageIsDescending,
      newestFirst: crosses,
      verdict:
        firstItems.length < 51 || firstTimes.length === 0
          ? "not proven (fewer than 51 rows)"
          : crosses === true && pageIsDescending
            ? "newest first"
            : crosses === false
              ? "oldest first"
              : "not proven",
    });
  }
  console.log("SORT ORDER:", JSON.stringify(report, null, 1));
  process.exit(report.every((row) => row.verdict === "newest first") ? 0 : 1);
}

// 1. Raw shapes (sanitized)
const cash = await get("/api/v0/equity/account/cash");
console.log("RAW /account/cash:", JSON.stringify(redact(cash), null, 1));

for (const kind of ["transactions", "dividends"] as const) {
  const first = await get(`/api/v0/equity/history/${kind}?limit=50`);
  const shape = redact(first);
  console.log(`RAW /history/${kind}:`, JSON.stringify(shape, null, 1));
}

// 2. Adapter run — full sync incl. pagination
const seen: unknown[] = [];
const result = await createTrading212Adapter({
  token: cred.token,
  secret: cred.secret,
  baseUrl: base,
  diagnostics: (e) => seen.push(e),
}).sync({ lanes: ["holdings", "history"], entity: "personal" });

console.log("ADAPTER problems:", JSON.stringify(result.problems));
console.log(
  "counts:",
  JSON.stringify({
    positions: result.positions?.length,
    trades: result.trades?.length,
    dividends: result.dividends?.length,
    cashBalances: result.cashBalances?.length,
    cashFlows: result.cashFlows?.length,
  }),
);
console.log("cashBalances:", JSON.stringify(result.cashBalances));
console.log(
  "cashFlows by kind:",
  JSON.stringify(
    Object.entries(Object.groupBy(result.cashFlows ?? [], (f) => f.kind)).map(([k, v]) => ({
      kind: k,
      n: v!.length,
    })),
  ),
);
console.log("dividend sample:", JSON.stringify((result.dividends ?? []).slice(0, 3), null, 1));
console.log(
  "diagnostics summary:",
  JSON.stringify(
    Object.entries(Object.groupBy(seen as { type?: string }[], (e) => e.type ?? "?")).map(
      ([k, v]) => ({ type: k, n: v!.length }),
    ),
  ),
);

/* One-off live verification for issue #88: unlock the local vault, hit the
 * real Trading 212 API, capture sanitized response shapes, then run the
 * adapter and compare its parsed output against what we saw raw.
 *
 * Usage: bun scripts/t212-verify.ts [--write-fixture]
 * Requires LAVEGA_VAULT_PASSPHRASE in env (or .env) and T212 credentials stored. */
import { createFileCredentialStore } from "../src/fileCredentialStore.js";
import { createTrading212Adapter } from "@lavega/adapters";

const redact = (v: unknown, depth = 0): unknown => {
  if (v === null || v === undefined) return v;
  if (Array.isArray(v)) return { __array: v.length, sample: v.length ? redact(v[0], depth + 1) : undefined };
  if (typeof v === "object") {
    return Object.fromEntries(Object.entries(v as object).map(([k, val]) => [k, redact(val, depth + 1)]));
  }
  if (typeof v === "number") return `<number:${v}>`; // amounts kept: signs matter for verification
  if (typeof v === "string") return /^\d{4}-\d{2}-\d{2}/.test(v) ? v : `<str:len${v.length}>`;
  return typeof v;
};

const store = createFileCredentialStore();
if (!(await store.unlock(process.env.LAVEGA_VAULT_PASSPHRASE ?? ""))) throw new Error("vault unlock failed");
const cred = await store.getCredentials("local", "trading212");
if (!cred) throw new Error("no Trading 212 credentials in vault");
console.log("vault unlocked; T212 credentials present");

const base = process.env.TRADING212_BASE_URL ?? "https://live.trading212.com";
const auth = "Basic " + Buffer.from(`${cred.token}:${cred.secret ?? ""}`).toString("base64");
const get = async (path: string) => (await fetch(base + path, { headers: { Authorization: auth } })).json();

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
}).sync({ entity: "personal" });

console.log("ADAPTER problems:", JSON.stringify(result.problems));
console.log("counts:", JSON.stringify({
  positions: result.positions?.length,
  trades: result.trades?.length,
  dividends: result.dividends?.length,
  cashBalances: result.cashBalances?.length,
  cashFlows: result.cashFlows?.length,
}));
console.log("cashBalances:", JSON.stringify(result.cashBalances));
console.log(
  "cashFlows by kind:",
  JSON.stringify(Object.entries(Object.groupBy(result.cashFlows ?? [], (f) => f.kind)).map(([k, v]) => ({ kind: k, n: v!.length }))),
);
console.log(
  "dividend sample:",
  JSON.stringify((result.dividends ?? []).slice(0, 3), null, 1),
);
console.log(
  "diagnostics summary:",
  JSON.stringify(Object.entries(Object.groupBy(seen as { type?: string }[], (e) => e.type ?? "?")).map(([k, v]) => ({ type: k, n: v!.length }))),
);

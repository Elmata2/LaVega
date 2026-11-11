import { generateKeyPairSync } from "node:crypto";
import { afterEach, expect, test, vi } from "vitest";
import type { EbConfig } from "../config.js";
import { EnableBankingApiError } from "../eb-client.js";
import type { EbSession } from "../eb-routes.js";
import { fetchForAgent } from "./unattendedFetch.js";

const DAY = 86_400_000;
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const config = {
  configured: true,
  applicationId: "app-1",
  privateKey,
  privateKeyFile: null,
  redirectUrl: "http://localhost/cb",
  psuType: "personal",
  keySource: "env",
  keyShape: { kind: "pem", length: 10 },
} as EbConfig;

const now = Date.now();
function session(over: Partial<EbSession> = {}, createdAt = new Date(now - DAY).toISOString()) {
  return {
    sessionId: "s1",
    createdAt,
    payload: {
      aspsp: "ING",
      accounts: [{ uid: "acc-1", account_id: { iban: "NL01INGB0000000001" }, currency: "EUR" }],
      validUntil: new Date(now + 60 * DAY).toISOString(),
      ...over,
    } as EbSession,
  };
}

const bankData = (path: string) =>
  path.includes("/balances")
    ? {
        balances: [
          {
            balance_type: "CLBD",
            balance_amount: { amount: "123.45", currency: "EUR" },
            credit_debit_indicator: "CRDT",
            reference_date: "2026-11-09",
          },
        ],
      }
    : {
        transactions: [
          {
            transaction_amount: { amount: "10.00", currency: "EUR" },
            credit_debit_indicator: "DBIT",
            booking_date: "2026-11-08",
            remittance_information: ["koffie"],
          },
        ],
      };

afterEach(() => vi.unstubAllGlobals());

test("requests go 90 days back, not 365", async () => {
  const urls: string[] = [];
  const client = vi.fn(async (_c: unknown, _m: string, path: string) => {
    urls.push(path);
    return bankData(path);
  });
  const out = await fetchForAgent([session()], now, { eb: client as never, config });
  expect(out.status).toBe("ok");
  const expected = new Date(Date.now() - 90 * DAY).toISOString().slice(0, 10);
  const txUrls = urls.filter((u) => u.includes("/transactions"));
  expect(txUrls.length).toBeGreaterThan(0);
  for (const u of txUrls) expect(u).toContain(`date_from=${expected}`);
});

test("maps accounts, balances in cents and transactions with ids", async () => {
  const client = vi.fn(async (_c: unknown, _m: string, path: string) => bankData(path));
  const out = await fetchForAgent([session()], now, { eb: client as never, config });
  if (out.status !== "ok") throw new Error("expected ok");
  expect(out.balances).toEqual([{ accountKey: "NL01INGB0000000001", cents: 12345 }]);
  expect(out.accounts[0]!.bank).toBe("ING");
  expect(out.txs).toHaveLength(1);
  expect(out.txs[0]!.amount).toBe(-10);
  expect(out.txs[0]!.id).toBeTruthy();
  expect(out.consentExpiresAt).toBe(session().payload.validUntil);
  expect(out.banks).toEqual([
    { bank: "ING", state: "ok", validUntil: session().payload.validUntil },
  ]);
});

test("the real client sends no header starting with psu- (case-insensitive)", async () => {
  const seen: Array<Record<string, string>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
      seen.push(init.headers);
      return new Response(JSON.stringify(bankData(String(url))), { status: 200 });
    }),
  );
  const out = await fetchForAgent([session()], now, { config });
  expect(out.status).toBe("ok");
  expect(seen.length).toBeGreaterThan(0);
  for (const headers of seen) {
    for (const name of Object.keys(headers))
      expect(name.toLowerCase().startsWith("psu-")).toBe(false);
  }
});

function ok(out: Awaited<ReturnType<typeof fetchForAgent>>) {
  if (out.status !== "ok") throw new Error("expected ok");
  return out;
}
const states = (out: ReturnType<typeof ok>) => out.banks.map((b) => [b.bank, b.state]);
const two = () => [session({ aspsp: "ING" }), { ...session({ aspsp: "ABN" }), sessionId: "s2" }];
const reject = (status: number) =>
  new EnableBankingApiError(status, `Enable Banking ${status}: secret`);

test("a 429 is a refused entry with no data", async () => {
  const client = vi.fn(async () => {
    throw reject(429);
  });
  const out = ok(await fetchForAgent([session()], now, { eb: client as never, config }));
  expect(states(out)).toEqual([["ING", "refused"]]);
  expect(out.txs).toEqual([]);
  expect(out.consentExpiresAt).toBeNull();
});

test("a plain error is refused", async () => {
  const client = vi.fn(async () => {
    throw new Error("boom");
  });
  const out = ok(await fetchForAgent([session()], now, { eb: client as never, config }));
  expect(states(out)).toEqual([["ING", "refused"]]);
});

test("one bank ok and one 401: data from the ok bank plus an expired entry", async () => {
  const client = vi.fn(async (c: unknown, m: string, path: string) => {
    if (path.includes("acc-2")) throw reject(401);
    return bankData(path);
  });
  const s = two();
  (s[1]!.payload.accounts[0] as { uid: string }).uid = "acc-2";
  const out = ok(await fetchForAgent(s, now, { eb: client as never, config }));
  expect(states(out)).toEqual([
    ["ING", "ok"],
    ["ABN", "expired"],
  ]);
  expect(out.txs).toHaveLength(1);
  expect(out.consentExpiresAt).toBe(s[0]!.payload.validUntil);
});

test("one bank ok and one lapsed: the lapsed one is expired and never called", async () => {
  const client = vi.fn(async (_c: unknown, _m: string, path: string) => bankData(path));
  const s = two();
  s[1]!.payload.validUntil = new Date(now - DAY).toISOString();
  (s[1]!.payload.accounts[0] as { uid: string }).uid = "acc-lapsed";
  const out = ok(await fetchForAgent(s, now, { eb: client as never, config }));
  expect(states(out)).toEqual([
    ["ING", "ok"],
    ["ABN", "expired"],
  ]);
  expect(client.mock.calls.some((c) => String(c[2]).includes("acc-lapsed"))).toBe(false);
});

test("two refused banks: no data, two refused entries", async () => {
  const client = vi.fn(async () => {
    throw reject(503);
  });
  const out = ok(await fetchForAgent(two(), now, { eb: client as never, config }));
  expect(states(out)).toEqual([
    ["ING", "refused"],
    ["ABN", "refused"],
  ]);
  expect(out.txs).toEqual([]);
  expect(out.accounts).toEqual([]);
});

test("no sessions is no-bank, without calling the bank", async () => {
  const client = vi.fn();
  expect(await fetchForAgent([], now, { eb: client as never, config })).toEqual({
    status: "no-bank",
  });
  expect(client).not.toHaveBeenCalled();
});

test("a lapsed single consent is an expired entry without calling the bank", async () => {
  const client = vi.fn();
  const lapsed = session({ validUntil: new Date(now - DAY).toISOString() });
  const out = ok(await fetchForAgent([lapsed], now, { eb: client as never, config }));
  expect(states(out)).toEqual([["ING", "expired"]]);
  expect(client).not.toHaveBeenCalled();
});

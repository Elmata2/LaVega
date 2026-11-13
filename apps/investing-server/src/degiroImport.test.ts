import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, vi } from "vitest";
import {
  createInMemorySharedPriceStore,
  createMemoryBrokerSyncStateStore,
  type BrokerAccountSnapshot,
  type BrokerSyncOperationStore,
} from "@lavega/adapters";
import type { InvestingDashboardData } from "@lavega/core";
import type { RuntimeBrokerDataSnapshot } from "./runtimeBrokerData.js";
import type { RuntimeCredentialStore } from "./credentialStore.js";
import { createDeGiroImportHandler } from "./degiroImport.js";

/* The mounted tenant test builds a real runtime app, so the credential store
 * becomes one in-memory vault per tenant. Nothing here touches a database. */
const tenants = vi.hoisted(() => ({ vaults: new Map<string, RuntimeBrokerDataSnapshot>() }));

vi.mock("./credentialStore.js", () => ({
  runtimeDatabase: () => null,
  credentialsArePerTenant: () => true,
  createRuntimeCredentialStore: (tenantId: string): RuntimeCredentialStore => ({
    status: async () => "unlocked",
    setup: async () => undefined,
    unlock: async () => true,
    lock: () => undefined,
    getCredentials: async () => null,
    putCredentials: async () => undefined,
    getBrokerData: async () => structuredClone(tenants.vaults.get(tenantId) ?? {}),
    putBrokerData: async (snapshot) => {
      tenants.vaults.set(tenantId, structuredClone(snapshot));
    },
    putBrokerSnapshot: async (broker, snapshot) => {
      tenants.vaults.set(
        tenantId,
        structuredClone({ ...tenants.vaults.get(tenantId), [broker]: snapshot }),
      );
    },
  }),
}));

import { createRuntimeApp } from "./index.js";

const NOW = "2026-11-13T12:00:00.000Z";

function fixture(path: string): string {
  return readFileSync(
    new URL(`../../../packages/core/src/parsers/__fixtures__/degiro/${path}`, import.meta.url),
    "utf8",
  );
}

function upload(files: readonly File[], options: { mode?: string; asOf?: string } = {}): Request {
  const form = new FormData();
  for (const file of files) form.append("files", file);
  if (options.asOf !== undefined) form.append("asOf", options.asOf);
  return new Request(
    `http://localhost/api/investing/brokers/degiro/import?mode=${options.mode ?? "preview"}`,
    { method: "POST", body: form },
  );
}

function csv(name: string, text: string): File {
  return new File([text], name, { type: "text/csv" });
}

function makeSources(initial?: RuntimeBrokerDataSnapshot) {
  let stored: RuntimeBrokerDataSnapshot | null = initial ?? {};
  const writes: BrokerAccountSnapshot[] = [];
  const vault = {
    getBrokerData: vi.fn(async () => stored),
    putBrokerSnapshot: vi.fn(async (_broker: "degiro", snapshot: BrokerAccountSnapshot) => {
      stored = { ...stored, degiro: snapshot };
      writes.push(structuredClone(snapshot));
    }),
    ensureWritable: vi.fn(async () => undefined),
  };
  const operations: BrokerSyncOperationStore = createMemoryBrokerSyncStateStore();
  const handler = createDeGiroImportHandler({
    vault,
    operations,
    entity: "personal",
    now: () => NOW,
  });
  return { handler, vault, operations, writes, stored: () => stored };
}

type PreviewBody = {
  mode: string;
  files: {
    filename: string;
    sha256: string;
    profile?: string;
    period?: { from: string; to: string };
    rows: {
      trades: unknown[];
      cashFlows: unknown[];
      dividends: unknown[];
      positions: unknown[];
      cashBalances: unknown[];
    };
    problems: string[];
  }[];
};

type RowCounts = { [Key in keyof PreviewBody["files"][number]["rows"]]: number };

type CommitBody = PreviewBody & {
  committed: boolean;
  importedAt?: string;
  totals: RowCounts;
  problems: string[];
};

test("a preview parses every file, hashes the bytes and writes nothing", async () => {
  const { handler, vault, operations, writes } = makeSources();
  const text = fixture("nl/account.csv");

  const response = await handler(upload([csv("Account.csv", text)]));
  expect(response.status).toBe(200);
  const body = (await response.json()) as PreviewBody;

  expect(body.mode).toBe("preview");
  expect(body.files).toHaveLength(1);
  expect(body.files[0]).toMatchObject({ filename: "Account.csv", profile: "account" });
  expect(body.files[0]!.sha256).toBe(createHash("sha256").update(text).digest("hex"));
  expect(body.files[0]!.rows.trades.length).toBeGreaterThan(0);
  expect(body.files[0]!.rows.cashBalances.length).toBeGreaterThan(0);

  expect(vault.putBrokerSnapshot).not.toHaveBeenCalled();
  expect(vault.ensureWritable).not.toHaveBeenCalled();
  expect(writes).toHaveLength(0);
  expect(await operations.progress("degiro")).toBeNull();
});

test("committing the same file twice leaves the stored snapshot deep-equal", async () => {
  const { handler, writes } = makeSources();
  const request = () => upload([csv("Account.csv", fixture("nl/account.csv"))], { mode: "commit" });

  expect((await handler(request())).status).toBe(200);
  expect((await handler(request())).status).toBe(200);

  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
});

test("an unknown header commits nothing and reports the parse problem", async () => {
  const { handler, writes, operations } = makeSources();
  const response = await handler(
    upload([csv("notes.csv", "Naam,Waarde\nvoorbeeld,1\n")], { mode: "commit" }),
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as CommitBody;

  expect(body.committed).toBe(false);
  expect(body.problems.length).toBeGreaterThan(0);
  expect(body.totals).toEqual({
    trades: 0,
    cashFlows: 0,
    dividends: 0,
    positions: 0,
    cashBalances: 0,
  });
  expect(writes).toHaveLength(0);
  expect(await operations.progress("degiro")).toBeNull();
});

test("a known header with no data row commits nothing and keeps the stored coverage", async () => {
  const account = fixture("nl/account.csv");
  const firstCommit = upload([csv("Account.csv", account)], { mode: "commit" });
  const { handler, writes, vault } = makeSources();
  expect((await handler(firstCommit)).status).toBe(200);
  const before = structuredClone(writes[0]!);

  const header = account.split("\n")[0]!;
  const empty = upload([csv("Account.csv", `${header}\n`)], { mode: "commit" });
  const response = await handler(empty);
  expect(response.status).toBe(200);
  const body = (await response.json()) as CommitBody;
  expect(body.committed).toBe(false);
  expect(writes).toHaveLength(1);
  expect(vault.putBrokerSnapshot).toHaveBeenCalledTimes(1);
  expect(writes[0]).toEqual(before);
});

test("an upload over 4 MB is refused with 413 before any file is read", async () => {
  const { handler, vault } = makeSources();
  const big = new File([new Uint8Array(5 * 1024 * 1024)], "big.csv", { type: "text/csv" });

  const response = await handler(upload([big], { mode: "commit" }));
  expect(response.status).toBe(413);
  const body = (await response.json()) as { problems: string[] };
  expect(body.problems[0]).toContain("MB");
  expect(vault.putBrokerSnapshot).not.toHaveBeenCalled();
});

test("more than three files is an invalid request", async () => {
  const { handler } = makeSources();
  const response = await handler(
    upload(
      ["a.csv", "b.csv", "c.csv", "d.csv"].map((name) =>
        csv(name, "Datum,Tijd,Valutadatum,Product,ISIN,Omschrijving,FX,Mutatie,,Saldo,,Order Id\n"),
      ),
      { mode: "commit" },
    ),
  );
  expect(response.status).toBe(400);
});

test("a portfolio export without asOf is refused after its profile is detected", async () => {
  const { handler } = makeSources();
  const response = await handler(upload([csv("portfolio.csv", fixture("nl/portfolio.csv"))]));
  expect(response.status).toBe(400);
  const body = (await response.json()) as { problems: string[] };
  expect(body.problems[0]).toContain("asOf");
});

test("a portfolio export with asOf previews its dated positions", async () => {
  const { handler } = makeSources();
  const response = await handler(
    upload([csv("portfolio.csv", fixture("nl/portfolio.csv"))], { asOf: "2026-11-12" }),
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as PreviewBody;
  expect(body.files[0]!.profile).toBe("portfolio");
  expect(body.files[0]!.rows.positions.length).toBeGreaterThan(0);
});

test("an unknown mode is refused", async () => {
  const { handler } = makeSources();
  const response = await handler(
    upload([csv("Account.csv", fixture("nl/account.csv"))], { mode: "merge" }),
  );
  expect(response.status).toBe(400);
});

test("a held lease answers 409 and writes nothing", async () => {
  const { handler, operations, writes } = makeSources();
  await operations.claim("degiro", {
    leaseId: "other-run",
    staleBefore: new Date(Date.parse(NOW) - 60_000).toISOString(),
    progress: { status: "running", message: null, updatedAt: NOW, leaseId: "other-run" },
  });

  const response = await handler(
    upload([csv("Account.csv", fixture("nl/account.csv"))], { mode: "commit" }),
  );
  expect(response.status).toBe(409);
  expect(writes).toHaveLength(0);
});

test("a second import of an older window keeps the rows outside that window", async () => {
  const { handler, writes } = makeSources();
  await handler(upload([csv("Account.csv", fixture("nl/account.csv"))], { mode: "commit" }));
  await handler(
    upload([csv("Transactions.csv", fixture("nl/transactions.csv"))], { mode: "commit" }),
  );

  const first = writes[0]!;
  const merged = writes[1]!;
  const firstIds = new Set(first.trades.map((trade) => trade.id));
  const mergedIds = new Set(merged.trades.map((trade) => trade.id));
  for (const id of firstIds) expect(mergedIds.has(id)).toBe(true);
  expect(mergedIds.size).toBeGreaterThan(firstIds.size);
});

test("a committed import reaches its own tenant's dashboard and no other", async () => {
  let currentTenant = "tenant-a";
  const app = await createRuntimeApp({
    resolveTenantId: () => currentTenant,
    priceStore: createInMemorySharedPriceStore(),
  });

  const form = new FormData();
  form.append("files", csv("Account.csv", fixture("nl/account.csv")));
  form.append("files", csv("portfolio.csv", fixture("nl/portfolio.csv")));
  form.append("asOf", "2026-11-12");
  const imported = await app.request("/api/investing/brokers/degiro/import?mode=commit", {
    method: "POST",
    body: form,
  });
  expect(imported.status).toBe(200);
  expect(((await imported.json()) as CommitBody).committed).toBe(true);

  const mine = (await (
    await app.request("/api/investing/dashboard")
  ).json()) as InvestingDashboardData;
  expect(mine.positions.map((position) => position.symbol)).toContain("XS00PF000003");

  currentTenant = "tenant-b";
  const theirs = (await (
    await app.request("/api/investing/dashboard")
  ).json()) as InvestingDashboardData;
  expect(theirs.positions.map((position) => position.symbol)).not.toContain("XS00PF000003");
  expect(tenants.vaults.get("tenant-b")).toBeUndefined();
});

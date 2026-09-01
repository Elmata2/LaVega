import { expect, test, vi } from "vitest";
import { createNeonCredentialStore } from "./neonCredentialStore.js";
import type { EncryptedBrokerRepository } from "@lavega/database";

function fakeRepository(): EncryptedBrokerRepository & { rows: Map<string, { credentials: unknown; snapshot: unknown | null }> } {
  const rows = new Map<string, { credentials: unknown; snapshot: unknown | null }>();
  return {
    rows,
    async get<T>(broker: string) {
      const row = rows.get(broker);
      return row ? { credentials: row.credentials as T, snapshot: row.snapshot } : null;
    },
    async put(broker: string, credentials: unknown, snapshot?: unknown) {
      const existing = rows.get(broker);
      rows.set(broker, { credentials, snapshot: snapshot === undefined ? existing?.snapshot ?? null : snapshot });
    },
  };
}

const trading212 = { broker: "trading212" as const, tenantId: "user-123", token: "t", secret: "s" };

test("a tenant without a broker row has an empty vault", async () => {
  const store = createNeonCredentialStore(fakeRepository(), "user-123");

  expect(await store.status()).toBe("empty");
  expect(await store.getCredentials("user-123", "trading212")).toBeNull();
});

test("stored credentials come back for the tenant that stored them", async () => {
  const store = createNeonCredentialStore(fakeRepository(), "user-123");

  await store.putCredentials(trading212);

  expect(await store.status()).toBe("unlocked");
  expect(await store.getCredentials("user-123", "trading212")).toEqual(trading212);
  expect(await store.getCredentials("user-123", "ibkr")).toBeNull();
});

test("the vault refuses to read or write another tenant's credentials", async () => {
  const store = createNeonCredentialStore(fakeRepository(), "user-123");

  await expect(store.getCredentials("user-456", "trading212")).rejects.toThrow(/tenant/i);
  await expect(store.putCredentials({ ...trading212, tenantId: "user-456" })).rejects.toThrow(/tenant/i);
});

test("the server key means there is nothing to unlock", async () => {
  const store = createNeonCredentialStore(fakeRepository(), "user-123");
  await store.putCredentials(trading212);

  await store.setup("ignored");
  store.lock();

  expect(await store.unlock("any passphrase at all")).toBe(true);
  expect(await store.status()).toBe("unlocked");
});

test("broker snapshots round-trip per broker and leave credentials intact", async () => {
  const repository = fakeRepository();
  const store = createNeonCredentialStore(repository, "user-123");
  await store.putCredentials(trading212);

  await store.putBrokerData({ trading212: { positions: [], trades: [], dividends: [] } });

  expect(await store.getBrokerData()).toEqual({ trading212: { positions: [], trades: [], dividends: [] } });
  expect(await store.getCredentials("user-123", "trading212")).toEqual(trading212);
});

test("a snapshot for a broker with no credentials is dropped rather than inventing a row", async () => {
  const repository = fakeRepository();
  const store = createNeonCredentialStore(repository, "user-123");

  await store.putBrokerData({ ibkr: { positions: [], trades: [], dividends: [] } });

  expect(repository.rows.size).toBe(0);
  expect(await store.getBrokerData()).toEqual({});
});

test("an empty vault reports no broker data instead of failing", async () => {
  const store = createNeonCredentialStore(fakeRepository(), "user-123");

  expect(await store.getBrokerData()).toEqual({});
});

test("an unreadable hosted broker row does not block reconnecting", async () => {
  const repository = fakeRepository();
  repository.get = vi.fn(async () => {
    throw new Error("Stored broker credentials cannot be read with the current LAVEGA_ENCRYPTION_KEY");
  });
  const store = createNeonCredentialStore(repository, "user-123");

  expect(await store.status()).toBe("empty");
});

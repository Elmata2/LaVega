import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { createFileCredentialStore, runtimeCredentialFile } from "./fileCredentialStore.js";

test("runtime credential file prefers LAVEGA_VAULT_FILE", () => {
  const previous = process.env.LAVEGA_VAULT_FILE;
  process.env.LAVEGA_VAULT_FILE = "/tmp/custom-vault.json";
  try {
    expect(runtimeCredentialFile()).toBe("/tmp/custom-vault.json");
  } finally {
    if (previous === undefined) delete process.env.LAVEGA_VAULT_FILE;
    else process.env.LAVEGA_VAULT_FILE = previous;
  }
});

test("file credential store encrypts, persists, and unlocks broker credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lavega-credentials-"));
  const filePath = join(directory, "credentials.json");
  try {
    const first = createFileCredentialStore(filePath);
    expect(await first.status()).toBe("empty");
    await first.setup("vault-passphrase");
    await first.putCredentials({
      broker: "trading212",
      tenantId: "local",
      token: "api-key",
      secret: "api-secret",
    });

    const onDisk = await readFile(filePath, "utf8");
    expect(onDisk).not.toContain("api-key");
    expect(onDisk).not.toContain("api-secret");

    const second = createFileCredentialStore(filePath);
    expect(await second.status()).toBe("locked");
    await expect(second.getCredentials("local", "trading212")).rejects.toThrow(
      "credential vault is locked",
    );
    expect(await second.unlock("wrong-passphrase")).toBe(false);
    expect(await second.unlock("vault-passphrase")).toBe(true);
    expect(await second.getCredentials("local", "trading212")).toEqual({
      broker: "trading212",
      tenantId: "local",
      token: "api-key",
      secret: "api-secret",
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("encrypted vault restores broker data after process restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lavega-broker-data-"));
  const filePath = join(directory, "credentials.json");
  const brokerData = {
    ibkr: {
      positions: [
        {
          tenantId: "local",
          entity: "BV",
          symbol: "AAPL",
          quantity: 2,
          averagePrice: 10,
          marketPrice: 12,
          marketValue: 24,
          currency: "EUR",
          asOf: "2026-08-19",
        },
      ],
      trades: [],
      dividends: [
        {
          id: "dividend",
          tenantId: "local",
          entity: "BV",
          broker: "ibkr",
          date: "2026-08-18",
          symbol: "AAPL",
          amount: 2,
          currency: "EUR",
          brokerDividendId: "U1:dividend",
        },
      ],
      cashBalances: [
        {
          tenantId: "local",
          entity: "BV",
          broker: "ibkr",
          currency: "EUR",
          amount: 250,
          asOf: "2026-08-19",
        },
      ],
      cashFlows: [
        {
          id: "deposit",
          tenantId: "local",
          entity: "BV",
          broker: "ibkr",
          date: "2026-08-18",
          currency: "EUR",
          amount: 250,
          kind: "deposit" as const,
          brokerFlowId: "U1:deposit",
        },
      ],
    },
  };
  try {
    const first = createFileCredentialStore(filePath);
    await first.setup("vault-passphrase");
    await first.putBrokerData(brokerData);
    const onDisk = await readFile(filePath, "utf8");
    expect(onDisk).not.toContain("AAPL");
    expect(onDisk).not.toContain("U1:deposit");

    const second = createFileCredentialStore(filePath);
    expect(await second.unlock("vault-passphrase")).toBe(true);
    expect(await second.getBrokerData()).toEqual(brokerData);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reconnecting one local broker clears only its old account snapshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lavega-broker-reset-"));
  const filePath = join(directory, "credentials.json");
  try {
    const vault = createFileCredentialStore(filePath);
    await vault.setup("passphrase");
    await vault.putBrokerData({
      ibkr: { positions: [], trades: [], dividends: [] },
      trading212: { positions: [], trades: [], dividends: [] },
    });
    await vault.putCredentials({
      broker: "trading212",
      tenantId: "local",
      token: "new",
      secret: "new",
    });
    expect(await vault.getBrokerData()).toEqual({
      ibkr: { positions: [], trades: [], dividends: [] },
    });
    const reopened = createFileCredentialStore(filePath);
    await reopened.unlock("passphrase");
    expect(await reopened.getBrokerData()).toEqual({
      ibkr: { positions: [], trades: [], dividends: [] },
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("failed vault setup and mutations leave committed state unchanged", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lavega-vault-failure-"));
  const path = join(directory, "credentials.json");
  let failWrite = true;
  let failRename = false;
  const fs = {
    mkdir,
    readFile,
    writeFile: async (...args: Parameters<typeof writeFile>) => {
      if (failWrite) {
        failWrite = false;
        throw new Error("injected write failure");
      }
      return writeFile(...args);
    },
    rename: async (...args: Parameters<typeof rename>) => {
      if (failRename) {
        failRename = false;
        throw new Error("injected rename failure");
      }
      return rename(...args);
    },
  };
  const credentials = (token: string) => ({
    broker: "trading212" as const,
    tenantId: "local",
    token,
    secret: "secret",
  });
  try {
    const store = createFileCredentialStore(path, fs);
    await expect(store.setup("passphrase")).rejects.toThrow("injected write failure");
    expect(await store.status()).toBe("empty");
    expect(await store.getCredentials("local", "trading212")).toBeNull();
    await store.setup("passphrase");
    await store.putCredentials(credentials("committed"));
    failRename = true;
    await expect(store.putCredentials(credentials("rejected"))).rejects.toThrow(
      "injected rename failure",
    );
    expect(await store.getCredentials("local", "trading212")).toEqual(credentials("committed"));
    const reopened = createFileCredentialStore(path);
    expect(await reopened.unlock("passphrase")).toBe(true);
    expect(await reopened.getCredentials("local", "trading212")).toEqual(credentials("committed"));
    await store.putBrokerData({});
    expect(await store.getCredentials("local", "trading212")).toEqual(credentials("committed"));
    await Promise.all([
      store.putCredentials(credentials("later")),
      store.putBrokerData({
        ibkr: { positions: [], trades: [], dividends: [], cashBalances: [], cashFlows: [] },
      }),
    ]);
    const latest = createFileCredentialStore(path);
    expect(await latest.unlock("passphrase")).toBe(true);
    expect(await latest.getCredentials("local", "trading212")).toEqual(credentials("later"));
    expect((await latest.getBrokerData())?.ibkr).toBeDefined();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

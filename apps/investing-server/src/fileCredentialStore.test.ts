import { mkdtemp, readFile, rm } from "node:fs/promises";
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
    await first.putCredentials({ broker: "trading212", tenantId: "local", token: "api-key", secret: "api-secret" });

    const onDisk = await readFile(filePath, "utf8");
    expect(onDisk).not.toContain("api-key");
    expect(onDisk).not.toContain("api-secret");

    const second = createFileCredentialStore(filePath);
    expect(await second.status()).toBe("locked");
    expect(await second.unlock("wrong-passphrase")).toBe(false);
    expect(await second.unlock("vault-passphrase")).toBe(true);
    expect(await second.getCredentials("local", "trading212")).toEqual({ broker: "trading212", tenantId: "local", token: "api-key", secret: "api-secret" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

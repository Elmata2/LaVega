import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { createFileCredentialStore } from "./fileCredentialStore.js";

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

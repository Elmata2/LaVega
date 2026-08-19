import { expect, test, vi } from "vitest";
import { createRuntimeBrokerCredentialSetup } from "./index.js";
import { createFileCredentialStore } from "./fileCredentialStore.js";

function fakeVault(status: "empty" | "locked" | "unlocked") {
  return {
    status: vi.fn(async () => status),
    setup: vi.fn(async () => undefined),
    unlock: vi.fn(async () => true),
    lock: vi.fn(),
    putCredentials: vi.fn(async () => undefined),
  } as unknown as ReturnType<typeof createFileCredentialStore>;
}

test("credential setup creates encrypted vault and stores IBKR credentials", async () => {
  const vault = fakeVault("empty");
  await createRuntimeBrokerCredentialSetup(vault)({ broker: "ibkr", token: "flex-token", queryId: "123456", passphrase: "vault-passphrase" });

  expect(vault.setup).toHaveBeenCalledWith("vault-passphrase");
  expect(vault.putCredentials).toHaveBeenCalledWith({ broker: "ibkr", tenantId: "local", token: "flex-token", queryId: "123456" });
});

test("credential setup rejects wrong passphrase before replacing stored credentials", async () => {
  const vault = fakeVault("unlocked");
  vault.unlock = vi.fn(async () => false);

  await expect(createRuntimeBrokerCredentialSetup(vault)({ broker: "trading212", token: "api-key", secret: "api-secret", passphrase: "wrong" })).rejects.toThrow("Vault passphrase is incorrect");
  expect(vault.lock).not.toHaveBeenCalled();
  expect(vault.putCredentials).not.toHaveBeenCalled();
});

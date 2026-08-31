import { afterEach, expect, test } from "vitest";
import { createRuntimeCredentialStore, credentialsArePerTenant } from "./credentialStore.js";

afterEach(() => {
  delete process.env.DATABASE_URL;
});

test("without a database the local file vault is the store and it still locks", async () => {
  delete process.env.DATABASE_URL;

  expect(credentialsArePerTenant()).toBe(false);
  expect(await createRuntimeCredentialStore("local").status()).toBe("empty");
});

test("with a database the store is per tenant and has nothing to unlock", async () => {
  process.env.DATABASE_URL = "postgres://user:pass@db.example.invalid/lavega";

  const store = createRuntimeCredentialStore("user-123");

  expect(credentialsArePerTenant()).toBe(true);
  expect(await store.unlock("anything")).toBe(true);
});

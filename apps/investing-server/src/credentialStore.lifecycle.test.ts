import { expect, test, vi } from "vitest";

const pools = vi.hoisted(() =>
  Array.from({ length: 2 }, () => ({
    end: vi.fn(async () => undefined),
  })),
);
const createDatabaseMock = vi.hoisted(() => vi.fn(() => pools.shift()!));

vi.mock("@lavega/database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@lavega/database")>()),
  createDatabase: createDatabaseMock,
}));

import { runtimeDatabase, withRuntimeDatabase } from "./credentialStore.js";

test("each hosted request owns and closes its Neon pool", async () => {
  process.env.DATABASE_URL = "postgres://user:pass@db.example.invalid/lavega";

  const first = await withRuntimeDatabase(async () => runtimeDatabase());
  const second = await withRuntimeDatabase(async () => runtimeDatabase());

  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(first).not.toBe(second);
  expect(createDatabaseMock).toHaveBeenCalledTimes(2);
  expect(createDatabaseMock.mock.results[0]?.value.end).toHaveBeenCalledOnce();
  expect(createDatabaseMock.mock.results[1]?.value.end).toHaveBeenCalledOnce();
});

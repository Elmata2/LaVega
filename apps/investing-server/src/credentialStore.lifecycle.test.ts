import { expect, test, vi } from "vitest";

const endSpies = vi.hoisted(() => [] as ReturnType<typeof vi.fn>[]);

vi.mock("@neondatabase/serverless", () => ({
  Pool: vi.fn(function MockPool() {
    const end = vi.fn(async () => undefined);
    endSpies.push(end);
    return { on: vi.fn(), end };
  }),
  neon: vi.fn(() => vi.fn()),
}));

import { Pool } from "@neondatabase/serverless";
import { runtimeDatabase, withRuntimeDatabase } from "./credentialStore.js";

test("each hosted request owns and closes its Neon pool", async () => {
  process.env.DATABASE_URL = "postgres://user:pass@db.example.invalid/lavega";

  const first = await withRuntimeDatabase(async () => runtimeDatabase());
  const second = await withRuntimeDatabase(async () => runtimeDatabase());

  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(first).not.toBe(second);
  expect(Pool).toHaveBeenCalledTimes(2);
  expect(endSpies[0]).toHaveBeenCalledOnce();
  expect(endSpies[1]).toHaveBeenCalledOnce();
});

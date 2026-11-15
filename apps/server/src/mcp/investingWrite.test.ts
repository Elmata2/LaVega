import { expect, test, vi } from "vitest";
import { createMcpValuationWrite, type ValuationWriteRepository } from "./investingWrite.js";

const citation = {
  source: "Broker annual report",
  grade: "B" as const,
  date: "2026-01-01",
};

test("a valuation write goes through the tenant-scoped repository with its citation", async () => {
  const put = vi.fn(async () => undefined);
  const repository: ValuationWriteRepository = { put };
  const write = createMcpValuationWrite("user-1", repository);

  const result = await write({ date: "2026-01-01", totalCents: 100_000, citation });

  expect(put).toHaveBeenCalledWith("2026-01-01", 100_000, citation);
  expect(result).toEqual({
    applied: true,
    date: "2026-01-01",
    totalCents: 100_000,
    citation,
  });
});

test("the bridge decodes the citation again, so a bypassed tool layer still cannot store prose", async () => {
  const put = vi.fn(async () => undefined);
  const write = createMcpValuationWrite("user-1", { put });
  await expect(
    write({
      date: "2026-01-01",
      totalCents: 1,
      citation: { ...citation, note: "the owner said so" } as never,
    }),
  ).rejects.toThrow();
  expect(put).not.toHaveBeenCalled();
});

test("without a database the write fails loudly instead of silently doing nothing", async () => {
  const write = createMcpValuationWrite("user-1");
  await expect(write({ date: "2026-01-01", totalCents: 1, citation })).rejects.toThrow(
    "needs a database",
  );
});

import { afterEach, expect, test, vi } from "vitest";
import { localId, shortLocalId } from "./localId";

afterEach(() => vi.unstubAllGlobals());

test("ids are unique and the short one has eight characters", () => {
  const ids = new Set(Array.from({ length: 200 }, () => localId()));
  expect(ids.size).toBe(200);
  expect(shortLocalId()).toHaveLength(8);
});

test("without randomUUID the id comes from getRandomValues, never Math.random", () => {
  const random = vi.spyOn(Math, "random");
  vi.stubGlobal("crypto", {
    getRandomValues: (b: Parameters<Crypto["getRandomValues"]>[0]) => realCrypto.getRandomValues(b),
  });
  expect(localId()).toMatch(/^[0-9a-f]{32}$/);
  expect(shortLocalId()).toMatch(/^[0-9a-f]{8}$/);
  expect(random).not.toHaveBeenCalled();
  random.mockRestore();
});

test("with no crypto at all the ids still differ", () => {
  vi.stubGlobal("crypto", undefined);
  expect(localId()).not.toBe(localId());
  expect(shortLocalId()).toHaveLength(8);
});

const realCrypto = globalThis.crypto;

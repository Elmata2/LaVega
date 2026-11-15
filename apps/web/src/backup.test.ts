import { expect, test } from "vitest";
import type { CipherBlob } from "@lavega/adapters";
import { backupCarriesDocuments, backupFilename, parseBackup, serializeBackup } from "./backup.js";

const validBlob: CipherBlob = {
  v: 1,
  kdf: "PBKDF2-SHA256",
  iterations: 210_000,
  salt: "c2FsdA==",
  iv: "aXY=",
  ct: "Y3Q=",
};

test("backupFilename shapes a .lavega filename from the given date string", () => {
  expect(backupFilename("2026-08-03")).toBe("lavega-backup-2026-08-03.lavega");
});

test("serializeBackup -> parseBackup round-trips a CipherBlob", () => {
  const text = serializeBackup(validBlob);
  expect(parseBackup(text)).toEqual(validBlob);
});

test("parseBackup throws on malformed (non-JSON) text", () => {
  expect(() => parseBackup("not json")).toThrow();
});

test("parseBackup throws on well-formed JSON that isn't shaped like a CipherBlob", () => {
  expect(() => parseBackup(JSON.stringify({ foo: "bar" }))).toThrow();
  expect(() => parseBackup(JSON.stringify({ ...validBlob, v: 2 }))).toThrow();
  expect(() => parseBackup(JSON.stringify({ ...validBlob, kdf: "AES-only" }))).toThrow();
  expect(() => parseBackup(JSON.stringify({ ...validBlob, salt: 123 }))).toThrow();
  expect(() => parseBackup(JSON.stringify({ ...validBlob, iterations: "210000" }))).toThrow();
  expect(() => parseBackup("null")).toThrow();
  expect(() => parseBackup("42")).toThrow();
});

test("parseBackup rejects an absurd iteration count (DoS guard) and a sub-1 count", () => {
  expect(() => parseBackup(JSON.stringify({ ...validBlob, iterations: 999_999_999 }))).toThrow();
  expect(() => parseBackup(JSON.stringify({ ...validBlob, iterations: 0 }))).toThrow();
});

const vaultOnly = { v: 2, kdf: "account-key", iv: "aXY=", ct: "Y3Q=" } as const;
const bundle = { v: 3, kdf: "account-key", iv: "aXY=", ct: "YnVuZGxl" } as const;

test("a vault-only (v2) backup still parses and is known to carry no documents", () => {
  const parsed = parseBackup(JSON.stringify(vaultOnly));
  expect(parsed).toEqual(vaultOnly);
  expect(backupCarriesDocuments(parsed)).toBe(false);
});

test("a full bundle (v3) parses and is known to carry the sealed documents", () => {
  const parsed = parseBackup(serializeBackup(bundle));
  expect(parsed).toEqual(bundle);
  expect(backupCarriesDocuments(parsed)).toBe(true);
});

test("a malformed v3 bundle is refused like any other malformed file", () => {
  expect(() => parseBackup(JSON.stringify({ ...bundle, ct: 5 }))).toThrow();
  expect(() => parseBackup(JSON.stringify({ ...bundle, kdf: "PBKDF2-SHA256" }))).toThrow();
  expect(() =>
    parseBackup(JSON.stringify({ v: 4, kdf: "account-key", iv: "a", ct: "b" })),
  ).toThrow();
});

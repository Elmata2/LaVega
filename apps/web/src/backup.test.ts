import { expect, test } from "vitest";
import type { CipherBlob } from "@lavega/adapters";
import { backupFilename, serializeBackup, parseBackup } from "./backup.js";

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

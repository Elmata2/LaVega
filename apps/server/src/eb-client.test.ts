import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  eb,
  ebJWT,
  EnableBankingApiError,
  EnableBankingTimeoutError,
  MAX_RETRY_AFTER_MS,
  parseRetryAfter,
  resetEbRetryAfter,
  type EbClientConfig,
} from "./eb-client.js";

function makeTestKeypair(privateKeyType: "pkcs1" | "pkcs8" = "pkcs1") {
  return generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: privateKeyType, format: "pem" },
  });
}

function decodeSegment(segment: string): Buffer {
  return Buffer.from(segment, "base64url");
}

describe("ebJWT", () => {
  test.each([["pkcs1"], ["pkcs8"]] as const)(
    "builds a RS256 JWT with the correct header, claims, and a verifiable signature (%s key)",
    async (privateKeyType) => {
      const { publicKey, privateKey } = makeTestKeypair(privateKeyType);
      const dir = mkdtempSync(path.join(tmpdir(), "lavega-eb-jwt-"));
      const keyPath = path.join(dir, "test-key.pem");
      writeFileSync(keyPath, privateKey);

      try {
        const config: EbClientConfig = {
          applicationId: "test-application-id",
          privateKeyFile: keyPath,
        };
        const before = Math.floor(Date.now() / 1000);
        const token = await ebJWT(config);
        const after = Math.floor(Date.now() / 1000);

        const parts = token.split(".");
        expect(parts).toHaveLength(3);
        const [headerB64, payloadB64, sigB64] = parts;

        const header = JSON.parse(decodeSegment(headerB64).toString("utf8"));
        expect(header).toEqual({ typ: "JWT", alg: "RS256", kid: "test-application-id" });

        const claims = JSON.parse(decodeSegment(payloadB64).toString("utf8"));
        expect(claims.iss).toBe("enablebanking.com");
        expect(claims.aud).toBe("api.enablebanking.com");
        expect(claims.iat).toBeGreaterThanOrEqual(before);
        expect(claims.iat).toBeLessThanOrEqual(after);
        expect(claims.exp - claims.iat).toBe(3600);

        const signingInput = `${headerB64}.${payloadB64}`;
        const verifier = createVerify("RSA-SHA256");
        verifier.update(signingInput);
        const verified = verifier.verify(publicKey, decodeSegment(sigB64));
        expect(verified).toBe(true);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  test("throws a clear error when applicationId is missing", async () => {
    await expect(
      ebJWT({ applicationId: null, privateKeyFile: "/tmp/whatever.pem" }),
    ).rejects.toThrow(/applicationId/i);
  });

  test("throws a clear error when privateKeyFile is missing", async () => {
    await expect(ebJWT({ applicationId: "abc", privateKeyFile: null })).rejects.toThrow(
      /privateKeyFile/i,
    );
  });

  test("throws a clear error when the private key file does not exist on disk", async () => {
    await expect(
      ebJWT({ applicationId: "abc", privateKeyFile: "/definitely/not/a/real/path/key.pem" }),
    ).rejects.toThrow(/private key/i);
  });
});

describe("eb", () => {
  let server: Server | undefined;
  let keyDir: string;
  let config: EbClientConfig;

  beforeEach(() => {
    resetEbRetryAfter();
    const { privateKey } = makeTestKeypair();
    keyDir = mkdtempSync(path.join(tmpdir(), "lavega-eb-client-"));
    const keyPath = path.join(keyDir, "test-key.pem");
    writeFileSync(keyPath, privateKey);
    config = { applicationId: "test-app", privateKeyFile: keyPath };
  });

  afterEach(async () => {
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
      server = undefined;
    }
    rmSync(keyDir, { recursive: true, force: true });
  });

  async function listen(
    handler: (
      req: import("node:http").IncomingMessage,
      res: import("node:http").ServerResponse,
    ) => void,
  ) {
    server = createServer(handler);
    await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  test("sends a bearer JWT + JSON body and returns the parsed JSON response", async () => {
    let receivedAuth: string | undefined;
    let receivedBody = "";
    const baseUrl = await listen((req, res) => {
      receivedAuth = req.headers.authorization;
      req.on("data", (chunk) => (receivedBody += chunk));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });

    const data = await eb(config, "POST", "/aspsps", { hello: "world" }, baseUrl);

    expect(data).toEqual({ ok: true });
    expect(receivedAuth).toMatch(/^Bearer /);
    expect(JSON.parse(receivedBody)).toEqual({ hello: "world" });
  });

  test("throws EnableBankingApiError with a clear message on a non-2xx response", async () => {
    const baseUrl = await listen((_req, res) => {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "invalid aspsp" } }));
    });

    await expect(eb(config, "GET", "/aspsps", undefined, baseUrl)).rejects.toThrow(/invalid aspsp/);
    await expect(eb(config, "GET", "/aspsps", undefined, baseUrl)).rejects.toBeInstanceOf(
      EnableBankingApiError,
    );
  });

  test("sends no body for GET-style calls without a body argument", async () => {
    let receivedBody = "";
    const baseUrl = await listen((req, res) => {
      req.on("data", (chunk) => (receivedBody += chunk));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ items: [] }));
      });
    });

    const data = await eb(config, "GET", "/aspsps?country=NL", undefined, baseUrl);

    expect(data).toEqual({ items: [] });
    expect(receivedBody).toBe("");
  });

  test("aborts and throws EnableBankingTimeoutError when the upstream stalls", async () => {
    const baseUrl = await listen((_req, _res) => {
      // Never respond — simulate a hung upstream connection.
    });

    await expect(
      eb(config, "GET", "/accounts/a1/balances", undefined, baseUrl, { timeoutMs: 50 }),
    ).rejects.toBeInstanceOf(EnableBankingTimeoutError);
  });

  test("parses Retry-After delta-seconds and HTTP-date", () => {
    const now = Date.parse("2026-11-23T12:00:00.000Z");
    expect(parseRetryAfter("120", now)).toBe(120_000);
    expect(parseRetryAfter("0", now)).toBe(0);
    expect(parseRetryAfter("Mon, 23 Nov 2026 12:05:00 GMT", now)).toBe(300_000);
    expect(parseRetryAfter("Mon, 23 Nov 2026 11:55:00 GMT", now)).toBe(0);
    expect(parseRetryAfter("", now)).toBeNull();
    expect(parseRetryAfter("-10", now)).toBeNull();
    expect(parseRetryAfter("not-a-date", now)).toBeNull();
    expect(parseRetryAfter(null, now)).toBeNull();
  });

  test("respects 429 Retry-After (delta-seconds) without hot retry and resumes after cooldown", async () => {
    let hits = 0;
    const baseUrl = await listen((_req, res) => {
      hits += 1;
      if (hits === 1) {
        res.writeHead(429, { "Content-Type": "application/json", "Retry-After": "60" });
        res.end(JSON.stringify({ message: "too many requests" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });

    let clock = Date.parse("2026-11-23T12:00:00.000Z");
    const now = () => clock;

    const firstErr = await eb(config, "GET", "/accounts/a1/balances", undefined, baseUrl, {
      now,
    }).catch((e) => e);
    expect(firstErr).toBeInstanceOf(EnableBankingApiError);
    expect((firstErr as EnableBankingApiError).status).toBe(429);
    expect((firstErr as EnableBankingApiError).retryAfterMs).toBe(60_000);
    expect(hits).toBe(1);

    // Immediate second call is blocked locally without hitting the server.
    clock += 10_000;
    const secondErr = await eb(config, "GET", "/accounts/a1/balances", undefined, baseUrl, {
      now,
    }).catch((e) => e);
    expect(secondErr).toBeInstanceOf(EnableBankingApiError);
    expect((secondErr as EnableBankingApiError).status).toBe(429);
    expect((secondErr as EnableBankingApiError).retryAfterMs).toBe(50_000);
    expect(hits).toBe(1);

    // After Retry-After elapses, the call goes through.
    clock += 50_000;
    const data = await eb(config, "GET", "/accounts/a1/balances", undefined, baseUrl, { now });
    expect(data).toEqual({ ok: true });
    expect(hits).toBe(2);
  });

  test("respects 429 Retry-After with HTTP-date", async () => {
    let hits = 0;
    const baseUrl = await listen((_req, res) => {
      hits += 1;
      res.writeHead(429, {
        "Content-Type": "application/json",
        "Retry-After": "Mon, 23 Nov 2026 12:02:00 GMT",
      });
      res.end(JSON.stringify({ message: "rate limited" }));
    });

    let clock = Date.parse("2026-11-23T12:00:00.000Z");
    const now = () => clock;

    const err = await eb(config, "GET", "/accounts/a1/balances", undefined, baseUrl, { now }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(EnableBankingApiError);
    expect((err as EnableBankingApiError).retryAfterMs).toBe(120_000);
    expect(hits).toBe(1);

    clock += 30_000;
    await expect(
      eb(config, "GET", "/accounts/a1/balances", undefined, baseUrl, { now }),
    ).rejects.toBeInstanceOf(EnableBankingApiError);
    expect(hits).toBe(1);
  });

  test("scopes Retry-After cooldown per bank/account, preserves 503 vs 429, and clamps excessive Retry-After", async () => {
    expect(parseRetryAfter("99999999", 0)).toBe(MAX_RETRY_AFTER_MS);

    let a2Hits = 0;
    const baseUrl = await listen((req, res) => {
      if (req.url?.includes("/accounts/a1/")) {
        res.writeHead(503, { "Content-Type": "application/json", "Retry-After": "120" });
        res.end(JSON.stringify({ message: "bank maintenance" }));
        return;
      }
      a2Hits += 1;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });

    const clock = Date.parse("2026-11-23T12:00:00.000Z");
    const now = () => clock;

    const first = await eb(config, "GET", "/accounts/a1/balances", undefined, baseUrl, {
      now,
    }).catch((e) => e);
    expect((first as EnableBankingApiError).status).toBe(503);

    const cached = await eb(config, "GET", "/accounts/a1/balances", undefined, baseUrl, {
      now,
    }).catch((e) => e);
    expect((cached as EnableBankingApiError).status).toBe(503);

    const other = await eb(config, "GET", "/accounts/a2/balances", undefined, baseUrl, { now });
    expect(other).toEqual({ ok: true });
    expect(a2Hits).toBe(1);
  });
});

import { expect, test, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadBudgetConfig, loadConfig, loadLlmConfig, maskApplicationId } from "./config.js";

test("with no config.json present, config reports configured:false and applicationId:null", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lavega-server-config-"));
  const missingPath = path.join(dir, "config.json");
  try {
    const config = loadConfig(missingPath);
    expect(config.configured).toBe(false);
    expect(config.applicationId).toBeNull();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a VUL-IN placeholder applicationId is treated as not configured", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lavega-server-config-"));
  const configPath = path.join(dir, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      applicationId: "VUL-IN-app-id-uit-control-panel",
      privateKeyFile: "./VUL-IN-app-id.pem",
      redirectUrl: "http://localhost:8787/api/eb/callback",
      psuType: "business",
    }),
  );
  try {
    const config = loadConfig(configPath);
    expect(config.configured).toBe(false);
    expect(config.applicationId).toBeNull();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a real config is reported as configured, with defaults filled in when absent", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lavega-server-config-"));
  const configPath = path.join(dir, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({ applicationId: "abcd1234efgh5678", privateKey: "-----BEGIN KEY-----" }),
  );
  try {
    const config = loadConfig(configPath);
    expect(config.configured).toBe(true);
    expect(config.keySource).toBe("env");
    expect(config.applicationId).toBe("abcd1234efgh5678");
    expect(config.privateKeyFile).toBeNull();
    expect(config.redirectUrl).toBe("http://localhost:8787/api/eb/callback");
    expect(config.psuType).toBe("business");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("maskApplicationId shows only the first 8 characters", () => {
  expect(maskApplicationId("abcd1234efgh5678")).toBe("abcd1234…");
  expect(maskApplicationId(null)).toBeNull();
});

test("loadLlmConfig: configured only when MISTRAL_API_KEY is set", () => {
  const prev = process.env.MISTRAL_API_KEY;
  try {
    delete process.env.MISTRAL_API_KEY;
    expect(loadLlmConfig()).toEqual({ configured: false, apiKey: null });
    process.env.MISTRAL_API_KEY = "test-mistral-key";
    expect(loadLlmConfig()).toEqual({ configured: true, apiKey: "test-mistral-key" });
  } finally {
    if (prev === undefined) delete process.env.MISTRAL_API_KEY;
    else process.env.MISTRAL_API_KEY = prev;
  }
});

test("loadBudgetConfig: defaults to 200/2000 cents when unset", () => {
  const prevDay = process.env.AI_DAILY_BUDGET_CENTS;
  const prevMonth = process.env.AI_MONTHLY_BUDGET_CENTS;
  try {
    delete process.env.AI_DAILY_BUDGET_CENTS;
    delete process.env.AI_MONTHLY_BUDGET_CENTS;
    expect(loadBudgetConfig()).toEqual({ dayCents: 200, monthCents: 2000 });
  } finally {
    if (prevDay === undefined) delete process.env.AI_DAILY_BUDGET_CENTS;
    else process.env.AI_DAILY_BUDGET_CENTS = prevDay;
    if (prevMonth === undefined) delete process.env.AI_MONTHLY_BUDGET_CENTS;
    else process.env.AI_MONTHLY_BUDGET_CENTS = prevMonth;
  }
});

test("loadBudgetConfig: reads custom caps when set", () => {
  const prevDay = process.env.AI_DAILY_BUDGET_CENTS;
  const prevMonth = process.env.AI_MONTHLY_BUDGET_CENTS;
  try {
    process.env.AI_DAILY_BUDGET_CENTS = "500";
    process.env.AI_MONTHLY_BUDGET_CENTS = "5000";
    expect(loadBudgetConfig()).toEqual({ dayCents: 500, monthCents: 5000 });
  } finally {
    if (prevDay === undefined) delete process.env.AI_DAILY_BUDGET_CENTS;
    else process.env.AI_DAILY_BUDGET_CENTS = prevDay;
    if (prevMonth === undefined) delete process.env.AI_MONTHLY_BUDGET_CENTS;
    else process.env.AI_MONTHLY_BUDGET_CENTS = prevMonth;
  }
});

test("loadBudgetConfig: a non-numeric or non-positive value falls back to the default", () => {
  const prevDay = process.env.AI_DAILY_BUDGET_CENTS;
  const prevMonth = process.env.AI_MONTHLY_BUDGET_CENTS;
  try {
    process.env.AI_DAILY_BUDGET_CENTS = "not-a-number";
    process.env.AI_MONTHLY_BUDGET_CENTS = "-5";
    expect(loadBudgetConfig()).toEqual({ dayCents: 200, monthCents: 2000 });
  } finally {
    if (prevDay === undefined) delete process.env.AI_DAILY_BUDGET_CENTS;
    else process.env.AI_DAILY_BUDGET_CENTS = prevDay;
    if (prevMonth === undefined) delete process.env.AI_MONTHLY_BUDGET_CENTS;
    else process.env.AI_MONTHLY_BUDGET_CENTS = prevMonth;
  }
});

test("a misspelt psuType falls back to business instead of reaching Enable Banking", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lavega-server-config-"));
  const configPath = path.join(dir, "config.json");
  writeFileSync(
    configPath,
    JSON.stringify({ applicationId: "abcd1234efgh5678", psuType: "corporate" }),
  );
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    expect(loadConfig(configPath).psuType).toBe("business");
    expect(warn).toHaveBeenCalledOnce();
    writeFileSync(
      configPath,
      JSON.stringify({ applicationId: "abcd1234efgh5678", psuType: "personal" }),
    );
    expect(loadConfig(configPath).psuType).toBe("personal");
  } finally {
    warn.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an application id without any private key is not configured, and says which is missing", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lavega-server-config-"));
  const configPath = path.join(dir, "config.json");
  writeFileSync(configPath, JSON.stringify({ applicationId: "abcd1234efgh5678" }));
  try {
    const config = loadConfig(configPath);
    expect(config.configured).toBe(false);
    expect(config.keySource).toBe("missing");
    expect(config.applicationId).toBe("abcd1234efgh5678");
    writeFileSync(
      configPath,
      JSON.stringify({ applicationId: "abcd1234efgh5678", privateKeyFile: "eb.pem" }),
    );
    expect(loadConfig(configPath).keySource).toBe("file");
    expect(loadConfig(configPath).configured).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("EB_PRIVATE_KEY without the PEM header lines is reported as env-not-pem and not configured", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lavega-server-config-"));
  const configPath = path.join(dir, "config.json");
  writeFileSync(configPath, JSON.stringify({ applicationId: "abcd1234efgh5678" }));
  const pem = "-----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY-----";
  try {
    process.env.EB_PRIVATE_KEY = "MIIBbodyonly";
    expect(loadConfig(configPath).keySource).toBe("env-not-pem"); // too short to be a key
    expect(loadConfig(configPath).keyShape).toEqual({ kind: "base64-body", length: 12 });
    process.env.EB_PRIVATE_KEY = "./keys/eb.pem";
    expect(loadConfig(configPath).keyShape.kind).toBe("path");
    expect(loadConfig(configPath).configured).toBe(false);
    process.env.EB_PRIVATE_KEY = Buffer.from(pem).toString("base64");
    expect(loadConfig(configPath).keySource).toBe("env");
    expect(loadConfig(configPath).keyShape.kind).toBe("base64-pem");
    expect(loadConfig(configPath).privateKey).toBe(pem);
    process.env.EB_PRIVATE_KEY = pem.replace(/\n/g, "\\n");
    expect(loadConfig(configPath).privateKey).toBe(pem);
  } finally {
    delete process.env.EB_PRIVATE_KEY;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a key pasted without its header lines is wrapped in the envelope its bytes call for", async () => {
  const { generateKeyPairSync } = await import("node:crypto");
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pkcs8 = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const pkcs1 = privateKey.export({ type: "pkcs1", format: "pem" }) as string;
  const bodyOf = (pem: string) =>
    pem.replace(/-----(BEGIN|END) [^-]+-----/g, "").replace(/\s+/g, "");
  const dir = mkdtempSync(path.join(tmpdir(), "lavega-server-config-"));
  const configPath = path.join(dir, "config.json");
  writeFileSync(configPath, JSON.stringify({ applicationId: "abcd1234efgh5678" }));
  try {
    process.env.EB_PRIVATE_KEY = bodyOf(pkcs8);
    let config = loadConfig(configPath);
    expect(config.keySource).toBe("env");
    expect(config.privateKey).toMatch(/^-----BEGIN PRIVATE KEY-----\n/);
    expect(bodyOf(config.privateKey!)).toBe(bodyOf(pkcs8));
    process.env.EB_PRIVATE_KEY = bodyOf(pkcs1);
    config = loadConfig(configPath);
    expect(config.privateKey).toMatch(/^-----BEGIN RSA PRIVATE KEY-----\n/);
    expect(config.configured).toBe(true);
  } finally {
    delete process.env.EB_PRIVATE_KEY;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a wrapped bare key body signs an Enable Banking JWT through the real signing path", async () => {
  const { generateKeyPairSync } = await import("node:crypto");
  const { ebJWT } = await import("./eb-client.js");
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
  const dir = mkdtempSync(path.join(tmpdir(), "lavega-server-config-"));
  const configPath = path.join(dir, "config.json");
  writeFileSync(configPath, JSON.stringify({ applicationId: "abcd1234efgh5678" }));
  try {
    process.env.EB_PRIVATE_KEY = pem
      .replace(/-----(BEGIN|END) [^-]+-----/g, "")
      .replace(/\s+/g, "");
    const config = loadConfig(configPath);
    const jwt = await ebJWT({
      applicationId: config.applicationId,
      privateKey: config.privateKey,
      privateKeyFile: config.privateKeyFile,
    });
    expect(jwt.split(".")).toHaveLength(3);
  } finally {
    delete process.env.EB_PRIVATE_KEY;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("AI_DAILY_BUDGET_CENTS=0 switches AI spend off instead of falling back to the default", () => {
  const keep = { d: process.env.AI_DAILY_BUDGET_CENTS, m: process.env.AI_MONTHLY_BUDGET_CENTS };
  try {
    process.env.AI_DAILY_BUDGET_CENTS = "0";
    process.env.AI_MONTHLY_BUDGET_CENTS = "0";
    expect(loadBudgetConfig()).toEqual({ dayCents: 0, monthCents: 0 });
    process.env.AI_DAILY_BUDGET_CENTS = "50";
    expect(loadBudgetConfig().dayCents).toBe(50);
    // missing, empty and nonsense all take the documented default
    delete process.env.AI_DAILY_BUDGET_CENTS;
    expect(loadBudgetConfig().dayCents).toBe(200);
    process.env.AI_DAILY_BUDGET_CENTS = "   ";
    expect(loadBudgetConfig().dayCents).toBe(200);
    process.env.AI_DAILY_BUDGET_CENTS = "gratis graag";
    expect(loadBudgetConfig().dayCents).toBe(200);
    process.env.AI_DAILY_BUDGET_CENTS = "-5";
    expect(loadBudgetConfig().dayCents).toBe(200);
  } finally {
    if (keep.d === undefined) delete process.env.AI_DAILY_BUDGET_CENTS;
    else process.env.AI_DAILY_BUDGET_CENTS = keep.d;
    if (keep.m === undefined) delete process.env.AI_MONTHLY_BUDGET_CENTS;
    else process.env.AI_MONTHLY_BUDGET_CENTS = keep.m;
  }
});

import { expect, test, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig, loadLlmConfig, maskApplicationId } from "./config.js";

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

test("loadLlmConfig: configured only when ANTHROPIC_API_KEY is set", () => {
  const prev = process.env.ANTHROPIC_API_KEY;
  try {
    delete process.env.ANTHROPIC_API_KEY;
    expect(loadLlmConfig()).toEqual({ configured: false, apiKey: null });
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect(loadLlmConfig()).toEqual({ configured: true, apiKey: "sk-ant-test" });
  } finally {
    if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = prev;
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

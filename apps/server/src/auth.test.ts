import { afterEach, expect, test } from "vitest";
import { app } from "./index.js";
import { authBaseUrl, authTrustedOrigins } from "./auth.js";

afterEach(() => {
  delete process.env.DATABASE_URL;
  delete process.env.BETTER_AUTH_SECRET;
  delete process.env.BETTER_AUTH_URL;
  delete process.env.BETTER_AUTH_TRUSTED_ORIGINS;
  delete process.env.VERCEL_URL;
});

test("auth refuses requests when server secrets are absent", async () => {
  const response = await app.request("/api/auth/get-session");
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ problems: ["Authentication is not configured"] });
});

test("a preview deployment names itself, since its hostname is new every commit", () => {
  process.env.VERCEL_URL = "lavega-git-feature-abc123.vercel.app";
  try {
    expect(authBaseUrl()).toBe("https://lavega-git-feature-abc123.vercel.app");
    expect(authTrustedOrigins()).toContain("https://lavega-git-feature-abc123.vercel.app");
  } finally {
    delete process.env.VERCEL_URL;
  }
});

test("an explicit base URL wins over the deployment's own hostname", () => {
  process.env.VERCEL_URL = "lavega-git-feature-abc123.vercel.app";
  process.env.BETTER_AUTH_URL = "https://www.lavega.dev";
  try {
    expect(authBaseUrl()).toBe("https://www.lavega.dev");
    // The deployment still trusts itself, or its own /api/auth calls fail.
    expect(authTrustedOrigins()).toEqual(["https://www.lavega.dev", "https://lavega-git-feature-abc123.vercel.app"]);
  } finally {
    delete process.env.VERCEL_URL;
    delete process.env.BETTER_AUTH_URL;
  }
});

test("outside a deployment the local server is the base", () => {
  expect(authBaseUrl()).toBe("http://localhost:8787");
  expect(authTrustedOrigins()).toEqual(["http://localhost:8787"]);
});

test("configured trusted origins are kept alongside the deployment's own", () => {
  process.env.BETTER_AUTH_TRUSTED_ORIGINS = "https://www.lavega.dev, https://lavega.dev";
  process.env.VERCEL_URL = "lavega-git-feature-abc123.vercel.app";
  try {
    expect(authTrustedOrigins()).toEqual(["https://www.lavega.dev", "https://lavega.dev", "https://lavega-git-feature-abc123.vercel.app"]);
  } finally {
    delete process.env.BETTER_AUTH_TRUSTED_ORIGINS;
    delete process.env.VERCEL_URL;
  }
});

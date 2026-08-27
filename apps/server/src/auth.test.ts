import { afterEach, expect, test } from "vitest";
import { app } from "./index.js";

afterEach(() => {
  delete process.env.DATABASE_URL;
  delete process.env.BETTER_AUTH_SECRET;
});

test("auth refuses requests when server secrets are absent", async () => {
  const response = await app.request("/api/auth/get-session");
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ problems: ["Authentication is not configured"] });
});

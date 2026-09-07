import { expect, test, vi } from "vitest";
import { Hono } from "hono";
import { registerAccountRoutes } from "./account-routes.js";

function appWith(tenantId: string | null) {
  const erase = vi.fn(async () => [{ table: "personal.vaults", rows: 2 }]);
  const app = new Hono();
  registerAccountRoutes(app, { tenantId: async () => tenantId, erase });
  return { app, erase };
}

const erasePost = (body: unknown) => ({
  method: "DELETE",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

test("an anonymous caller cannot erase anyone's account", async () => {
  const { app, erase } = appWith(null);
  const res = await app.request("/api/account/data", erasePost({ confirm: "ERASE" }));
  expect(res.status).toBe(401);
  expect(erase).not.toHaveBeenCalled();
});

test("erasure is refused without an explicit confirmation", async () => {
  const { app, erase } = appWith("user-123");
  for (const body of [{}, { confirm: true }, { confirm: "erase" }, { confirm: "yes" }]) {
    const res = await app.request("/api/account/data", erasePost(body));
    expect(res.status, JSON.stringify(body)).toBe(400);
  }
  // A body that is not JSON at all must not erase anything either.
  const malformed = await app.request("/api/account/data", { method: "DELETE", headers: { "content-type": "application/json" }, body: "not-json" });
  expect(malformed.status).toBe(400);
  expect(erase).not.toHaveBeenCalled();
});

test("a confirmed erasure runs for the session's own tenant and reports what went", async () => {
  const { app, erase } = appWith("user-123");

  const res = await app.request("/api/account/data", erasePost({ confirm: "ERASE" }));

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ erased: [{ table: "personal.vaults", rows: 2 }] });
  // The tenant came from the session, never from the request body.
  expect(erase).toHaveBeenCalledWith("user-123");
});

test("a caller cannot erase a tenant they name themselves", async () => {
  const { app, erase } = appWith("user-123");
  await app.request("/api/account/data", erasePost({ confirm: "ERASE", tenantId: "user-999", userId: "user-999" }));
  expect(erase).toHaveBeenCalledWith("user-123");
  expect(erase).not.toHaveBeenCalledWith("user-999");
});

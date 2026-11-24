import { expect, test, vi } from "vitest";
import { Hono } from "hono";
import { registerAccountRoutes } from "./account-routes.js";

function appWith(tenantId: string | null) {
  const erase = vi.fn(async () => [{ table: "personal.vaults", rows: 2 }]);
  const resetPersonal = vi.fn(async () => [{ table: "personal.vaults", rows: 1 }]);
  const app = new Hono();
  registerAccountRoutes(app, { tenantId: async () => tenantId, erase, resetPersonal });
  return { app, erase, resetPersonal };
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
  const malformed = await app.request("/api/account/data", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: "not-json",
  });
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
  await app.request(
    "/api/account/data",
    erasePost({ confirm: "ERASE", tenantId: "user-999", userId: "user-999" }),
  );
  expect(erase).toHaveBeenCalledWith("user-123");
  expect(erase).not.toHaveBeenCalledWith("user-999");
});

const RESET = "/api/account/personal-data";

test("personal reset: an anonymous caller gets 401 and nothing runs", async () => {
  const { app, erase, resetPersonal } = appWith(null);
  const res = await app.request(
    RESET,
    erasePost({ confirm: "RESET-PERSONAL", expectedOwner: "user-123" }),
  );
  expect(res.status).toBe(401);
  expect(resetPersonal).not.toHaveBeenCalled();
  expect(erase).not.toHaveBeenCalled();
});

test("personal reset: only the exact confirm value passes, the full-erase value does not", async () => {
  const { app, erase, resetPersonal } = appWith("user-123");
  for (const body of [
    {},
    { confirm: true },
    { confirm: "ERASE" },
    { confirm: "reset-personal" },
    { confirm: "RESET-PERSONAL " },
    { confirm: ["RESET-PERSONAL"] },
    [],
    null,
  ]) {
    const res = await app.request(RESET, erasePost(body));
    expect(res.status, JSON.stringify(body)).toBe(400);
  }
  const malformed = await app.request(RESET, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: "not-json",
  });
  expect(malformed.status).toBe(400);
  const bare = await app.request(RESET, { method: "DELETE" });
  expect(bare.status).toBe(400);
  expect(resetPersonal).not.toHaveBeenCalled();
  expect(erase).not.toHaveBeenCalled();
});

test("personal reset: runs for the session's tenant only, reports it, never touches the full erase", async () => {
  const { app, erase, resetPersonal } = appWith("user-123");

  const res = await app.request(
    RESET,
    erasePost({
      confirm: "RESET-PERSONAL",
      expectedOwner: "user-123",
      tenantId: "user-999",
      userId: "user-999",
    }),
  );

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ erased: [{ table: "personal.vaults", rows: 1 }] });
  expect(resetPersonal).toHaveBeenCalledTimes(1);
  expect(resetPersonal).toHaveBeenCalledWith("user-123");
  expect(erase).not.toHaveBeenCalled();
});

test("the full erase refuses the reset's confirm value", async () => {
  const { app, erase } = appWith("user-123");
  const res = await app.request("/api/account/data", erasePost({ confirm: "RESET-PERSONAL" }));
  expect(res.status).toBe(400);
  expect(erase).not.toHaveBeenCalled();
});

test("personal reset: a missing or non-string expectedOwner is a 400 and deletes nothing", async () => {
  const { app, resetPersonal } = appWith("user-123");
  for (const expectedOwner of [undefined, "", 123, null, ["user-123"]]) {
    const res = await app.request(RESET, erasePost({ confirm: "RESET-PERSONAL", expectedOwner }));
    expect(res.status, JSON.stringify(expectedOwner)).toBe(400);
  }
  expect(resetPersonal).not.toHaveBeenCalled();
});

test("personal reset: a stale tab (expectedOwner differs from the session) gets 409 and nothing is deleted", async () => {
  const { app, resetPersonal, erase } = appWith("user-B");
  const res = await app.request(
    RESET,
    erasePost({ confirm: "RESET-PERSONAL", expectedOwner: "user-A" }),
  );
  expect(res.status).toBe(409);
  expect(await res.json()).toMatchObject({ code: "owner-changed" });
  expect(resetPersonal).not.toHaveBeenCalled();
  expect(erase).not.toHaveBeenCalled();
});

test("personal reset: matching expectedOwner deletes the session's tenant", async () => {
  const { app, resetPersonal } = appWith("user-123");
  const res = await app.request(
    RESET,
    erasePost({ confirm: "RESET-PERSONAL", expectedOwner: "user-123" }),
  );
  expect(res.status).toBe(200);
  expect(resetPersonal).toHaveBeenCalledWith("user-123");
});

import { expect, test, vi } from "vitest";
import { Hono } from "hono";
import { registerNetWorthRoutes } from "./net-worth-routes.js";

const TODAY = "2026-09-29";

function appWith(tenantId: string | null) {
  const put = vi.fn(async () => undefined);
  const deleteAll = vi.fn(async () => undefined);
  const app = new Hono();
  registerNetWorthRoutes(app, {
    tenantId: async () => tenantId,
    repository: () => ({ put, deleteAll }),
    today: () => TODAY,
  });
  return { app, put, deleteAll };
}

const putRequest = (body: unknown) => ({
  method: "PUT",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const validBody = { date: "2026-09-15", totalCents: 123_456_78, currency: "EUR" };

test("an anonymous caller cannot store a total", async () => {
  const { app, put } = appWith(null);
  const res = await app.request("/api/personal/net-worth-total", putRequest(validBody));
  expect(res.status).toBe(401);
  expect(put).not.toHaveBeenCalled();
});

test("a valid total is stored for the session's own tenant", async () => {
  const { app, put } = appWith("user-123");
  const res = await app.request("/api/personal/net-worth-total", putRequest(validBody));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ stored: true });
  expect(put).toHaveBeenCalledWith("2026-09-15", 123_456_78);
});

test("a malformed date is refused", async () => {
  const { app, put } = appWith("user-123");
  for (const date of ["2026-13-40", "15-09-2026", "2026/09/15", "", 123, undefined]) {
    const res = await app.request(
      "/api/personal/net-worth-total",
      putRequest({ ...validBody, date }),
    );
    expect(res.status, JSON.stringify(date)).toBe(400);
  }
  expect(put).not.toHaveBeenCalled();
});

test("a date in the future is refused", async () => {
  const { app, put } = appWith("user-123");
  const res = await app.request(
    "/api/personal/net-worth-total",
    putRequest({ ...validBody, date: "2026-09-30" }),
  );
  expect(res.status).toBe(400);
  expect(put).not.toHaveBeenCalled();
});

test("today's date is accepted", async () => {
  const { app, put } = appWith("user-123");
  const res = await app.request(
    "/api/personal/net-worth-total",
    putRequest({ ...validBody, date: TODAY }),
  );
  expect(res.status).toBe(200);
  expect(put).toHaveBeenCalledWith(TODAY, validBody.totalCents);
});

test("a non-EUR currency is refused", async () => {
  const { app, put } = appWith("user-123");
  const res = await app.request(
    "/api/personal/net-worth-total",
    putRequest({ ...validBody, currency: "USD" }),
  );
  expect(res.status).toBe(400);
  expect(put).not.toHaveBeenCalled();
});

test("a non-integer or out-of-bound totalCents is refused", async () => {
  const { app, put } = appWith("user-123");
  for (const totalCents of [1.5, "100", Number.NaN, 2_000_000_000_000, -2_000_000_000_000]) {
    const res = await app.request(
      "/api/personal/net-worth-total",
      putRequest({ ...validBody, totalCents }),
    );
    expect(res.status, JSON.stringify(totalCents)).toBe(400);
  }
  expect(put).not.toHaveBeenCalled();
});

test("a negative total (debts exceeding assets) is accepted", async () => {
  const { app, put } = appWith("user-123");
  const res = await app.request(
    "/api/personal/net-worth-total",
    putRequest({ ...validBody, totalCents: -50_000 }),
  );
  expect(res.status).toBe(200);
  expect(put).toHaveBeenCalledWith(validBody.date, -50_000);
});

test("a malformed JSON body is refused, not crashed on", async () => {
  const { app, put } = appWith("user-123");
  const res = await app.request("/api/personal/net-worth-total", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: "not-json",
  });
  expect(res.status).toBe(400);
  expect(put).not.toHaveBeenCalled();
});

test("an anonymous caller cannot delete anyone's totals", async () => {
  const { app, deleteAll } = appWith(null);
  const res = await app.request("/api/personal/net-worth-total", { method: "DELETE" });
  expect(res.status).toBe(401);
  expect(deleteAll).not.toHaveBeenCalled();
});

test("deleting removes every stored total for the session's own tenant", async () => {
  const { app, deleteAll } = appWith("user-123");
  const res = await app.request("/api/personal/net-worth-total", { method: "DELETE" });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ deleted: true });
  expect(deleteAll).toHaveBeenCalledOnce();
});

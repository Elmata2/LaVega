import { afterEach, expect, test, vi } from "vitest";
import { apiErrorMessage, categorizeTxs, SIGNED_OUT_MESSAGE } from "./api.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("a 401 rejects with the signed-out message, not the body's own error", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: "unauthorized" }),
    }),
  );
  await expect(categorizeTxs([])).rejects.toThrow(SIGNED_OUT_MESSAGE);
});

test("a non-401 error still prefers the body's {error} over the status fallback", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "server kapot" }),
    }),
  );
  await expect(categorizeTxs([])).rejects.toThrow("server kapot");
});

test("a non-401 error with an unparseable body falls back to the status message", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => {
        throw new SyntaxError("not json");
      },
    }),
  );
  await expect(categorizeTxs([])).rejects.toThrow("Verzoek mislukt (500).");
});

test("apiErrorMessage reads a problems list the way it reads an error string", async () => {
  const res = new Response(
    JSON.stringify({ problems: ["Bevestig met confirm", "niet terug te draaien"] }),
    {
      status: 400,
      headers: { "content-type": "application/json" },
    },
  );
  expect(await apiErrorMessage(res)).toBe("Bevestig met confirm niet terug te draaien");
});

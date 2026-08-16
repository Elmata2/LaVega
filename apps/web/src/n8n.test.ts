// @vitest-environment jsdom
import { beforeEach, expect, test } from "vitest";
import { fetchQueue, parseQueue, pendingToInvoice, toPending, type N8nInvoiceRow } from "./n8n.js";
import {
  addHandledInvoiceMessageIds,
  getHandledInvoiceMessageIds,
  getN8nInvoiceToken,
  getN8nInvoiceUrl,
  setN8nInvoiceToken,
  setN8nInvoiceUrl,
} from "./settings.js";

beforeEach(() => {
  localStorage.clear();
});

const ROW = {
  source: "gmail",
  messageId: "abc123",
  subject: "Factuur juli",
  invoiceNumber: "2026-0042",
  issueDate: "2026-07-01",
  dueDate: "2026-07-31",
  amountCents: 12_100,
  vatCents: 2_100,
  currency: "EUR",
  counterparty: "ACME BV",
  direction: "expense",
};

/** A fetch stand-in: no network, exact status/body control. */
function fakeFetch(status: number, body: unknown, opts: { throws?: boolean; badJson?: boolean } = {}) {
  const calls: Array<{ url: string; token: string | undefined }> = [];
  const impl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, token: (init?.headers as Record<string, string> | undefined)?.["x-lavega-token"] });
    if (opts.throws) throw new TypeError("Failed to fetch");
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (opts.badJson) throw new SyntaxError("Unexpected token");
        return body;
      },
    };
  }) as unknown as typeof fetch;
  return { impl, calls };
}

test("parseQueue reads the documented shape and maps every field", () => {
  const parsed = parseQueue({ invoices: [ROW], servedAt: "2026-08-16T09:00:00Z" });
  expect(parsed).not.toBeNull();
  expect(parsed!.dropped).toBe(0);
  const row = parsed!.rows[0];
  expect(row.messageId).toBe("abc123");
  expect(row.amountCents).toBe(12_100);
  expect(row.vatCents).toBe(2_100);
  expect(row.direction).toBe("expense");
  expect(row.counterparty).toBe("ACME BV");
  expect(row.dueDate).toBe("2026-07-31");
});

test("an unstated VAT stays null — never 0", () => {
  const parsed = parseQueue({ invoices: [{ ...ROW, vatCents: null }] });
  expect(parsed!.rows[0].vatCents).toBeNull();
  // ...and it reaches the review row as an EMPTY field, not "0.00".
  expect(toPending(parsed!.rows[0], "BV1").vat).toBe("");
});

test("a row without a usable amount or messageId is counted, not silently swallowed", () => {
  const parsed = parseQueue({ invoices: [ROW, { ...ROW, messageId: "x", amountCents: null }, { messageId: "" }] });
  expect(parsed!.rows).toHaveLength(1);
  expect(parsed!.dropped).toBe(2);
});

test("a body that isn't the documented shape is a failure, not an empty queue", () => {
  expect(parseQueue({ message: "Workflow was started" })).toBeNull();
  expect(parseQueue("nope")).toBeNull();
  expect(parseQueue(null)).toBeNull();
  // An actually empty queue is a different thing and parses fine.
  expect(parseQueue({ invoices: [] })).toEqual({ rows: [], dropped: 0 });
});

test("fetchQueue sends the token in x-lavega-token and returns the rows", async () => {
  const { impl, calls } = fakeFetch(200, { invoices: [ROW] });
  const out = await fetchQueue("https://n8n.example/webhook/lavega-facturen", "sekret", impl);
  expect(out.kind).toBe("ok");
  expect(out.kind === "ok" && out.rows).toHaveLength(1);
  expect(calls[0].url).toBe("https://n8n.example/webhook/lavega-facturen");
  expect(calls[0].token).toBe("sekret");
});

test("every failure mode is its own outcome, and none of them is 'ok'", async () => {
  expect(await fetchQueue("", "", fakeFetch(200, {}).impl)).toEqual({ kind: "not-configured" });
  expect(await fetchQueue("https://x", "", fakeFetch(200, {}).impl)).toEqual({ kind: "not-configured" });
  expect(await fetchQueue("https://x", "t", fakeFetch(401, {}).impl)).toEqual({ kind: "unauthorized", status: 401 });
  expect(await fetchQueue("https://x", "t", fakeFetch(403, {}).impl)).toEqual({ kind: "unauthorized", status: 403 });
  expect(await fetchQueue("https://x", "t", fakeFetch(404, {}).impl)).toEqual({ kind: "http-error", status: 404 });
  expect(await fetchQueue("https://x", "t", fakeFetch(200, {}, { throws: true }).impl)).toEqual({ kind: "network" });
  expect(await fetchQueue("https://x", "t", fakeFetch(200, {}, { badJson: true }).impl)).toEqual({ kind: "unreadable" });
  expect(await fetchQueue("https://x", "t", fakeFetch(200, { ok: true }).impl)).toEqual({ kind: "unreadable" });
  // The empty queue IS ok — it just carries no rows.
  expect(await fetchQueue("https://x", "t", fakeFetch(200, { invoices: [] }).impl)).toEqual({ kind: "ok", rows: [], dropped: 0 });
});

test("pendingToInvoice refuses what it cannot know, and marks what a model read", () => {
  const row = parseQueue({ invoices: [{ ...ROW, dueDate: null }] })!.rows[0];
  const pending = toPending(row, "BV1");
  // n8n found no due date, and none is invented from the issue date.
  expect(pending.dueDate).toBe("");
  const blocked = pendingToInvoice(pending);
  expect(blocked.ok).toBe(false);
  expect(blocked.ok === false && blocked.error).toContain("vervaldatum");

  const done = pendingToInvoice({ ...pending, dueDate: "2026-07-31" });
  expect(done.ok).toBe(true);
  if (!done.ok) return;
  expect(done.invoice.amount).toBe(121);
  expect(done.invoice.vatAmount).toBe(21);
  expect(done.invoice.direction).toBe("out");
  expect(done.invoice.status).toBe("expected");
  expect(done.invoice.sourceType).toBe("llm");
  // The workflow reports no certainty of its own, so none is invented either.
  expect(done.invoice.confidence).toBeUndefined();
});

test("an empty VAT field stays unknown on the invoice instead of becoming zero", () => {
  const row: N8nInvoiceRow = { ...parseQueue({ invoices: [{ ...ROW, vatCents: null }] })!.rows[0] };
  const out = pendingToInvoice(toPending(row, "BV1"));
  expect(out.ok).toBe(true);
  expect(out.ok === true && out.invoice.vatAmount).toBeUndefined();
});

test("URL, token and handled ids are local preferences, and default to empty", () => {
  expect(getN8nInvoiceUrl()).toBe("");
  expect(getN8nInvoiceToken()).toBe("");
  expect(getHandledInvoiceMessageIds()).toEqual([]);
  setN8nInvoiceUrl("  https://n8n.example/webhook/x  ");
  setN8nInvoiceToken(" tok ");
  expect(getN8nInvoiceUrl()).toBe("https://n8n.example/webhook/x");
  expect(getN8nInvoiceToken()).toBe("tok");
  addHandledInvoiceMessageIds(["a", "b"]);
  addHandledInvoiceMessageIds(["b", "c"]);
  expect(getHandledInvoiceMessageIds()).toEqual(["a", "b", "c"]);
  // Nothing sensitive rides along: only the opaque ids are stored.
  expect(localStorage.getItem("lavega.n8nHandledMessageIds")).toBe('["a","b","c"]');
});

test("an unreadable currency stays empty and blocks the row — a USD invoice is never booked as euros", () => {
  const parsed = parseQueue({ invoices: [{ ...ROW, messageId: "m-cur", currency: "usd" }] });
  expect(parsed).not.toBeNull();
  expect(parsed!.rows[0].currency).toBe(""); // not silently "EUR"

  const pending = toPending(parsed!.rows[0], "BV1");
  const blocked = pendingToInvoice(pending);
  expect(blocked.ok).toBe(false);
  if (!blocked.ok) expect(blocked.error).toContain("valuta");

  // ...and it books once he says which currency it is.
  const done = pendingToInvoice({ ...pending, currency: "usd" });
  expect(done.ok).toBe(true);
  if (done.ok) expect(done.invoice.currency).toBe("USD"); // normalised, not rejected
});

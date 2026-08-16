/* Pulling invoices out of the owner's OWN n8n (docs/n8n/FACTUREN.md).
 *
 * The path is: his mailbox -> his n8n -> this browser. The LaVega server is not
 * in it, so nothing here talks to API_BASE; the browser calls his webhook
 * directly with the token he stored under Koppelingen.
 *
 * The one fact everything below is shaped around: the webhook EMPTIES its queue
 * as it responds. One GET, one copy. So this module never throws data away —
 * a row that fails validation is REPORTED (dropped count), not silently
 * skipped, and the caller keeps the rows until the owner has decided on each.
 */

import type { Invoice } from "@lavega/core";
import { makeInvoice } from "@lavega/core";

/** One invoice as the n8n workflow's "Naar LaVega-vorm" node emits it. */
export type N8nInvoiceRow = {
  messageId: string;
  subject?: string;
  invoiceNumber?: string;
  /** ISO or null — Claude reports null when the invoice showed no such date. */
  issueDate: string | null;
  dueDate: string | null;
  amountCents: number;
  /** null = the VAT was not stated. NOT zero: an unstated VAT is unknown. */
  vatCents: number | null;
  currency: string;
  counterparty: string | null;
  direction: "income" | "expense";
  note?: string;
};

/** What a GET on the webhook ended in. Every failure is its own kind — none of
 *  them may be presented as a success. */
export type FetchOutcome =
  | { kind: "ok"; rows: N8nInvoiceRow[]; dropped: number }
  | { kind: "not-configured" }
  | { kind: "unauthorized"; status: number }
  | { kind: "http-error"; status: number }
  | { kind: "network" }
  | { kind: "unreadable" };

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}
function isoDate(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}
function cents(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
}

/**
 * Read the webhook's body. Returns `null` when the body isn't the documented
 * shape at all (that is a failure, not an empty queue). Rows that are missing
 * the two things an invoice cannot exist without — a messageId to dedup on and
 * an amount — are counted in `dropped` so the UI can say so out loud rather
 * than booking a zero.
 */
export function parseQueue(body: unknown): { rows: N8nInvoiceRow[]; dropped: number } | null {
  if (!body || typeof body !== "object") return null;
  const list = (body as { invoices?: unknown }).invoices;
  if (!Array.isArray(list)) return null;

  const rows: N8nInvoiceRow[] = [];
  let dropped = 0;
  for (const raw of list) {
    if (!raw || typeof raw !== "object") {
      dropped++;
      continue;
    }
    const r = raw as Record<string, unknown>;
    const messageId = str(r.messageId);
    const amountCents = cents(r.amountCents);
    if (!messageId || amountCents === null || amountCents <= 0) {
      dropped++;
      continue;
    }
    const currency = str(r.currency);
    rows.push({
      messageId,
      subject: str(r.subject) ?? undefined,
      invoiceNumber: str(r.invoiceNumber) ?? undefined,
      issueDate: isoDate(r.issueDate),
      dueDate: isoDate(r.dueDate),
      amountCents,
      vatCents: cents(r.vatCents),
      // An unreadable currency stays EMPTY, never "EUR". A USD invoice booked as
      // euros is not a formatting slip, it is a wrong number in a bookkeeping —
      // and the owner would see a plausible "EUR" with nothing to warn him.
      currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : "",
      counterparty: str(r.counterparty),
      direction: r.direction === "income" ? "income" : "expense",
      note: str(r.note) ?? undefined,
    });
  }
  return { rows, dropped };
}

/**
 * GET the queue from his n8n. `fetchImpl` is injectable so the review flow can
 * be tested without a network.
 */
export async function fetchQueue(
  url: string,
  token: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<FetchOutcome> {
  if (!url.trim() || !token.trim()) return { kind: "not-configured" };
  let res: Response;
  try {
    res = await fetchImpl(url.trim(), {
      method: "GET",
      headers: { "x-lavega-token": token.trim() },
    });
  } catch {
    return { kind: "network" };
  }
  if (res.status === 401 || res.status === 403) return { kind: "unauthorized", status: res.status };
  if (!res.ok) return { kind: "http-error", status: res.status };
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { kind: "unreadable" };
  }
  const parsed = parseQueue(body);
  if (!parsed) return { kind: "unreadable" };
  return { kind: "ok", rows: parsed.rows, dropped: parsed.dropped };
}

/** An n8n row while the owner is still reviewing it. Strings, because these are
 *  the exact contents of the inputs he is editing — nothing is parsed into an
 *  Invoice until he presses Bevestigen. */
export type PendingInvoice = {
  messageId: string;
  subject?: string;
  note?: string;
  entity: string;
  direction: Invoice["direction"];
  counterparty: string;
  invoiceNumber: string;
  issueDate: string;
  /** Empty when n8n found no due date. Deliberately NOT pre-filled with the
   *  issue date: that would invent a payment term the invoice never stated. */
  dueDate: string;
  amount: string;
  /** Empty = the VAT is unknown, which is not the same as zero. */
  vat: string;
  currency: string;
};

/** n8n row -> review row. `entity` is a LaVega concept the mailbox knows
 *  nothing about, so it starts at the app's default and he picks the BV. */
export function toPending(row: N8nInvoiceRow, defaultEntity: string): PendingInvoice {
  return {
    messageId: row.messageId,
    subject: row.subject,
    note: row.note,
    entity: defaultEntity,
    direction: row.direction === "income" ? "in" : "out",
    counterparty: row.counterparty ?? "",
    invoiceNumber: row.invoiceNumber ?? "",
    issueDate: row.issueDate ?? "",
    dueDate: row.dueDate ?? "",
    amount: (row.amountCents / 100).toFixed(2),
    vat: row.vatCents === null ? "" : (row.vatCents / 100).toFixed(2),
    currency: row.currency,
  };
}

/** Turn a reviewed row into a real Invoice, or say exactly what is missing.
 *  `sourceType: "llm"` because a model read this out of an e-mail — it must
 *  stay distinguishable from something he typed himself. No confidence is set:
 *  the workflow reports none, and a fabricated one would be a lie. */
export function pendingToInvoice(p: PendingInvoice): { ok: true; invoice: Invoice } | { ok: false; error: string } {
  const counterparty = p.counterparty.trim();
  if (!counterparty) return { ok: false, error: "Vul een relatie in." };
  if (!p.issueDate) return { ok: false, error: "Vul een factuurdatum in." };
  if (!p.dueDate) return { ok: false, error: "Vul een vervaldatum in — n8n vond er geen." };
  const amount = Number(p.amount.replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "Vul een geldig bedrag in." };
  const currency = p.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { ok: false, error: "Vul de valuta in — n8n las er geen, en LaVega gokt geen euro's." };
  const vatRaw = p.vat.trim();
  const vat = vatRaw === "" ? undefined : Number(vatRaw.replace(",", "."));
  if (vat !== undefined && (!Number.isFinite(vat) || vat < 0)) return { ok: false, error: "Btw-bedrag klopt niet." };
  return {
    ok: true,
    invoice: makeInvoice({
      entity: p.entity,
      direction: p.direction,
      counterparty,
      invoiceNumber: p.invoiceNumber.trim() || undefined,
      issueDate: p.issueDate,
      dueDate: p.dueDate,
      amount,
      currency,
      status: "expected",
      sourceType: "llm",
      vatAmount: vat,
    }),
  };
}

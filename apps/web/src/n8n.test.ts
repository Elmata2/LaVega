// @vitest-environment jsdom
import { beforeEach, expect, test } from "vitest";
import {
  autoBookDecision,
  bookingEntity,
  fetchQueue,
  forgetAutoBooked,
  getAutoBookedInvoices,
  parseQueue,
  pendingToInvoice,
  rememberAutoBooked,
  toPending,
  NOTICE_LABELS,
  AUTO_BOOK_CEILING_CENTS,
  type N8nInvoiceRow,
} from "./n8n.js";
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
  expect(parseQueue({ invoices: [] })).toEqual({ rows: [], notices: [], dropped: 0 });
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
  expect(await fetchQueue("https://x", "t", fakeFetch(200, { invoices: [] }).impl)).toEqual({ kind: "ok", rows: [], notices: [], dropped: 0 });
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

/* ── meldingen: wat n8n niet als factuur kon aanleveren ──────────────────── */

const NOTICE = {
  messageId: "kpn-77213",
  subject: "Uw factuur van augustus staat voor u klaar",
  from: "KPN <noreply@kpn.com>",
  receivedAt: "2026-08-14T02:31:02.000Z",
  kind: "notification",
  reason: "De factuur staat in MijnKPN; log in om hem te downloaden.",
  mailUrl: "https://mail.google.com/mail/u/0/#all/kpn-77213",
};

test("a notice survives the parse and carries no amount at all", () => {
  const parsed = parseQueue({ invoices: [ROW], notices: [NOTICE] });
  expect(parsed!.notices).toHaveLength(1);
  const notice = parsed!.notices[0];
  expect(notice.kind).toBe("notification");
  expect(notice.mailUrl).toBe("https://mail.google.com/mail/u/0/#all/kpn-77213");
  // The safety property: there is no field to book.
  expect("amount" in notice).toBe(false);
  expect("amountCents" in notice).toBe(false);
});

test("a workflow that sends no notices is not an error — the owner hasn't re-imported yet", () => {
  expect(parseQueue({ invoices: [ROW] })!.notices).toEqual([]);
  expect(parseQueue({ invoices: [], notices: "nope" })!.notices).toEqual([]);
});

test("a notice without a messageId or with an unknown kind is not shown at all", () => {
  const parsed = parseQueue({
    invoices: [],
    notices: [{ ...NOTICE, messageId: "" }, { ...NOTICE, kind: "iets-nieuws" }],
  });
  expect(parsed!.notices).toEqual([]);
});

test("a link that does not go to his own mailbox is dropped, not shown", () => {
  const parsed = parseQueue({
    invoices: [],
    notices: [{ ...NOTICE, mailUrl: "https://kpn-facturen.example.com/betaal-nu" }],
  });
  expect(parsed!.notices[0].mailUrl).toBe("");
});

test("every notice kind has a Dutch label", () => {
  for (const kind of ["notification", "reminder", "no-amount", "unreadable"] as const) {
    expect(NOTICE_LABELS[kind].length).toBeGreaterThan(0);
  }
});

test("fetchQueue hands the notices through", async () => {
  const { impl } = fakeFetch(200, { invoices: [ROW], notices: [NOTICE] });
  const out = await fetchQueue("https://n8n.example/webhook/lavega-facturen", "sekret", impl);
  expect(out.kind === "ok" && out.notices).toHaveLength(1);
});

/* ── Herkomst en de grens van wat zichzelf mag boeken ──────────────────────
 *
 * Twee handelingen die niet hetzelfde zijn:
 *   BOEKEN   — van een mail een financieel record maken. Dat komt in zijn
 *              administratie en in zijn btw-cijfers.
 *   KOPPELEN — een geboekte factuur aan een banktransactie hangen. Dat doet
 *              reconcileInvoices al, omkeerbaar, zonder klik.
 *
 * Alleen het eerste is gevaarlijk: wie het doorstuuradres kent, kan iets in zijn
 * boeken proberen te krijgen. `senderCheck` is precies het signaal dat die
 * poging moet doorstaan. */

const FORWARDED = {
  ...ROW,
  source: "forward",
  from: "facturen@acme.nl",
  deliveredTo: "facturen@lavega.dev",
  queueKey: "facturen",
  senderCheck: "passed",
  senderChecks: { spf: "pass", dkim: "pass", dmarc: "none" },
};

test("parseQueue neemt de herkomst over in plaats van hem te laten vallen", () => {
  const row = parseQueue({ invoices: [FORWARDED] })!.rows[0];
  expect(row.from).toBe("facturen@acme.nl");
  expect(row.deliveredTo).toBe("facturen@lavega.dev");
  expect(row.senderCheck).toBe("passed");
  expect(row.senderChecks).toEqual({ spf: "pass", dkim: "pass", dmarc: "none" });
});

test("een regel zonder afzendercontrole krijgt 'unknown', nooit 'passed'", () => {
  // Gmail-regels dragen deze velden met opzet niet: er wás geen doorstuuradres.
  // Afwezig mag nooit als goedgekeurd binnenkomen.
  const row = parseQueue({ invoices: [ROW] })!.rows[0];
  expect(row.senderCheck).toBe("unknown");
  expect(row.deliveredTo).toBeUndefined();
  // En een verzonnen waarde ook niet.
  expect(parseQueue({ invoices: [{ ...FORWARDED, senderCheck: "prima hoor" }] })!.rows[0].senderCheck).toBe("unknown");
});

test("autoBookDecision: geverifieerde afzender + complete factuur + één onderneming = boekt zichzelf", () => {
  const row = parseQueue({ invoices: [FORWARDED] })!.rows[0];
  expect(autoBookDecision(row, { entityChoices: ["BV1"], defaultEntity: "BV1" })).toEqual({ book: true });
});

test("autoBookDecision: een afzender die de controle niet haalt of niet had, boekt niets", () => {
  const failed = parseQueue({ invoices: [{ ...FORWARDED, senderCheck: "failed", senderChecks: { spf: "fail", dkim: "fail", dmarc: "fail" } }] })!.rows[0];
  const d1 = autoBookDecision(failed, { entityChoices: ["BV1"], defaultEntity: "BV1" });
  expect(d1.book).toBe(false);
  expect(d1.book === false && d1.reason).toContain("SPF");

  const unchecked = parseQueue({ invoices: [ROW] })!.rows[0];
  const d2 = autoBookDecision(unchecked, { entityChoices: ["BV1"], defaultEntity: "BV1" });
  expect(d2.book).toBe(false);
  expect(d2.book === false && d2.reason).toContain("geen afzendercontrole");
});

test("autoBookDecision: zonder ondernemingen valt er niets te gokken, dus knijpt de poort niet", () => {
  // Een zzp'er met één rekening heeft geen entiteiten opgegeven. Nul keuzes is
  // GEEN openstaande vraag — het is het antwoord: alles staat op hem. De eis
  // "precies één" hield hem hier tegen op een keuze die niet bestond.
  const row = parseQueue({ invoices: [FORWARDED] })!.rows[0];
  expect(autoBookDecision(row, { entityChoices: [], defaultEntity: "Persoonlijk" })).toEqual({ book: true });
});

test("bookingEntity: de poort en de boeking gebruiken dezelfde regel", () => {
  // Als deze twee ooit uit elkaar lopen komt een factuur op de verkeerde BV
  // terecht, en dat is precies wat de poort moest voorkomen. Eén functie dus.
  expect(bookingEntity({ entityChoices: ["BV1"], defaultEntity: "Persoonlijk" })).toBe("BV1");
  expect(bookingEntity({ entityChoices: [], defaultEntity: "Persoonlijk" })).toBe("Persoonlijk");
});

test("autoBookDecision: bij meer dan één onderneming wordt er niet gegokt welke BV", () => {
  const row = parseQueue({ invoices: [FORWARDED] })!.rows[0];
  const d = autoBookDecision(row, { entityChoices: ["BV1", "BV2"], defaultEntity: "BV1" });
  expect(d.book).toBe(false);
  expect(d.book === false && d.reason).toContain("onderneming");
});

test("autoBookDecision: een incomplete factuur boekt niet, en noemt precies wat er mist", () => {
  const noDue = parseQueue({ invoices: [{ ...FORWARDED, dueDate: null }] })!.rows[0];
  const d1 = autoBookDecision(noDue, { entityChoices: ["BV1"], defaultEntity: "BV1" });
  expect(d1.book === false && d1.reason).toContain("vervaldatum");

  const noCcy = parseQueue({ invoices: [{ ...FORWARDED, currency: "euro's" }] })!.rows[0];
  const d2 = autoBookDecision(noCcy, { entityChoices: ["BV1"], defaultEntity: "BV1" });
  expect(d2.book === false && d2.reason).toContain("valuta");

  const noCp = parseQueue({ invoices: [{ ...FORWARDED, counterparty: null }] })!.rows[0];
  const d3 = autoBookDecision(noCp, { entityChoices: ["BV1"], defaultEntity: "BV1" });
  expect(d3.book === false && d3.reason).toContain("relatie");
});

test("de lijst automatisch geboekte facturen overleeft een herlaad en is te wissen", () => {
  expect(getAutoBookedInvoices()).toEqual([]);
  rememberAutoBooked({ invoiceId: "inv-1", messageId: "msg-1", subject: "Factuur juli" });
  rememberAutoBooked({ invoiceId: "inv-1", messageId: "msg-1", subject: "Factuur juli" }); // idempotent
  rememberAutoBooked({ invoiceId: "inv-2", messageId: "msg-2" });
  expect(getAutoBookedInvoices().map((a) => a.invoiceId)).toEqual(["inv-1", "inv-2"]);
  expect(getAutoBookedInvoices()[0].subject).toBe("Factuur juli");
  forgetAutoBooked("inv-1");
  expect(getAutoBookedInvoices().map((a) => a.invoiceId)).toEqual(["inv-2"]);
});

/** Een geverifieerde rij zoals de app hem krijgt: via parseQueue, niet met de hand
 *  in elkaar gezet — anders test dit een vorm die de app nooit ziet. */
function verifiedRow(over: Partial<N8nInvoiceRow>): N8nInvoiceRow {
  const row = parseQueue({ invoices: [FORWARDED] })!.rows[0];
  return { ...row, ...over };
}

/* HET PLAFOND VAN € 10.000 — zijn grens van 20 augustus.
 *
 * De enige rem die niet over de HERKOMST van de mail gaat maar over de SCHADE: een
 * geverifieerde afzender kan een correcte factuur sturen met een fout bedrag.
 */
test("boven het plafond boekt niets zichzelf, ook niet van een geverifieerde afzender", () => {
  const ctx = { entityChoices: ["BV1"], defaultEntity: "BV1" };
  const onder = autoBookDecision(verifiedRow({ amountCents: AUTO_BOOK_CEILING_CENTS }), ctx);
  expect(onder.book).toBe(true);
  const boven = autoBookDecision(verifiedRow({ amountCents: AUTO_BOOK_CEILING_CENTS + 1 }), ctx);
  // Expliciet narrowen: AutoBookDecision is een union en een expect() vertelt de
  // typechecker niets. Zonder dit compileert de test niet, en dat is de bedoeling
  // van die union — de reden bestaat alleen als er niet geboekt wordt.
  if (boven.book) throw new Error("verwacht dat het plafond dit tegenhoudt");
  expect(boven.reason).toContain("10.000");
});

test("bij een gespoofte afzender gaat het over de afzender, niet over het bedrag", () => {
  // De volgorde van de poorten bepaalt welke melding hij leest, en bij een
  // nagemaakte afzender van € 50.000 is "de afzender klopt niet" het nuttige feit.
  const d = autoBookDecision(
    { ...verifiedRow({ amountCents: 5_000_000 }), senderCheck: "failed", senderChecks: { spf: "fail", dkim: "fail", dmarc: "fail" } },
    { entityChoices: ["BV1"], defaultEntity: "BV1" },
  );
  if (d.book) throw new Error("verwacht dat een gespoofte afzender dit tegenhoudt");
  expect(d.reason).toContain("afzender");
  expect(d.reason).not.toContain("10.000");
});

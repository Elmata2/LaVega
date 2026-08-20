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

/** Where a row came in, and whether the sending domain survived the mail
 *  authentication checks Cloudflare ran on it.
 *
 *  A row from the FORWARDING address carries all of this; a row pulled from
 *  Gmail carries none of it, because there was no forwarding address and no SPF
 *  verdict — absent is the honest shape of "not applicable", and `senderCheck`
 *  then reads `unknown`.
 *
 *  `senderCheck: "passed"` means the mail really came from that domain. It is
 *  NOT an approval of the invoice: a real mail from a real supplier can still
 *  carry a fake invoice. Nothing here is ever called `verified`. */
export type SenderCheck = "passed" | "failed" | "unknown";
export type SenderChecks = { spf: string; dkim: string; dmarc: string };

/** One invoice as the n8n workflow's "Naar LaVega-vorm" node emits it. */
export type N8nInvoiceRow = {
  messageId: string;
  subject?: string;
  /** Who sent it — NOT verified. On a forwarded mail this is him, not the
   *  supplier; the supplier comes out of the invoice as `counterparty`. */
  from?: string;
  /** The full address the mail arrived on. Absent for a Gmail row. */
  deliveredTo?: string;
  queueKey?: string;
  /** Never "passed" by default: an absent verdict is `unknown`. */
  senderCheck: SenderCheck;
  /** The literal SPF/DKIM/DMARC verdicts, or undefined when there were none. */
  senderChecks?: SenderChecks;
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

/** A mail the workflow could NOT turn into an invoice but refuses to drop
 *  silently: a "your invoice is ready, log in" notice, a dunning letter, an
 *  invoice whose amount the model could not read, or a mail with nothing
 *  readable in it at all.
 *
 *  Note what is NOT in this type: an amount. Not optional, not nullable —
 *  absent. A notice is therefore structurally incapable of becoming a booked
 *  row, which is a stronger guarantee than any validation. It is a to-do:
 *  "something is waiting, go and get it yourself".
 *
 *  `mailUrl` points at HIS OWN mailbox, never at the link inside the mail. That
 *  link arrives from outside, is often single-use, and a fake invoice looks
 *  exactly like a real one. */
export type N8nNotice = {
  messageId: string;
  subject?: string;
  from?: string;
  receivedAt?: string;
  kind: "notification" | "reminder" | "no-amount" | "unreadable";
  reason: string;
  /** Empty when the workflow had no messageId to build one from. Never guessed. */
  mailUrl: string;
};

/** What a GET on the webhook ended in. Every failure is its own kind — none of
 *  them may be presented as a success. */
export type FetchOutcome =
  | { kind: "ok"; rows: N8nInvoiceRow[]; notices: N8nNotice[]; dropped: number }
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
const NOTICE_KINDS: N8nNotice["kind"][] = ["notification", "reminder", "no-amount", "unreadable"];

/** The sender verdict, read the same way `normalizeInboundMail` writes it:
 *  anything that is not literally "passed" or "failed" is `unknown`. A missing
 *  field, a typo and a hostile value all land there — never on "passed". */
function senderCheckOf(v: unknown): SenderCheck {
  return v === "passed" || v === "failed" ? v : "unknown";
}

/** The three literal verdicts, only when there were any. Undefined stays
 *  undefined: three fabricated "unknown"s would claim a check happened. */
function senderChecksOf(v: unknown): SenderChecks | undefined {
  if (!v || typeof v !== "object") return undefined;
  const o = v as Record<string, unknown>;
  const spf = str(o.spf), dkim = str(o.dkim), dmarc = str(o.dmarc);
  if (!spf && !dkim && !dmarc) return undefined;
  return { spf: spf ?? "unknown", dkim: dkim ?? "unknown", dmarc: dmarc ?? "unknown" };
}

/** What the owner reads above each notice. Kept here, next to the type, so a
 *  new kind cannot reach the screen without a label. */
export const NOTICE_LABELS: Record<N8nNotice["kind"], string> = {
  notification: "Staat klaar bij de leverancier",
  reminder: "Herinnering of aanmaning",
  "no-amount": "Factuur zonder leesbaar bedrag",
  unreadable: "Niets leesbaars in deze mail",
};

/**
 * The `notices` half of the same body. An older workflow that doesn't send them
 * yields an empty list — that is not an error, it is a workflow that hasn't been
 * re-imported yet.
 */
function parseNotices(body: unknown): N8nNotice[] {
  const list = (body as { notices?: unknown }).notices;
  if (!Array.isArray(list)) return [];
  const notices: N8nNotice[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const messageId = str(r.messageId);
    const kind = NOTICE_KINDS.find((k) => k === r.kind);
    // Without a messageId there is nothing to mark as handled, so it would
    // reappear every hour forever; without a kind we don't know what to say.
    if (!messageId || !kind) continue;
    notices.push({
      messageId,
      subject: str(r.subject) ?? undefined,
      from: str(r.from) ?? undefined,
      receivedAt: str(r.receivedAt) ?? undefined,
      kind,
      reason: str(r.reason) ?? "n8n gaf geen reden mee.",
      mailUrl: str(r.mailUrl)?.startsWith("https://mail.google.com/") ? str(r.mailUrl)! : "",
    });
  }
  return notices;
}

export function parseQueue(body: unknown): { rows: N8nInvoiceRow[]; notices: N8nNotice[]; dropped: number } | null {
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
      from: str(r.from) ?? undefined,
      deliveredTo: str(r.deliveredTo) ?? undefined,
      queueKey: str(r.queueKey) ?? undefined,
      senderCheck: senderCheckOf(r.senderCheck),
      senderChecks: senderChecksOf(r.senderChecks),
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
  return { rows, notices: parseNotices(body), dropped };
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
  return { kind: "ok", rows: parsed.rows, notices: parsed.notices, dropped: parsed.dropped };
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
  /** Why THIS row did not book itself. Travels with the row (rather than living
   *  in the view's state) so navigating away and back keeps the explanation
   *  attached to the row it belongs to. Absent on a row that was never a
   *  candidate for booking itself. */
  waitReason?: string;
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

/* ── Wat mag zichzelf boeken, en waarom ────────────────────────────────────
 *
 * Hij vroeg: "I don't want the user to click on any of them or link it
 * themselves — I want it automatically linked for them." Dat zijn TWEE
 * handelingen, en ze verdienen niet hetzelfde vertrouwen:
 *
 *   1. BOEKEN — van een mail een financieel record maken. Dat komt in de
 *      administratie en in de btw-cijfers terecht.
 *   2. KOPPELEN — een geboekte factuur aan een banktransactie hangen.
 *      `reconcileInvoices` doet dat al: op bedrag binnen 1%, teken, een
 *      datumvenster en de naam óf het factuurnummer. Omkeerbaar, en er hoeft
 *      niemand op te klikken.
 *
 * (2) was al automatisch. (1) was het niet, en met goede reden: een
 * doorgestuurde mail komt van buiten, en wie het doorstuuradres kent kan iets
 * in zijn boeken proberen te krijgen. Dus blijft (1) een voorstel — TENZIJ de
 * drie dingen hieronder alle drie kloppen. Dan is er niets meer over om te
 * beslissen, en een klik vragen is dan alleen maar werk.
 *
 *   a. DE AFZENDER IS ECHT. `senderCheck === "passed"`: de mail kwam
 *      aantoonbaar van het domein dat hij noemt. "failed" is een gemarkeerd
 *      voorstel — nooit weggegooid, want een echte factuur van een domein met
 *      een slordig SPF-record mag niet stil verdwijnen. "unknown" is óók een
 *      voorstel: er is geen controle geweest, en dat is geen goedkeuring.
 *   b. DE ONDERNEMING IS GEEN KEUZE. Bij meer dan één BV is "welke entiteit"
 *      een echte vraag, en een verkeerd toegewezen factuur zit scheef in de
 *      btw. Eén optie = niets te kiezen; meer = één keer vragen.
 *   c. DE FACTUUR IS COMPLEET. Precies de eis die `pendingToInvoice` al stelt:
 *      relatie, factuurdatum, vervaldatum, een geldig bedrag en een echte
 *      valuta. Er wordt niets bijverzonnen om de grens te halen.
 *
 * En wat wél automatisch gaat is OMKEERBAAR en ZICHTBAAR: het staat in de lijst
 * hieronder, de UI zegt dat het zichzelf boekte, en één klik zet hem op
 * geannuleerd — waarmee hij uit de prognose valt zonder dat het record
 * verdwijnt. Iets stils dat zijn boeken verandert is erger dan een klik.
 */

export type AutoBookDecision = { book: true } | { book: false; reason: string };

export function autoBookDecision(
  row: N8nInvoiceRow,
  ctx: { entityChoices: string[]; defaultEntity: string },
): AutoBookDecision {
  if (row.senderCheck === "failed") {
    const c = row.senderChecks;
    const detail = c ? ` (SPF ${c.spf}, DKIM ${c.dkim}, DMARC ${c.dmarc})` : "";
    return {
      book: false,
      reason: `De afzender kwam niet door de SPF/DKIM-controle${detail}. Dat kan een slordig ingesteld domein zijn óf een nagemaakte afzender — daarom boekt LaVega deze niet zelf. Controleer de regel en bevestig hem zelf.`,
    };
  }
  if (row.senderCheck !== "passed") {
    return {
      book: false,
      reason: "Bij deze mail is geen afzendercontrole gedaan — hij kwam niet via het doorstuuradres binnen. Geen controle is geen goedkeuring, dus deze wacht op jou.",
    };
  }
  if (ctx.entityChoices.length !== 1) {
    return {
      book: false,
      reason: "Je hebt meer dan één onderneming en de factuur zegt niet voor welke hij is. LaVega gokt geen entiteit — kies hem en bevestig.",
    };
  }
  const check = pendingToInvoice(toPending(row, ctx.entityChoices[0] || ctx.defaultEntity));
  if (!check.ok) return { book: false, reason: `${check.error} Zolang dat ontbreekt boekt LaVega niets automatisch.` };
  return { book: true };
}

/* ── De lijst van wat zichzelf geboekt heeft ───────────────────────────────
 *
 * Dit hoort eigenlijk als veld op `Invoice` in packages/core/src/model.ts —
 * dan reist het mee in de kluis en in een back-up. Dat bestand is van een
 * andere lane, dus staat het hier: een aparte localStorage-sleutel naast de
 * kluis, met alleen een id, het messageId en het onderwerp. Zonder deze lijst
 * is een automatisch geboekte factuur na één herlaad niet te onderscheiden van
 * een die hij zelf bevestigde, en dan is "zichtbaar automatisch gebeurd" een
 * belofte die maar één sessie meegaat.
 */

const AUTO_BOOKED_KEY = "lavega.n8n.autoBooked.v1";

export type AutoBookedInvoice = { invoiceId: string; messageId: string; subject?: string };

export function getAutoBookedInvoices(): AutoBookedInvoice[] {
  try {
    const raw = localStorage.getItem(AUTO_BOOKED_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((e): AutoBookedInvoice[] => {
      if (!e || typeof e !== "object") return [];
      const o = e as Record<string, unknown>;
      const invoiceId = str(o.invoiceId), messageId = str(o.messageId);
      if (!invoiceId || !messageId) return [];
      return [{ invoiceId, messageId, subject: str(o.subject) ?? undefined }];
    });
  } catch {
    return [];
  }
}

/** Idempotent: the same invoice logged twice stays one entry, so a re-render or
 *  a repeated fetch cannot inflate the list. */
export function rememberAutoBooked(entry: AutoBookedInvoice): void {
  const kept = getAutoBookedInvoices().filter((a) => a.invoiceId !== entry.invoiceId);
  try {
    localStorage.setItem(AUTO_BOOKED_KEY, JSON.stringify([...kept, entry]));
  } catch {
    /* a full or blocked localStorage must not break the booking itself */
  }
}

export function forgetAutoBooked(invoiceId: string): void {
  try {
    localStorage.setItem(AUTO_BOOKED_KEY, JSON.stringify(getAutoBookedInvoices().filter((a) => a.invoiceId !== invoiceId)));
  } catch {
    /* ignored, same reason */
  }
}

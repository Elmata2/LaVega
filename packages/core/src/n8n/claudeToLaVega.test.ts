import { expect, test } from "vitest";
import { gmailUrl, noticeForUnreadable, parseModelJson, toQueueEntry } from "./claudeToLaVega.js";

const MSG = {
  source: "gmail",
  messageId: "18f0abc0000",
  subject: "Factuur 2026-0184",
  from: "Van Dijk <facturen@vandijk-installatie.nl>",
  date: "2026-08-13T07:12:44.000Z",
};

const INVOICE_ANSWER = {
  isInvoice: true,
  kind: "invoice",
  invoiceNumber: "2026-0184",
  issueDate: "2026-08-13",
  dueDate: "2026-09-12",
  amount: 1815,
  vatAmount: 315,
  currency: "eur",
  counterparty: "Van Dijk Installatietechniek BV",
  direction: "expense",
  note: "Factuur met PDF-bijlage.",
};

test("een echte factuur wordt een regel in centen", () => {
  const entry = toQueueEntry(MSG, INVOICE_ANSWER);
  expect(entry.notice).toBeNull();
  expect(entry.dropped).toBeNull();
  expect(entry.invoice).toMatchObject({
    messageId: "18f0abc0000",
    invoiceNumber: "2026-0184",
    amountCents: 181500,
    vatCents: 31500,
    currency: "EUR",
    direction: "expense",
  });
});

test("geen valuta gelezen blijft null — nooit stilzwijgend EUR", () => {
  const entry = toQueueEntry(MSG, { ...INVOICE_ANSWER, currency: null });
  expect(entry.invoice?.currency).toBeNull();
});

test("een melding wordt een melding en heeft geen bedragveld — ook geen leeg", () => {
  const entry = toQueueEntry(MSG, {
    isInvoice: false,
    kind: "notification",
    amount: null,
    note: "De factuur staat klaar in MijnKPN; log in om hem te downloaden.",
  });
  expect(entry.invoice).toBeNull();
  expect(entry.notice).not.toBeNull();
  expect(entry.notice?.kind).toBe("notification");
  expect(entry.notice?.reason).toContain("MijnKPN");
  expect(entry.notice?.mailUrl).toBe("https://mail.google.com/mail/u/0/#all/18f0abc0000");
  // De hele veiligheid van een melding: er is geen bedrag om te boeken.
  expect("amount" in (entry.notice ?? {})).toBe(false);
  expect("amountCents" in (entry.notice ?? {})).toBe(false);
});

test("een aanmaning MET bedrag wordt geen tweede factuur", () => {
  const entry = toQueueEntry(MSG, {
    isInvoice: false,
    kind: "reminder",
    amount: 1815,
    currency: "EUR",
    invoiceNumber: "2026-0184",
    note: "Herinnering voor factuur 2026-0184.",
  });
  expect(entry.invoice).toBeNull();
  expect(entry.notice?.kind).toBe("reminder");
});

test("een aanmaning die zichzelf toch 'invoice' noemt wordt op isInvoice geweigerd", () => {
  const entry = toQueueEntry(MSG, { isInvoice: false, kind: "invoice", amount: 1815 });
  expect(entry.invoice).toBeNull();
  expect(entry.notice).toBeNull();
  expect(entry.dropped).toBe("geen factuur");
});

test("een betaalbewijs wordt geteld en weggelaten: het staat al in de bank", () => {
  const entry = toQueueEntry(MSG, { isInvoice: false, kind: "receipt", amount: 9.99 });
  expect(entry.invoice).toBeNull();
  expect(entry.notice).toBeNull();
  expect(entry.dropped).toBe("betaalbewijs");
});

test("factuur zonder bedrag wordt niet geboekt en niet weggegooid, maar gemeld", () => {
  const entry = toQueueEntry(MSG, { ...INVOICE_ANSWER, amount: null });
  expect(entry.invoice).toBeNull();
  expect(entry.notice?.kind).toBe("no-amount");
  expect(entry.dropped).toBeNull();
});

test("een negatief of nul bedrag telt niet als bedrag", () => {
  expect(toQueueEntry(MSG, { ...INVOICE_ANSWER, amount: 0 }).invoice).toBeNull();
  expect(toQueueEntry(MSG, { ...INVOICE_ANSWER, amount: -12 }).invoice).toBeNull();
});

test("een ontbrekende kind valt terug op isInvoice, niet op 'invoice'", () => {
  expect(toQueueEntry(MSG, { isInvoice: true, amount: 42 }).invoice?.amountCents).toBe(4200);
  expect(toQueueEntry(MSG, { isInvoice: false, amount: 42 }).dropped).toBe("geen factuur");
});

test("geen leesbaar antwoord is geen 'geen factuur' maar een melding", () => {
  const entry = toQueueEntry(MSG, parseModelJson("Sorry, ik kan hier niets mee."));
  expect(entry.notice?.kind).toBe("unreadable");
  expect(entry.invoice).toBeNull();
});

test("parseModelJson pakt het JSON-blok uit een antwoord met tekst eromheen", () => {
  expect(parseModelJson('Hier is het: {"isInvoice": true, "amount": 10} — succes')).toEqual({
    isInvoice: true,
    amount: 10,
  });
  expect(parseModelJson("{kapot")).toBeNull();
  expect(parseModelJson(undefined)).toBeNull();
});

test("een onleesbare mail wordt een melding met de reden uit de normalisatie", () => {
  const notice = noticeForUnreadable({
    ...MSG,
    subject: "Bon",
    reason: "Geen leesbare tekst en geen PDF-bijlage in dit bericht.",
  });
  expect(notice.kind).toBe("unreadable");
  expect(notice.reason).toBe(
    "Geen leesbare tekst en geen PDF-bijlage in dit bericht. Open hem zelf.",
  );
  expect(notice.mailUrl).toBe(gmailUrl(MSG.messageId));
});

test("zonder messageId is er geen link naar de mail, en dat wordt niet verzonnen", () => {
  expect(gmailUrl("")).toBe("");
});

/* ── Herkomst bij het doorstuuradres ──────────────────────────────────────── */

const INBOUND_MSG = {
  source: "inbound-mail",
  messageId: "<hn-2026-4412@hostingnoord.nl>",
  subject: "Factuur HN-2026-4412",
  from: "Hosting Noord <facturen@hostingnoord.nl>",
  date: "Mon, 17 Aug 2026 08:04:11 +0200",
  deliveredTo: "alexander-7f3a@invoices.lavega.dev",
  queueKey: "alexander-7f3a",
  senderCheck: "passed",
  senderChecks: { spf: "pass", dkim: "pass", dmarc: "pass" },
};

test("een doorgestuurde factuur draagt adres én afzender mee tot in de rij", () => {
  const entry = toQueueEntry(INBOUND_MSG, INVOICE_ANSWER);
  expect(entry.invoice).toMatchObject({
    source: "inbound-mail",
    from: "Hosting Noord <facturen@hostingnoord.nl>",
    deliveredTo: "alexander-7f3a@invoices.lavega.dev",
    queueKey: "alexander-7f3a",
    senderCheck: "passed",
    senderChecks: { spf: "pass", dkim: "pass", dmarc: "pass" },
  });
});

test("een afzender die SPF/DKIM niet haalt levert een gemarkeerde regel op, geen weggegooide", () => {
  const entry = toQueueEntry(
    {
      ...INBOUND_MSG,
      senderCheck: "failed",
      senderChecks: { spf: "fail", dkim: "fail", dmarc: "fail" },
    },
    INVOICE_ANSWER,
  );
  expect(entry.invoice?.senderCheck).toBe("failed");
  expect(entry.invoice?.amountCents).toBe(181500);
  expect(entry.dropped).toBeNull();
});

test("een onbekende senderCheck wordt 'unknown', nooit 'passed'", () => {
  const entry = toQueueEntry({ ...INBOUND_MSG, senderCheck: "prima hoor" }, INVOICE_ANSWER);
  expect(entry.invoice?.senderCheck).toBe("unknown");
});

test("een doorgestuurde mail krijgt GEEN Gmail-link: die zou nergens op uitkomen", () => {
  const entry = toQueueEntry(INBOUND_MSG, {
    isInvoice: false,
    kind: "notification",
    note: "Log in bij de leverancier.",
  });
  expect(entry.notice?.mailUrl).toBe("");
  expect(entry.notice?.deliveredTo).toBe("alexander-7f3a@invoices.lavega.dev");

  const unreadable = noticeForUnreadable({ ...INBOUND_MSG, reason: "Niets leesbaars." });
  expect(unreadable.mailUrl).toBe("");
  expect(unreadable.senderCheck).toBe("passed");
});

test("een Gmail-regel krijgt de herkomstvelden juist NIET: leeg zou suggereren dat we ze kwijt zijn", () => {
  const invoice = toQueueEntry(MSG, INVOICE_ANSWER).invoice ?? {};
  expect("deliveredTo" in invoice).toBe(false);
  expect("queueKey" in invoice).toBe(false);
  expect("senderCheck" in invoice).toBe(false);
  // De afzender staat er wél op, ook bij Gmail — die wisten we altijd al.
  expect(invoice).toMatchObject({ from: "Van Dijk <facturen@vandijk-installatie.nl>" });

  const notice = toQueueEntry(MSG, { isInvoice: false, kind: "notification" }).notice ?? {};
  expect("deliveredTo" in notice).toBe(false);
  expect(notice).toMatchObject({ mailUrl: "https://mail.google.com/mail/u/0/#all/18f0abc0000" });
});

test("een melding blijft ook mét herkomst zonder bedragveld", () => {
  const notice = toQueueEntry(INBOUND_MSG, { isInvoice: false, kind: "reminder" }).notice ?? {};
  expect("amount" in notice).toBe(false);
  expect("amountCents" in notice).toBe(false);
});

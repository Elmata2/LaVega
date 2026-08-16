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
  expect(notice.reason).toBe("Geen leesbare tekst en geen PDF-bijlage in dit bericht. Open hem zelf.");
  expect(notice.mailUrl).toBe(gmailUrl(MSG.messageId));
});

test("zonder messageId is er geen link naar de mail, en dat wordt niet verzonnen", () => {
  expect(gmailUrl("")).toBe("");
});

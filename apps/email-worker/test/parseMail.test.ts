import { expect, test } from "vitest";
import {
  base64ByteLength,
  base64ToBytes,
  bytesToBase64,
  decodeEncodedWords,
  latin1ToBytes,
  parseHeaders,
  parseMail,
} from "../src/parseMail.js";
import {
  PDF_BASE64_LINES,
  PDF_BINARY,
  RAW_HTML_ONLY,
  RAW_IMAGE_ONLY,
  RAW_PDF_INVOICE,
  RAW_PLAIN_TEXT,
} from "./rawMail.js";

test("A — genest multipart: tekst, HTML, logo en PDF komen elk op hun eigen plek", () => {
  const mail = parseMail(RAW_PDF_INVOICE);

  expect(mail.text).toContain("Zie de PDF voor de details");
  expect(mail.html).toContain("968,00");
  // De HTML gaat ONBEWERKT mee: het strippen gebeurt in packages/core, waar het
  // getest is. Twee keer strippen zou twee gedragingen betekenen.
  expect(mail.html).toContain("<table>");

  expect(mail.attachments.map((a) => a.mimeType)).toEqual(["image/png", "application/pdf"]);
  // RFC 2231: filename*=UTF-8''factuur%20augustus%202026.pdf
  expect(mail.attachments[1].fileName).toBe("factuur augustus 2026.pdf");
});

test("A — de PDF-bytes overleven het lezen letterlijk", () => {
  const mail = parseMail(RAW_PDF_INVOICE);
  const pdf = mail.attachments[1];
  // Een base64-deel wordt NIET gedecodeerd en opnieuw gecodeerd: de tekst die in
  // de mail stond gaat er zo weer uit, alleen zonder regelovergangen.
  expect(pdf.data).toBe(PDF_BASE64_LINES.replace(/\r?\n/g, ""));
  expect(new TextDecoder().decode(base64ToBytes(pdf.data))).toBe(PDF_BINARY);
  expect(pdf.bytes).toBe(PDF_BINARY.length);
});

test("A — een RFC 2047-onderwerp wordt leesbaar Nederlands", () => {
  expect(parseMail(RAW_PDF_INVOICE).subject).toBe("Factuur 2026-0207 — meterkast");
});

test("B — alleen HTML: text blijft leeg en dat is een feit, geen fout", () => {
  const mail = parseMail(RAW_HTML_ONLY);
  expect(mail.text).toBe("");
  expect(mail.html).toContain("180,69");
  // quoted-printable met een UTF-8-teken over twee bytes: =C3=AF is 'ï'.
  expect(mail.html).toContain("geïncasseerd");
  expect(mail.attachments).toEqual([]);
});

test("C — één platte tekst, geen multipart: niets wordt gestript", () => {
  const mail = parseMail(RAW_PLAIN_TEXT);
  expect(mail.text).toContain("290,40");
  // In text/plain is '<' gewoon een teken. Een tagfilter zou hier een gat slaan.
  expect(mail.text).toContain("10 < 12 maanden");
  expect(mail.html).toBe("");
  expect(mail.messageId).toBe("<hn-2026-4412@hostingnoord.nl>");
  expect(mail.from).toBe("Hosting Noord <facturen@hostingnoord.nl>");
});

test("D — alleen een afbeelding: geen tekst, wél een bijlage die zichtbaar geen PDF is", () => {
  const mail = parseMail(RAW_IMAGE_ONLY);
  expect(mail.text).toBe("");
  expect(mail.html).toBe("");
  expect(mail.attachments).toHaveLength(1);
  expect(mail.attachments[0].mimeType).toBe("image/png");
});

test("headers worden uitgevouwen; een tweede From: wint niet van de eerste", () => {
  const headers = parseHeaders(
    ["Subject: regel een", " en de rest", "From: echt@voorbeeld.nl", "From: nep@voorbeeld.nl"].join("\r\n"),
  );
  expect(headers.subject).toBe("regel een en de rest");
  expect(headers.from).toBe("echt@voorbeeld.nl");
});

test("decodeEncodedWords doet B en Q, en laat onbekende vormen staan", () => {
  expect(decodeEncodedWords("=?UTF-8?B?RmFjdHV1cg==?=")).toBe("Factuur");
  expect(decodeEncodedWords("=?utf-8?q?Factuur_augustus?=")).toBe("Factuur augustus");
  expect(decodeEncodedWords("Gewoon onderwerp")).toBe("Gewoon onderwerp");
  expect(decodeEncodedWords("=?UTF-8?X?onzin?=")).toBe("=?UTF-8?X?onzin?=");
});

test("base64 heen en terug, inclusief padding", () => {
  for (const text of ["", "A", "AB", "ABC", "ABCD", "%PDF-1.4 hallo"]) {
    const bytes = latin1ToBytes(text);
    const encoded = bytesToBase64(bytes);
    expect(new TextDecoder().decode(base64ToBytes(encoded))).toBe(text);
    expect(base64ByteLength(encoded)).toBe(text.length);
  }
});

test("een multipart zonder boundary levert géén delen op in plaats van rauwe MIME als tekst", () => {
  const mail = parseMail(
    ["Subject: kapot", "Content-Type: multipart/mixed", "", "--iets", "Content-Type: text/plain", "", "tekst", "--iets--", ""].join(
      "\r\n",
    ),
  );
  // Beter geen tekst dan boundaries als factuurtekst naar het model sturen. Dat
  // "geen tekst" wordt in packages/core een melding met een reden, niet stilte.
  expect(mail.text).toBe("");
  expect(mail.attachments).toEqual([]);
});

test("een bijlage zonder Content-Disposition maar met een naam telt als bijlage", () => {
  const mail = parseMail(
    [
      "Subject: bon",
      'Content-Type: multipart/mixed; boundary="b"',
      "",
      "--b",
      'Content-Type: application/pdf; name="bon.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      "JVBERi0=",
      "--b--",
      "",
    ].join("\r\n"),
  );
  expect(mail.attachments).toEqual([
    { fileName: "bon.pdf", mimeType: "application/pdf", data: "JVBERi0=", bytes: 5 },
  ]);
});

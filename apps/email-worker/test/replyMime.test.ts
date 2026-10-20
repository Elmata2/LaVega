import { expect, test } from "vitest";
import { buildReplyMime } from "../src/replyMime.js";
import { base64ToBytes } from "../src/parseMail.js";

const FIELDS = {
  from: "alexander-7f3a@invoices.lavega.dev",
  to: "facturen@hostingnoord.nl",
  subject: "Factuur HN-2026-4412",
  inReplyTo: "<hn-2026-4412@hostingnoord.nl>",
  body: "Deze mail is aangekomen maar er is niets aan de wachtrij toegevoegd.\nZie n8n → Executions.",
};

function bodyOf(raw: string): string {
  const parts = raw.split("\r\n\r\n");
  return new TextDecoder().decode(base64ToBytes(parts.slice(1).join("\r\n\r\n")));
}

test("de vier headers die Cloudflare eist staan erin", () => {
  const raw = buildReplyMime(FIELDS);
  expect(raw).not.toBeNull();
  expect(raw).toContain("From: alexander-7f3a@invoices.lavega.dev");
  expect(raw).toContain("To: facturen@hostingnoord.nl");
  expect(raw).toContain("In-Reply-To: <hn-2026-4412@hostingnoord.nl>");
  expect(raw).toContain("References: <hn-2026-4412@hostingnoord.nl>");
  expect(raw).toContain("Subject: Re: Factuur HN-2026-4412");
});

test("de tekst komt er ongeschonden weer uit, inclusief de pijl en de nieuwe regel", () => {
  expect(bodyOf(buildReplyMime(FIELDS) as string)).toBe(FIELDS.body);
});

test("geen Message-ID: buildReplyMime returns null (no reply)", () => {
  expect(buildReplyMime({ ...FIELDS, inReplyTo: "" })).toBeNull();
  expect(buildReplyMime({ ...FIELDS, inReplyTo: "   " })).toBeNull();
});

test("een onderwerp met accenten gaat als encoded-word mee, niet als 8-bits bytes", () => {
  const raw = buildReplyMime({ ...FIELDS, subject: "Factuur — geïncasseerd" }) as string;
  expect(raw).toContain("Subject: =?UTF-8?B?");
  expect(raw).not.toContain("geïncasseerd");
});

test("'Re:' wordt niet twee keer voorgezet", () => {
  const raw = buildReplyMime({ ...FIELDS, subject: "Re: Factuur" }) as string;
  expect(raw).toContain("Subject: Re: Factuur\r\n");
  expect(raw).not.toContain("Re: Re:");
});

test("de base64-body staat op regels van maximaal 76 tekens", () => {
  const raw = buildReplyMime({ ...FIELDS, body: "regel ".repeat(200) }) as string;
  const body = raw.split("\r\n\r\n").slice(1).join("\r\n\r\n");
  for (const line of body.split("\r\n")) expect(line.length).toBeLessThanOrEqual(76);
});

test("een nieuwe regel in een header wordt platgeslagen: geen header-injectie", () => {
  const raw = buildReplyMime({
    ...FIELDS,
    subject: "Factuur\r\nBcc: iemand@elders.example",
  }) as string;
  // De tekst mag in de onderwerpregel blijven staan; wat NIET mag is dat er een
  // eigen headerregel van wordt. Een onderwerp komt uit een mail van buiten.
  const headerLines = raw.split("\r\n\r\n")[0].split("\r\n");
  expect(headerLines.filter((line) => /^bcc:/i.test(line))).toEqual([]);
  expect(headerLines.filter((line) => line.startsWith("Subject:"))).toHaveLength(1);
});

/* ── M11: een losse CR in Message-ID is geen antwoord, maar een injectie ───── */

test("een losse CR of LF in de Message-ID: buildReplyMime returns null (no reply)", () => {
  // parseMail ziet een losse \r niet als regelscheiding, dus zo'n Message-ID
  // komt hier heel aan — en zou een `Bcc:` in onze eigen mail zetten. Weigeren,
  // niet repareren: dan valt de aanroeper terug op een bounce.
  expect(
    buildReplyMime({ ...FIELDS, inReplyTo: "<a\rBcc: slachtoffer@elders.example>" }),
  ).toBeNull();
  expect(
    buildReplyMime({ ...FIELDS, inReplyTo: "<a\nBcc: slachtoffer@elders.example>" }),
  ).toBeNull();
});

test("een regelovergang in From: buildReplyMime returns null (no reply)", () => {
  expect(buildReplyMime({ ...FIELDS, from: "ons@invoices.lavega.dev\r\nBcc: x@y" })).toBeNull();
});

test("een regelovergang in To wordt platgeslagen in plaats van doorgelaten", () => {
  const raw = buildReplyMime({
    ...FIELDS,
    to: "afzender@elders.example\r\nBcc: slachtoffer@elders.example",
  }) as string;
  const headerLines = raw.split("\r\n\r\n")[0].split("\r\n");
  expect(headerLines.filter((line) => /^bcc:/i.test(line))).toEqual([]);
  expect(headerLines.filter((line) => line.startsWith("To:"))).toHaveLength(1);
});

/* ── M13: het antwoord zegt dat het een automaat is ────────────────────────── */

test("het antwoord draagt Auto-Submitted en Precedence, tegen een mail-lus", () => {
  const raw = buildReplyMime(FIELDS) as string;
  expect(raw).toContain("Auto-Submitted: auto-replied");
  expect(raw).toContain("Precedence: bulk");
});

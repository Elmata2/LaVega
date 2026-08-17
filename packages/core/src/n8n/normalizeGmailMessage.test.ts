import { expect, test } from "vitest";
import { normalizeGmailMessage, MAX_TEXT_CHARS } from "./normalizeGmailMessage.js";
import { encodeBase64Url, simulateGmailNode, type GmailNodeItem } from "./__fixtures__/gmailNode.js";
import { RAW_HTML_ONLY, RAW_LINK_ONLY, RAW_NO_BODY, RAW_PDF_INVOICE } from "./__fixtures__/rawMail.js";
import { legacyNormalise } from "./__fixtures__/legacyNode.js";

/** Zoals de Gmail-node hem VÓÓR de fix leverde: Download Attachments stond
 *  buiten Options, dus n8n las de vlag nooit en `binary` bleef leeg. */
function brokenConfigItem(raw: string, id: string): GmailNodeItem {
  return simulateGmailNode(encodeBase64Url(raw), { id, downloadAttachments: false });
}

/** Zoals de node hem NA de fix levert (options.downloadAttachments = true). */
function fixedConfigItem(raw: string, id: string): GmailNodeItem {
  return simulateGmailNode(encodeBase64Url(raw), { id, downloadAttachments: true });
}

function toAttachments(item: GmailNodeItem) {
  return Object.keys(item.binary).map((key) => ({
    key,
    fileName: item.binary[key].fileName,
    mimeType: item.binary[key].mimeType,
    data: item.binary[key].data,
  }));
}

test("A — PDF-factuur: de bijlage komt mee en de tekst is de volledige HTML, niet het briefje ervoor", () => {
  const before = brokenConfigItem(RAW_PDF_INVOICE, "m-pdf");
  const after = fixedConfigItem(RAW_PDF_INVOICE, "m-pdf");

  const old = legacyNormalise(before);
  const now = normalizeGmailMessage(after.json, toAttachments(after));

  // eslint-disable-next-line no-console
  console.log(
    `[A pdf-factuur] voor: ${old.text.length} tekens, ${old.pdfs.length} PDF · ` +
      `na: ${now.text.length} tekens (${now.textSource}), ${now.pdfs.length} PDF`,
  );

  // VOOR: geen enkele bijlage, en alleen het korte text/plain-deel.
  expect(old.pdfs).toEqual([]);
  expect(old.text).toContain("Zie de PDF voor de details");
  expect(old.text).not.toContain("1.815,00");

  // NA: de PDF is er, en de tekst bevat de bedragen uit de HTML-tabel.
  expect(now.pdfs).toHaveLength(1);
  expect(now.pdfs[0].name).toBe("factuur-2026-0184.pdf");
  expect(now.pdfs[0].bytes).toBeGreaterThan(200);
  expect(now.text).toContain("1.815,00");
  expect(now.text).toContain("2026-0184");
  expect(now.textSource).toBe("html");
  expect(now.text.length).toBeGreaterThan(old.text.length * 2);
  expect(now.ok).toBe(true);
});

test("A — het logo staat vóór de factuur in binary, dus op attachment_0 vertrouwen mag niet", () => {
  const item = fixedConfigItem(RAW_PDF_INVOICE, "m-pdf");
  expect(item.binary.attachment_0.fileName).toBe("logo.png");
  expect(item.binary.attachment_1.fileName).toBe("factuur-2026-0184.pdf");

  const message = normalizeGmailMessage(item.json, toAttachments(item));
  expect(message.pdfs.map((p) => p.name)).toEqual(["factuur-2026-0184.pdf"]);
  expect(message.skipped).toEqual([]);
});

test("B — factuur die alleen in de HTML staat: vroeger leeg, nu de hele tekst", () => {
  const item = fixedConfigItem(RAW_HTML_ONLY, "m-html");
  const old = legacyNormalise(item);
  const now = normalizeGmailMessage(item.json, toAttachments(item));

  // eslint-disable-next-line no-console
  console.log(
    `[B html-only] voor: ${old.text.length} tekens, ok=${old.ok} · ` +
      `na: ${now.text.length} tekens (${now.textSource}), ok=${now.ok}`,
  );

  // mailparser zet géén `text` bij een mail zonder text/plain-deel.
  expect(item.json.text).toBeUndefined();
  expect(old.text).toBe("");
  expect(old.ok).toBe(false); // viel stil weg vóór het model

  expect(now.textSource).toBe("html");
  expect(now.text).toContain("180,69");
  expect(now.text).toContain("FN-2026-08-8831");
  expect(now.ok).toBe(true);
  // Het logo is geen factuur en gaat niet mee.
  expect(now.pdfs).toEqual([]);
});

test("C — melding met een link: leesbaar, dus het model mag er iets van vinden", () => {
  const item = fixedConfigItem(RAW_LINK_ONLY, "m-link");
  const now = normalizeGmailMessage(item.json, toAttachments(item));

  expect(now.ok).toBe(true);
  expect(now.pdfs).toEqual([]);
  expect(now.text).toContain("MijnKPN");
  expect(now.subject).toBe("Uw factuur van augustus staat voor u klaar");
  expect(now.from).toBe("KPN <noreply@kpn.com>");
});

test("D — mail zonder tekst en zonder PDF wordt niet stil overgeslagen maar krijgt een reden", () => {
  const item = fixedConfigItem(RAW_NO_BODY, "m-leeg");
  const now = normalizeGmailMessage(item.json, toAttachments(item));

  expect(now.ok).toBe(false);
  expect(now.textSource).toBe("none");
  expect(now.reason).toBe("Geen leesbare tekst en geen PDF-bijlage in dit bericht.");
  expect(now.messageId).toBe("m-leeg");
});

test("een korte text/plain naast een lange HTML: de langste wint", () => {
  const message = normalizeGmailMessage(
    {
      id: "m-kies",
      text: "Bekijk uw factuur online.",
      html: "<p>Factuurnummer 99</p><p>Totaal EUR 240,00 inclusief 21% btw, te voldoen voor 1 september.</p>",
    },
    [],
  );
  expect(message.textSource).toBe("html");
  expect(message.text).toContain("240,00");
});

test("platte tekst wordt niet door een tagfilter gehaald: '10 < 12' blijft staan", () => {
  const message = normalizeGmailMessage(
    { id: "m-plat", text: "Verbruik was 10 < 12 kWh en het totaal is EUR 42,00 voor deze maand." },
    [],
  );
  expect(message.textSource).toBe("text");
  expect(message.text).toContain("10 < 12 kWh");
});

test("een PDF die n8n niet kon meesturen wordt gemeld, niet weggelaten", () => {
  const message = normalizeGmailMessage({ id: "m-bin" }, [
    { key: "attachment_0", fileName: "factuur.pdf", mimeType: "application/pdf", data: "" },
  ]);
  expect(message.pdfs).toEqual([]);
  expect(message.skipped).toEqual([
    "factuur.pdf: n8n leverde geen inhoud (binaire opslag staat niet op default)",
  ]);
  expect(message.ok).toBe(false);
});

test("een PDF boven de limiet valt af met de reden erbij", () => {
  const tooBig = "A".repeat(Math.ceil((5 * 1024 * 1024 * 4) / 3));
  const message = normalizeGmailMessage({ id: "m-groot" }, [
    { key: "attachment_0", fileName: "jaarrekening.pdf", mimeType: "application/pdf", data: tooBig },
  ]);
  expect(message.pdfs).toEqual([]);
  expect(message.skipped[0]).toContain("groter dan de limiet van 4 MB");
});

test("meer dan drie PDF's: de rest valt af met reden, niet stilzwijgend", () => {
  const attachments = [1, 2, 3, 4, 5].map((n) => ({
    key: "attachment_" + n,
    fileName: "bijlage-" + n + ".pdf",
    mimeType: "application/pdf",
    data: "QQ==",
  }));
  const message = normalizeGmailMessage({ id: "m-veel" }, attachments);
  expect(message.pdfs).toHaveLength(3);
  expect(message.skipped).toHaveLength(2);
  expect(message.skipped[0]).toContain("meer dan 3 PDF-bijlagen");
});

test("een lange mail wordt afgekapt en zegt dat ook", () => {
  const long = "Factuurregel met een bedrag. ".repeat(400);
  const message = normalizeGmailMessage({ id: "m-lang", text: long }, []);
  expect(message.text.length).toBe(MAX_TEXT_CHARS);
  expect(message.truncated).toBe(true);
  expect(message.textChars).toBeGreaterThan(MAX_TEXT_CHARS);
});

test("een onbewerkte payload (Simplify aan) levert een uitleg in plaats van stilte", () => {
  const message = normalizeGmailMessage({ id: "m-raw", payload: { parts: [] } }, []);
  expect(message.ok).toBe(false);
  expect(message.reason).toContain("Simplify uit");
});

test("een verwijzing in plaats van base64 wordt geweigerd en gemeld, niet verstuurd", () => {
  // Wat n8n levert wanneer N8N_DEFAULT_BINARY_DATA_MODE niet op `default` staat:
  // `data` is dan een pad naar de opslag, geen inhoud. Dit ging eerder
  // ongecontroleerd mee en Claude antwoordde met "Invalid base64 data".
  const message = normalizeGmailMessage({ id: "m-ref" }, [
    {
      key: "attachment_0",
      fileName: "factuur.pdf",
      mimeType: "application/pdf",
      data: "filesystem-v2:workflows/abc/executions/123/binary_data/xyz",
    },
  ]);

  expect(message.pdfs).toEqual([]);
  expect(message.skipped[0]).toContain("geen base64");
  expect(message.skipped[0]).toContain("N8N_DEFAULT_BINARY_DATA_MODE");
});

test("echte base64 komt er gewoon door", () => {
  const real = Buffer.from("%PDF-1.4 hallo").toString("base64");
  const message = normalizeGmailMessage({ id: "m-ok" }, [
    { key: "attachment_0", fileName: "factuur.pdf", mimeType: "application/pdf", data: real },
  ]);

  expect(message.pdfs).toHaveLength(1);
  expect(message.pdfs[0].data).toBe(real);
  expect(message.skipped).toEqual([]);
});

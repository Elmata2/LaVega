/* Een stand-in voor de Gmail-node van n8n, zodat de normalisatie op ECHTE
 * mailvormen getest kan worden in plaats van op een verzonnen object.
 *
 * WAT DE ECHTE NODE DOET (n8n GmailV2, message:getAll, Simplify OFF):
 *   1. haalt het bericht op met `format=raw` — het hele RFC-2822-bericht,
 *      base64url-gecodeerd, in het veld `raw`;
 *   2. decodeert dat en laat mailparser's `simpleParser` erover lopen;
 *   3. bouwt het item opnieuw op uit id, threadId, labelIds en sizeEstimate
 *      plus wat mailparser vond: subject, from, to, date, text, html,
 *      textAsHtml, headers — en GEEN `snippet` en GEEN `payload`;
 *   4. zet de bijlagen in `item.binary` als `attachment_0`, `attachment_1`, …
 *      maar ALLEEN als `options.downloadAttachments` aan staat.
 *
 * `simulateGmailNode` hieronder doet stap 1 t/m 4 na, inclusief het recursief
 * doorlopen van geneste multipart-delen (multipart/alternative in
 * multipart/mixed) en het base64url-decoderen van de body.
 *
 * EERLIJK OVER DE GRENS HIERVAN: dit is niet mailparser, het is een nabouw van
 * de twee regels uit mailparser die ons raken (mail-parser.js:794-848):
 *   - `text` wordt alleen gevuld door een text/plain-deel, of door een
 *     text/html-deel dat ZELF het hele bericht is;
 *   - `textAsHtml` bestaat alleen als er `text` is.
 * Een mail met alleen een text/html-deel binnen een multipart levert dus `html`
 * en verder niets. Dat is precies de vorm waar de oude code op stukliep. Klopt
 * die aanname niet, dan kloppen deze fixtures ook niet — daarom staat de regel
 * hier met bron en al opgeschreven en niet impliciet in een objectliteral.
 */

/** Wat de Gmail-node per bericht doorgeeft. */
export type GmailNodeItem = {
  json: Record<string, unknown>;
  binary: Record<string, { fileName: string; mimeType: string; data: string }>;
};

/** Gmail levert `raw` base64url-gecodeerd; n8n decodeert dat. */
export function encodeBase64Url(text: string): string {
  return Buffer.from(text, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64").toString("utf8");
}

type MimePart = {
  headers: Record<string, string>;
  contentType: string;
  disposition: string;
  fileName: string;
  /** Gedecodeerde tekst voor text/*, ruwe base64 voor bijlagen. */
  body: string;
  parts: MimePart[];
  root: boolean;
};

function splitHeaders(block: string): Record<string, string> {
  const unfolded = block.replace(/\r?\n[ \t]+/g, " ");
  const headers: Record<string, string> = {};
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return headers;
}

function param(header: string, name: string): string {
  const match = header.match(new RegExp(name + '\\s*=\\s*"?([^";]+)"?', "i"));
  return match ? match[1] : "";
}

function decodeBody(raw: string, encoding: string): string {
  const enc = encoding.toLowerCase();
  if (enc === "base64") return Buffer.from(raw.replace(/\s+/g, ""), "base64").toString("utf8");
  if (enc === "quoted-printable") {
    return raw
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
  }
  return raw;
}

/** Recursief: multipart-delen nesten (alternative binnen mixed). */
function parseMime(message: string, root: boolean): MimePart {
  const split = message.search(/\r?\n\r?\n/);
  const headerBlock = split >= 0 ? message.slice(0, split) : message;
  const bodyStart = split >= 0 ? message.slice(split).replace(/^\r?\n\r?\n/, "") : "";
  const headers = splitHeaders(headerBlock);
  const contentType = (headers["content-type"] || "text/plain").toLowerCase();
  const disposition = (headers["content-disposition"] || "").toLowerCase();
  const part: MimePart = {
    headers,
    contentType: contentType.split(";")[0].trim(),
    disposition: disposition.split(";")[0].trim(),
    fileName: param(headers["content-disposition"] || "", "filename") || param(headers["content-type"] || "", "name"),
    body: "",
    parts: [],
    root,
  };

  if (part.contentType.startsWith("multipart/")) {
    const boundary = param(headers["content-type"] || "", "boundary");
    if (!boundary) return part;
    const chunks = bodyStart.split("--" + boundary);
    for (const chunk of chunks.slice(1)) {
      if (chunk.startsWith("--")) break; // sluitende boundary
      const child = chunk.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
      if (!child.trim()) continue;
      part.parts.push(parseMime(child, false));
    }
    return part;
  }

  const encoding = headers["content-transfer-encoding"] || "7bit";
  const isAttachment = part.disposition === "attachment" || part.fileName !== "";
  // Een bijlage houden we als base64 — dat is ook wat n8n uiteindelijk in
  // `binary[..].data` zet.
  part.body = isAttachment
    ? raw64(bodyStart, encoding)
    : decodeBody(bodyStart, encoding);
  return part;
}

function raw64(body: string, encoding: string): string {
  if (encoding.toLowerCase() === "base64") return body.replace(/\s+/g, "");
  return Buffer.from(body, "utf8").toString("base64");
}

function walk(part: MimePart, visit: (p: MimePart) => void): void {
  visit(part);
  for (const child of part.parts) walk(child, visit);
}

/**
 * Het item zoals de Gmail-node het emit, uit een base64url-gecodeerd ruw
 * bericht — precies de weg die n8n aflegt.
 */
export function simulateGmailNode(
  rawBase64Url: string,
  options: { id?: string; downloadAttachments?: boolean } = {},
): GmailNodeItem {
  const raw = decodeBase64Url(rawBase64Url);
  const root = parseMime(raw, true);

  const textParts: string[] = [];
  const htmlParts: string[] = [];
  const attachments: { fileName: string; mimeType: string; data: string }[] = [];
  walk(root, (part) => {
    const isAttachment = part.disposition === "attachment" || (part.fileName !== "" && !part.contentType.startsWith("multipart/"));
    if (isAttachment) {
      attachments.push({ fileName: part.fileName, mimeType: part.contentType, data: part.body });
      return;
    }
    if (part.contentType === "text/plain") textParts.push(part.body);
    else if (part.contentType === "text/html") htmlParts.push(part.body);
  });

  const htmlIsWholeMessage = root.contentType === "text/html";
  const text =
    textParts.length > 0
      ? textParts.join("\n").trim()
      : htmlIsWholeMessage
        ? htmlParts.join("\n").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
        : "";

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(root.headers)) {
    // mailparser zet in `headers` de HELE regel, niet alleen de waarde.
    headers[key] = key.replace(/(^|-)([a-z])/g, (_m, dash: string, ch: string) => dash + ch.toUpperCase()) + ": " + value;
  }

  const json: Record<string, unknown> = {
    id: options.id ?? "18f0abc0000",
    threadId: options.id ?? "18f0abc0000",
    labelIds: ["INBOX"],
    sizeEstimate: raw.length,
    subject: root.headers.subject ?? "",
    from: { value: [{ address: root.headers.from ?? "", name: "" }], text: root.headers.from ?? "" },
    to: { value: [{ address: root.headers.to ?? "", name: "" }], text: root.headers.to ?? "" },
    date: root.headers.date ?? "",
    messageId: root.headers["message-id"] ?? "",
    headers,
  };
  if (htmlParts.length > 0) json.html = htmlParts.join("\n");
  // mailparser vult text/textAsHtml alleen als er tekst gevonden is.
  if (text.length > 0) {
    json.text = text;
    json.textAsHtml = "<p>" + text.replace(/\n/g, "<br/>") + "</p>";
  }

  const binary: GmailNodeItem["binary"] = {};
  if (options.downloadAttachments !== false) {
    attachments.forEach((attachment, index) => {
      binary["attachment_" + index] = attachment;
    });
  }
  return { json, binary };
}

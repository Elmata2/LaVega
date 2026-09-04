/* MIME → {subject, from, date, text, html, attachments[]}.
 *
 * PUUR. Geen fetch, geen bindings, geen Date.now — één string erin, één object
 * eruit. Dat is de hele reden dat dit een eigen bestand is: het is het enige
 * deel van de Worker dat je zonder Cloudflare kunt testen, en het is ook het
 * deel waar de fouten zitten.
 *
 * DE INVOER IS EEN LATIN1-STRING, geen UTF-8-string. `latin1` is de enige
 * codering waarin één byte precies één teken wordt, dus een base64-bijlage
 * overleeft het lezen ongeschonden. Wie hier `utf-8` van maakt, sloopt elke PDF
 * en merkt het pas als Anthropic "Invalid base64 data" terugstuurt.
 *
 * WAT DIT WEL DOET:
 *   - headers uitvouwen (een regel die met spatie of tab begint hoort bij de
 *     vorige) en op naam opzoeken, hoofdletterongevoelig;
 *   - multipart recursief doorlopen, inclusief nesting
 *     (multipart/mixed → multipart/alternative);
 *   - base64 en quoted-printable decoderen, 7bit/8bit/binary ongemoeid laten;
 *   - text/plain en text/html apart bijhouden en met de juiste charset naar
 *     tekst omzetten;
 *   - bijlagen als base64 teruggeven — bij een base64-deel letterlijk de bytes
 *     die er stonden, zonder ze te decoderen en opnieuw te coderen;
 *   - RFC 2047 (`=?UTF-8?B?...?=`) in Subject en From, want een Nederlandse
 *     onderwerpregel staat er bijna altijd zo in;
 *   - RFC 2231 (`filename*=UTF-8''factuur%20augustus.pdf`).
 *
 * WAT DIT NIET DOET, met opzet:
 *   - message/rfc822-delen uitpakken. Een doorgestuurde mail als bijlage
 *     ("forward as attachment") levert dus geen PDF op. Dat is zichtbaar: er
 *     komt geen bijlage mee, en de melding in LaVega zegt dat er geen PDF was.
 *     Nooit stil.
 *   - S/MIME of PGP openen.
 */

export type ParsedAttachment = {
  fileName: string;
  mimeType: string;
  /** De bytes als base64, zoals de n8n-webhook ze verwacht. */
  data: string;
  /** Het echte aantal bytes, niet de base64-lengte. */
  bytes: number;
};

export type ParsedMail = {
  subject: string;
  from: string;
  date: string;
  messageId: string;
  /** Samengevoegde text/plain-delen. Leeg als er geen was. */
  text: string;
  /** Samengevoegde text/html-delen. Leeg als er geen was. */
  html: string;
  attachments: ParsedAttachment[];
  /** Alle top-level headers, kleine letters, uitgevouwen. */
  headers: Record<string, string>;
};

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** latin1-string → bytes. Eén teken is één byte; dat is de hele afspraak. */
export function latin1ToBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/** bytes → base64, zonder afhankelijkheden en zonder de stack op te blazen. */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < bytes.length ? B64_ALPHABET[b2 & 0x3f] : "=";
  }
  return out;
}

/** base64 → bytes. Tekens die er niet in horen (regelovergangen) vallen weg. */
export function base64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, "");
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let index = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    acc = (acc << 6) | B64_ALPHABET.indexOf(clean[i]);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[index++] = (acc >> bits) & 0xff;
    }
  }
  return bytes.subarray(0, index);
}

/** Hoeveel echte bytes zitten er in deze base64? Zonder te decoderen. */
export function base64ByteLength(text: string): number {
  const clean = text.replace(/[^A-Za-z0-9+/=]/g, "");
  if (clean.length === 0) return 0;
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  return Math.floor((clean.length * 3) / 4) - padding;
}

function decodeQuotedPrintable(body: string): Uint8Array {
  const withoutSoftBreaks = body.replace(/=\r?\n/g, "");
  const out: number[] = [];
  for (let i = 0; i < withoutSoftBreaks.length; i++) {
    const ch = withoutSoftBreaks[i];
    if (ch === "=" && /^[0-9A-Fa-f]{2}$/.test(withoutSoftBreaks.slice(i + 1, i + 3))) {
      out.push(parseInt(withoutSoftBreaks.slice(i + 1, i + 3), 16));
      i += 2;
      continue;
    }
    out.push(ch.charCodeAt(0) & 0xff);
  }
  return new Uint8Array(out);
}

/** Bytes → tekst in de opgegeven charset. Een charset die deze runtime niet
 *  kent is geen reden om de mail te laten vallen: dan leest hij hem als UTF-8
 *  en gaat er hooguit een accent verloren. */
function decodeText(bytes: Uint8Array, charset: string): string {
  try {
    return new TextDecoder(charset || "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/** Een parameter uit een header lezen: `name="waarde"` of `name=waarde`. */
export function headerParam(header: string, name: string): string {
  const quoted = header.match(new RegExp(name + '\\s*=\\s*"([^"]*)"', "i"));
  if (quoted) return quoted[1];
  const bare = header.match(new RegExp(name + "\\s*=\\s*([^;\\s]+)", "i"));
  return bare ? bare[1] : "";
}

/**
 * RFC 2231: `filename*=UTF-8''factuur%20augustus.pdf`. Zonder dit heet elke
 * bijlage met een spatie of accent in de naam iets onleesbaars, en dat staat
 * straks in de melding die hij moet begrijpen.
 */
function extendedParam(header: string, name: string): string {
  const match = header.match(new RegExp(name + "\\*\\s*=\\s*([^;]+)", "i"));
  if (!match) return "";
  const value = match[1].trim().replace(/^"|"$/g, "");
  const parts = value.split("'");
  const encoded = parts.length >= 3 ? parts.slice(2).join("'") : value;
  const charset = parts.length >= 3 ? parts[0] : "utf-8";
  const bytes = new Uint8Array(
    (encoded.match(/%[0-9A-Fa-f]{2}|[\s\S]/g) ?? []).map((token) =>
      token.startsWith("%") ? parseInt(token.slice(1), 16) : token.charCodeAt(0) & 0xff,
    ),
  );
  return decodeText(bytes, charset);
}

/**
 * RFC 2047: `=?UTF-8?B?VGVzdA==?=` en `=?ISO-8859-1?Q?Factuur_ma=E9?=`.
 * Alleen op headers gebruiken, nooit op een body.
 */
export function decodeEncodedWords(value: string): string {
  return value.replace(
    /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (whole, charset: string, kind: string, data: string) => {
      try {
        const bytes =
          kind.toLowerCase() === "b"
            ? base64ToBytes(data)
            : decodeQuotedPrintable(data.replace(/_/g, " "));
        return decodeText(bytes, charset);
      } catch {
        return whole;
      }
    },
  );
}

/** Headers uitvouwen en op kleine letters indexeren. */
export function parseHeaders(block: string): Record<string, string> {
  const unfolded = block.replace(/\r?\n[ \t]+/g, " ");
  const headers: Record<string, string> = {};
  for (const line of unfolded.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    // Bij een dubbele header wint de eerste: dat is wat een mailclient toont,
    // en een tweede From: is een bekende spoof-truc.
    if (!(name in headers)) headers[name] = value;
  }
  return headers;
}

type Part = {
  headers: Record<string, string>;
  contentType: string;
  disposition: string;
  fileName: string;
  charset: string;
  encoding: string;
  /** De ruwe latin1-body van dit deel. Leeg bij een multipart-deel. */
  body: string;
  parts: Part[];
};

function splitHeaderAndBody(message: string): { headerBlock: string; body: string } {
  const match = message.match(/\r?\n\r?\n/);
  if (!match || match.index === undefined) return { headerBlock: message, body: "" };
  return {
    headerBlock: message.slice(0, match.index),
    body: message.slice(match.index + match[0].length),
  };
}

function parsePart(message: string): Part {
  const { headerBlock, body } = splitHeaderAndBody(message);
  const headers = parseHeaders(headerBlock);
  const contentTypeHeader = headers["content-type"] || "text/plain";
  const dispositionHeader = headers["content-disposition"] || "";
  const part: Part = {
    headers,
    contentType: contentTypeHeader.split(";")[0].trim().toLowerCase(),
    disposition: dispositionHeader.split(";")[0].trim().toLowerCase(),
    fileName:
      extendedParam(dispositionHeader, "filename") ||
      headerParam(dispositionHeader, "filename") ||
      extendedParam(contentTypeHeader, "name") ||
      headerParam(contentTypeHeader, "name"),
    charset: headerParam(contentTypeHeader, "charset").toLowerCase(),
    encoding: (headers["content-transfer-encoding"] || "7bit").trim().toLowerCase(),
    body: "",
    parts: [],
  };
  if (part.fileName) part.fileName = decodeEncodedWords(part.fileName);

  if (part.contentType.startsWith("multipart/")) {
    const boundary = headerParam(contentTypeHeader, "boundary");
    // Een multipart zonder boundary is kapot. Hem als tekst behandelen zou de
    // rauwe MIME als "de mail" doorsturen; dan leest het model boundaries in
    // plaats van een factuur. Liever geen delen dan verkeerde delen.
    if (!boundary) return part;
    const chunks = body.split("--" + boundary);
    for (const chunk of chunks.slice(1)) {
      if (chunk.startsWith("--")) break; // de sluitende boundary
      const child = chunk.replace(/^\r?\n/, "").replace(/\r?\n$/, "");
      if (!child.trim()) continue;
      part.parts.push(parsePart(child));
    }
    return part;
  }

  part.body = body;
  return part;
}

function isAttachment(part: Part): boolean {
  if (part.contentType.startsWith("multipart/")) return false;
  if (part.disposition === "attachment") return true;
  // Een inline plaatje met een bestandsnaam (het logo in een handtekening) is
  // óók een bijlage. Het wordt verderop weggefilterd omdat het geen PDF is.
  if (part.fileName) return true;
  return part.contentType !== "text/plain" && part.contentType !== "text/html";
}

function walk(part: Part, visit: (p: Part) => void): void {
  visit(part);
  for (const child of part.parts) walk(child, visit);
}

/**
 * @param rawLatin1 het hele RFC-5322-bericht, één teken per byte.
 */
export function parseMail(rawLatin1: string): ParsedMail {
  const root = parsePart(rawLatin1);

  const textParts: string[] = [];
  const htmlParts: string[] = [];
  const attachments: ParsedAttachment[] = [];

  walk(root, (part) => {
    if (part.contentType.startsWith("multipart/")) return;
    if (isAttachment(part)) {
      const data =
        part.encoding === "base64"
          ? part.body.replace(/[^A-Za-z0-9+/=]/g, "")
          : bytesToBase64(
              part.encoding === "quoted-printable"
                ? decodeQuotedPrintable(part.body)
                : latin1ToBytes(part.body),
            );
      attachments.push({
        fileName: part.fileName,
        mimeType: part.contentType,
        data,
        bytes: base64ByteLength(data),
      });
      return;
    }
    const bytes =
      part.encoding === "base64"
        ? base64ToBytes(part.body)
        : part.encoding === "quoted-printable"
          ? decodeQuotedPrintable(part.body)
          : latin1ToBytes(part.body);
    const text = decodeText(bytes, part.charset);
    if (part.contentType === "text/html") htmlParts.push(text);
    else textParts.push(text);
  });

  return {
    subject: decodeEncodedWords(root.headers.subject || ""),
    from: decodeEncodedWords(root.headers.from || ""),
    date: root.headers.date || "",
    messageId: root.headers["message-id"] || "",
    text: textParts.join("\n").trim(),
    html: htmlParts.join("\n").trim(),
    attachments,
    headers: root.headers,
  };
}

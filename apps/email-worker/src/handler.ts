/* Wat er met een binnengekomen mail gebeurt — en wat er NOOIT gebeurt.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DE ENIGE REGEL DIE HIER ECHT TELT: er verdwijnt geen mail zonder dat de
 * afzender het hoort. Elke uitgang van `handleInboundEmail` is óf "hij staat in
 * de rij", óf een bounce, óf een antwoord. Er is geen vierde uitgang, en er is
 * geen `catch {}` dat er stilletjes een van maakt. Een doorgestuurde factuur die
 * spoorloos verdwijnt is het ergste wat dit systeem kan doen: hij denkt dat hij
 * hem heeft en gaat verder met zijn dag.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * De reden dat dit bestand losstaat van index.ts: `handleInboundEmail` raakt
 * geen platform-API. Het krijgt een bericht en een `fetch` en geeft een oordeel
 * terug. Daarmee is het volledig te testen zonder Cloudflare — en het uitvoeren
 * van dat oordeel (`applyVerdict`, dus setReject en reply) is zo kort gehouden
 * dat er nauwelijks iets in kan fout gaan wat alleen in productie blijkt.
 *
 * Elke weigering NOEMT DE OORZAAK: welke variabele leeg is, welk bestand te
 * groot was, welke status n8n gaf. "Er ging iets mis" is hier verboden — de
 * afzender ziet die tekst in zijn bounce en moet er iets mee kunnen.
 */

import { parseAuthResults, localPartOf, type SenderChecks } from "./authResults.js";
import { parseMail, type ParsedMail } from "./parseMail.js";
import { buildReplyMime } from "./replyMime.js";
import type { Env, ForwardableEmailMessage } from "./types.js";

/** Claude weigert documenten boven ongeveer deze grootte — dezelfde grens als
 *  in packages/core/src/n8n/normalizeGmailMessage.js. */
export const MAX_PDF_BYTES = 4 * 1024 * 1024;

/** Meer dan drie PDF's in één mail is bijna altijd een nieuwsbrief. */
export const MAX_PDFS = 3;

/**
 * De grens op het HELE bericht, en waar dat getal vandaan komt: drie bijlagen
 * van 4 MiB zijn op de lijn base64, en base64 is 4/3 van de bytes — dus 16 MiB
 * — plus 1 MiB voor headers, tekst en een logo. Meer dan dit kán geen mail zijn
 * die aan de bijlage-limieten voldoet, dus die weigeren we VÓÓR het lezen. Dat
 * is de enige controle die zonder de mail in het geheugen te trekken kan.
 */
export const MAX_MESSAGE_BYTES = Math.ceil((MAX_PDFS * MAX_PDF_BYTES * 4) / 3) + 1024 * 1024;

/** De header waarmee de Worker zich bij de n8n-webhook legitimeert.
 *
 *  Dit MOET `x-lavega-token` zijn, dezelfde naam die LaVega's provisioning
 *  gebruikt (TOKEN_HEADER in apps/web/src/n8n-provision.ts). Reden: n8n weigert
 *  een workflow te activeren zolang één van zijn webhook-nodes een credential
 *  mist die hij zegt nodig te hebben, dus dezelfde Header Auth-credential wordt
 *  aan BEIDE webhooks gehangen — "E-mail binnen" en "LaVega vraagt de rij op".
 *  Eén credential betekent één headernaam. Stond hier eerder
 *  `x-lavega-mail-token`, waardoor n8n elke doorgestuurde factuur zou weigeren
 *  en de bounce hieronder bovendien de verkeerde header noemde. */
export const SECRET_HEADER = "x-lavega-token";

export type Verdict =
  /** In de wachtrij van n8n. De mail is geaccepteerd en er is niets te melden. */
  | { kind: "queued"; detail: string }
  /** Weigeren op SMTP-niveau. De verzendende server maakt er een bounce van. */
  | { kind: "reject"; reason: string }
  /** Antwoorden. Voor het geval dat de mail wél verwerkt is maar er niets in de
   *  rij belandde — weigeren zou dan onwaar zijn, en zwijgen oneerlijk. */
  | { kind: "reply"; body: string; subject: string; inReplyTo: string };

export type Deps = {
  fetch: typeof fetch;
  /** Alleen aanwezig om `reply` te kunnen testen zonder `cloudflare:email`. */
  makeReply?: (from: string, to: string, raw: string) => unknown;
};

/** Wat er naar de n8n-webhook gaat. Eén mail, één POST. De veldnamen zijn het
 *  contract met packages/core/src/n8n/normalizeInboundMail.js. */
export type InboundPayload = {
  to: string;
  queueKey: string;
  from: string;
  subject: string;
  date: string;
  messageId: string;
  text: string;
  html: string;
  auth: SenderChecks;
  attachments: { fileName: string; mimeType: string; data: string }[];
};

function short(text: string, max = 300): string {
  const clean = String(text).replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max) + "…" : clean;
}

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

async function readRaw(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      // rawSize is al gecontroleerd; dit is de vangnetgrens voor het geval die
      // waarde niet klopt. Stoppen met een fout, niet met een halve mail.
      if (total > limit)
        throw new Error("het bericht bleek tijdens het lezen groter dan " + mb(limit));
      chunks.push(value);
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** bytes → latin1-string, één teken per byte. Zie de kop van parseMail.ts. */
function bytesToLatin1(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return out;
}

/**
 * De bijlage-limieten, mét de bestandsnaam erin. Dit gebeurt in de Worker en
 * niet alleen in packages/core, want alleen hier kunnen we de afzender nog iets
 * vertellen: in n8n zou de bijlage met een reden in `skipped` verdwijnen en zou
 * híj moeten opmerken dat er iets ontbrak.
 */
export function checkAttachmentCaps(mail: ParsedMail): string | null {
  const pdfs = mail.attachments.filter(
    (a) => a.mimeType === "application/pdf" || /\.pdf$/i.test(a.fileName),
  );
  for (const pdf of pdfs) {
    if (pdf.bytes > MAX_PDF_BYTES) {
      return (
        "de bijlage " +
        (pdf.fileName || "(zonder naam)") +
        " is " +
        mb(pdf.bytes) +
        "; de grens is " +
        mb(MAX_PDF_BYTES) +
        " per PDF. Stuur hem apart of verklein hem."
      );
    }
  }
  if (pdfs.length > MAX_PDFS) {
    return (
      "deze mail heeft " +
      pdfs.length +
      " PDF-bijlagen; de grens is " +
      MAX_PDFS +
      " per bericht. Stuur de facturen in aparte mails."
    );
  }
  return null;
}

export function buildPayload(message: ForwardableEmailMessage, mail: ParsedMail): InboundPayload {
  return {
    to: message.to,
    queueKey: localPartOf(message.to),
    // De From:-header als die er is, anders de envelop-afzender. Let op wat dit
    // BETEKENT bij doorsturen: dan is dit zijn eigen adres, niet dat van de
    // leverancier. De leverancier komt uit de factuur zelf (`counterparty`).
    from: mail.from || message.from,
    subject: mail.subject,
    date: mail.date,
    messageId: mail.messageId,
    text: mail.text,
    html: mail.html,
    auth: parseAuthResults(message.headers.get("Authentication-Results")),
    attachments: mail.attachments.map((a) => ({
      fileName: a.fileName,
      mimeType: a.mimeType,
      data: a.data,
    })),
  };
}

/**
 * Het hele oordeel over één mail. Raakt geen platform-API, dus volledig te
 * testen: geef een nagemaakt bericht en een nagemaakte `fetch` mee.
 */
export async function handleInboundEmail(
  message: ForwardableEmailMessage,
  env: Env,
  deps: Deps,
): Promise<Verdict> {
  const url = String(env.N8N_WEBHOOK_URL || "").trim();
  const secret = String(env.N8N_SHARED_SECRET || "").trim();

  // Eerst de eigen configuratie, en met de NAAM van wat er mist. Een Worker die
  // hier "tijdelijk niet beschikbaar" zegt laat hem naar het verkeerde zoeken.
  if (!url) {
    return {
      kind: "reject",
      reason:
        "LaVega kan deze mail niet verwerken: de variabele N8N_WEBHOOK_URL is niet gezet op de Worker lavega-email-in. " +
        "Zet hem met `wrangler deploy` (vars) en probeer opnieuw.",
    };
  }
  if (!secret) {
    return {
      kind: "reject",
      reason:
        "LaVega kan deze mail niet verwerken: het secret N8N_SHARED_SECRET is niet gezet op de Worker lavega-email-in. " +
        "Zet hem met `wrangler secret put N8N_SHARED_SECRET`.",
    };
  }

  const queueKey = localPartOf(message.to);
  if (!queueKey) {
    return {
      kind: "reject",
      reason:
        "LaVega weet niet bij welke wachtrij dit hoort: het ontvangende adres (" +
        short(message.to, 80) +
        ") heeft geen lokaal deel voor de @. Stuur naar <naam>-<code>@invoices.lavega.dev.",
    };
  }

  // De grootte, VÓÓR het parsen — de enige controle die kan zonder de mail in
  // het geheugen te trekken.
  if (message.rawSize > MAX_MESSAGE_BYTES) {
    return {
      kind: "reject",
      reason:
        "Deze mail is " +
        mb(message.rawSize) +
        " en LaVega neemt maximaal " +
        mb(MAX_MESSAGE_BYTES) +
        " aan (drie PDF's van 4 MB). Stuur de facturen los door.",
    };
  }

  let mail: ParsedMail;
  try {
    const bytes = await readRaw(message.raw, MAX_MESSAGE_BYTES);
    mail = parseMail(bytesToLatin1(bytes));
  } catch (error) {
    return {
      kind: "reject",
      reason:
        "LaVega kon deze mail niet lezen: " +
        short(error instanceof Error ? error.message : String(error), 200) +
        ". Er is niets opgeslagen.",
    };
  }

  const capProblem = checkAttachmentCaps(mail);
  if (capProblem)
    return { kind: "reject", reason: "LaVega heeft deze mail niet aangenomen: " + capProblem };

  const payload = buildPayload(message, mail);

  let response: Response;
  try {
    response = await deps.fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", [SECRET_HEADER]: secret },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    return {
      kind: "reject",
      reason:
        "LaVega's verwerker (n8n) was niet bereikbaar op " +
        short(url, 120) +
        ": " +
        short(error instanceof Error ? error.message : String(error), 150) +
        ". De mail is NIET verwerkt; stuur hem later opnieuw door.",
    };
  }

  if (response.status === 401 || response.status === 403) {
    return {
      kind: "reject",
      reason:
        "LaVega's verwerker weigerde de Worker (" +
        response.status +
        "): het geheim in N8N_SHARED_SECRET komt niet overeen met de Header Auth-credential (" +
        SECRET_HEADER +
        ") op de n8n-node 'E-mail binnen'. De mail is NIET verwerkt.",
    };
  }
  if (response.status === 404) {
    return {
      kind: "reject",
      reason:
        "LaVega's verwerker gaf 404 op " +
        short(url, 120) +
        ". Bij n8n betekent dat bijna altijd: de workflow staat niet op Actief, of dit is de test-URL in plaats van de production-URL. De mail is NIET verwerkt.",
    };
  }
  if (!response.ok) {
    let detail = "";
    try {
      detail = short(await response.text(), 200);
    } catch {
      detail = "(geen leesbaar antwoord)";
    }
    return {
      kind: "reject",
      reason:
        "LaVega's verwerker gaf status " +
        response.status +
        ": " +
        detail +
        ". De mail is NIET verwerkt; kijk in n8n bij Executions welke node omviel.",
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      kind: "reject",
      reason:
        "LaVega's verwerker antwoordde met status " +
        response.status +
        " maar geen JSON. Staat Respond van de node 'E-mail binnen' nog op 'When Last Node Finishes'? De mail is NIET verwerkt.",
    };
  }

  const counts = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const addedInvoices = counts.addedInvoices;
  const addedNotices = counts.addedNotices;
  // Onbekend is hier geen nul. Zonder deze twee getallen weten we NIET of er iets
  // in de rij staat, en dan mag deze mail niet als aangekomen gelden.
  if (typeof addedInvoices !== "number" || typeof addedNotices !== "number") {
    return {
      kind: "reject",
      reason:
        "LaVega's verwerker antwoordde zonder de telling {addedInvoices, addedNotices}, dus of deze mail in de wachtrij staat is onbekend. " +
        "Controleer in n8n of 'E-mail binnen' op Respond: When Last Node Finishes staat en of de laatste node 'Zet in de wachtrij' is.",
    };
  }

  if (addedInvoices + addedNotices === 0) {
    return {
      kind: "reply",
      subject: mail.subject,
      inReplyTo: mail.messageId,
      body: [
        "Deze mail is bij LaVega aangekomen en volledig verwerkt, maar er is niets aan de wachtrij toegevoegd.",
        "",
        "Dat gebeurt in drie gevallen:",
        "  1. het was een betaalbewijs — dat staat al in je bankafschriften en wordt niet als verwachte factuur ingeboekt;",
        "  2. deze mail stond al in de wachtrij (ontdubbeld op Message-ID " +
          (mail.messageId || "(ontbrak)") +
          ");",
        "  3. er zat geen factuur in en ook niets waarover een melding nodig was.",
        "",
        "Wil je weten welke van de drie: n8n → Executions → de laatste run van 'LaVega — facturen'.",
        "Er is niets stilzwijgend weggegooid; dit bericht is het bewijs daarvan.",
      ].join("\n"),
    };
  }

  return {
    kind: "queued",
    detail:
      addedInvoices +
      " factuur/facturen en " +
      addedNotices +
      " melding(en) toegevoegd voor wachtrij " +
      queueKey,
  };
}

/**
 * Het oordeel uitvoeren. Kort gehouden met opzet: alles hierin kan alleen in
 * Cloudflare zelf falen.
 *
 * Let op de terugval: lukt een antwoord niet — bijvoorbeeld omdat de mail geen
 * Message-ID had, en dan weigert Cloudflare het — dan wordt het een bounce. Er
 * is geen pad waarlangs de mail stil eindigt.
 */
export async function applyVerdict(
  message: ForwardableEmailMessage,
  verdict: Verdict,
  deps: Deps,
): Promise<void> {
  if (verdict.kind === "queued") return;
  if (verdict.kind === "reject") {
    message.setReject(short(verdict.reason, 400));
    return;
  }

  const raw = buildReplyMime({
    from: message.to,
    to: message.from,
    subject: verdict.subject,
    inReplyTo: verdict.inReplyTo,
    body: verdict.body,
  });
  if (raw && deps.makeReply) {
    try {
      await message.reply(deps.makeReply(message.to, message.from, raw));
      return;
    } catch (error) {
      // Antwoorden lukte niet. Dan bouncen, met de oorspronkelijke uitleg ÉN de
      // reden dat het een bounce is geworden.
      message.setReject(
        short(
          verdict.body.split("\n")[0] +
            " (antwoorden lukte niet: " +
            (error instanceof Error ? error.message : String(error)) +
            ")",
          400,
        ),
      );
      return;
    }
  }
  message.setReject(
    short(
      verdict.body.split("\n")[0] +
        (raw
          ? ""
          : " (er was geen Message-ID om op te antwoorden, dus dit is een bounce geworden)"),
      400,
    ),
  );
}

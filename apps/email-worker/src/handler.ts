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

import { domainOf, localPartOf, UNKNOWN_CHECKS, type SenderChecks } from "./authResults.js";
import {
  MAX_PARTS,
  MAX_PART_DEPTH,
  parseMail,
  sanitizeFileName,
  type ParsedMail,
} from "./parseMail.js";
import { buildReplyMime } from "./replyMime.js";
import { checkSpoofGate } from "./spoofGate.js";
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

/**
 * Alleen het ADRES uit een From-regel, zonder de weergavenaam. De naam is door
 * de afzender te verzinnen en verdwijnt hier met opzet (bevinding A5): die naam
 * komt in de wachtrij terecht, en `ING Bank <nep@elders.example>` leest daar als
 * een echte afzender terwijl het adres dat niet is. Het adres zelf is nog steeds
 * `ongeverifieerd` — dat verandert hier niets aan.
 */
export function addressOnly(value: string): string {
  const matches = String(value || "").match(/<[^<>]*>/g);
  const address = matches ? matches[matches.length - 1].slice(1, -1) : String(value || "");
  return address.trim();
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
        (sanitizeFileName(pdf.fileName) || "(zonder naam)") +
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
    // Alleen het ADRES, niet de weergavenaam: zie addressOnly (bevinding A5). Let
    // op wat dit BETEKENT bij doorsturen: dan is dit zijn eigen adres, niet dat
    // van de leverancier. De leverancier komt uit de factuur zelf
    // (`counterparty`).
    from: addressOnly(mail.from || message.from),
    subject: mail.subject,
    date: mail.date,
    messageId: mail.messageId,
    text: mail.text,
    html: mail.html,
    // Cloudflare meet authenticatie vóór Worker delivery, maar geeft de uitslag
    // niet als vertrouwde metadata door. Headers zijn afzendertekst: ook een
    // `mx.cloudflare.net`-regel mag hier nooit "pass" opleveren (H2).
    auth: { ...UNKNOWN_CHECKS },
    attachments: mail.attachments.map((a) => ({
      // Defensief nog een keer: de parser saneert al, maar dit veld gaat de
      // wachtrij in en moet nooit ruwe stuurtekens dragen.
      fileName: sanitizeFileName(a.fileName),
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

  /* De mail nestte dieper of had meer delen dan de parser aankan (M12). Er
   * ontbreken dan delen, dus dit mag geen "verwerkt" worden: een BENOEMDE
   * weigering met de reden, zodat de afzender het hoort. */
  if (mail.partsCapped) {
    return {
      kind: "reject",
      reason:
        "LaVega heeft deze mail niet aangenomen: hij is te diep genest of heeft te veel delen " +
        "(meer dan " +
        MAX_PART_DEPTH +
        " lagen of " +
        MAX_PARTS +
        " delen). Stuur de factuur als één PDF in een gewone mail.",
    };
  }

  /* De lokale spoof-poort, vóór de bijlage-limieten en vóór de POST. Hij kijkt
   * niet naar SPF/DKIM/DMARC — die uitslag geeft Cloudflare niet mee — maar naar
   * wat zonder meting al onwaar is. Zie de kop van spoofGate.ts, inclusief
   * waarom "envelop en From moeten hetzelfde domein hebben" hier verboden is:
   * dat is precies de doorgestuurde factuur. */
  const spoofRefusal = checkSpoofGate({
    envelopeFrom: message.from,
    fromHeader: mail.from,
    headers: mail.headers,
  });
  if (spoofRefusal) return { kind: "reject", reason: spoofRefusal.reason };

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
 * Waarom we NIET op deze afzender mogen antwoorden (M13), of null als het mag.
 *
 * Een antwoord op een automaat is het begin van een lus: die automaat antwoordt
 * terug, wij antwoorden weer, en dat loopt door tot iemand het merkt — op de
 * kosten van de eigenaar, want elke ronde kost n8n en een Claude-extractie. Drie
 * soorten afzenders komen hier in beeld:
 *   1. onszelf — iets onder `lavega.dev`, want dan mailt het systeem zichzelf;
 *   2. een automaat dat het zelf zegt (`Auto-Submitted`, `Precedence`,
 *      `List-Id`);
 *   3. een adres dat per afspraak niet leest: `no-reply`, `noreply`,
 *      `mailer-daemon`, `postmaster`, `bounce`, … .
 */
export function replyWouldLoop(from: string, headers: Headers): string | null {
  const domain = domainOf(from);
  if (domain === "lavega.dev" || domain.endsWith(".lavega.dev")) {
    return "de afzender hoort bij LaVega zelf";
  }
  const autoSubmitted = (headers.get("Auto-Submitted") || "").trim().toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") {
    return "het bericht zegt zelf dat het automatisch is (Auto-Submitted)";
  }
  const precedence = (headers.get("Precedence") || "").trim().toLowerCase();
  if (precedence === "bulk" || precedence === "list" || precedence === "junk") {
    return "het bericht is een bulk- of lijstbericht (Precedence: " + precedence + ")";
  }
  if (headers.get("List-Id")) {
    return "het bericht komt van een mailinglijst (List-Id)";
  }
  const local = localPartOf(from);
  if (
    /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce[rs]?|notifications?|automated)/i.test(
      local,
    )
  ) {
    return "het adres (" + local + "@…) leest niet";
  }
  return null;
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

  // Antwoorden op een automaat of op onszelf start een lus (M13). Dan liever
  // dezelfde terugval als wanneer Cloudflare het antwoord weigert: een bounce
  // met de uitleg erin. Er verdwijnt nog steeds niets.
  const loop = replyWouldLoop(message.from, message.headers);
  if (loop) {
    message.setReject(short(verdict.body.split("\n")[0] + " (niet geantwoord: " + loop + ")", 400));
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

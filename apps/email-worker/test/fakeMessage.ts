/* Een nagemaakt `ForwardableEmailMessage`, zodat het oordeel over een mail te
 * testen is zonder Cloudflare.
 *
 * EERLIJK OVER DE GRENS HIERVAN: dit is niet Cloudflare. Wat hier nagebouwd is,
 * is precies het stuk waar de Worker op leunt — `to`, `from`, `rawSize`, `raw`
 * als stream, `headers`, en het feit dat `setReject` en `reply` de twee enige
 * manieren zijn om de afzender iets te laten weten. Wat NIET nagebouwd kan
 * worden is of Cloudflare het antwoord accepteert, of een bounce daadwerkelijk
 * bij de afzender aankomt, en of Email Routing de mail überhaupt aan de Worker
 * geeft. Dat kan alleen de eerste echte doorgestuurde factuur uitwijzen; het
 * staat als zodanig in docs/n8n/DOORSTUURADRES.md.
 */

export type FakeMessage = {
  from: string;
  to: string;
  headers: Headers;
  raw: ReadableStream<Uint8Array>;
  rawSize: number;
  setReject(reason: string): void;
  forward(rcptTo: string, headers?: Headers): Promise<void>;
  reply(message: unknown): Promise<void>;
  /** Wat de test wil weten. */
  rejected: string[];
  replied: unknown[];
};

export function fakeMessage(options: {
  raw: string;
  to?: string;
  from?: string;
  /** Overschrijf de grootte om de limietcontrole te testen zonder 17 MB tekst. */
  rawSize?: number;
  /** Laat `reply` falen, om de terugval naar een bounce te kunnen zien. */
  replyThrows?: string;
}): FakeMessage {
  const bytes = new Uint8Array(options.raw.length);
  for (let i = 0; i < options.raw.length; i++) bytes[i] = options.raw.charCodeAt(i) & 0xff;

  // De Authentication-Results-header komt bij Cloudflare uit `message.headers`,
  // niet uit de geparste MIME — dus die moet hier ook uit de ruwe tekst komen.
  const headers = new Headers();
  const headerBlock = options.raw.split(/\r?\n\r?\n/)[0].replace(/\r?\n[ \t]+/g, " ");
  for (const line of headerBlock.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon > 0) headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }

  const message: FakeMessage = {
    from: options.from ?? "facturen@hostingnoord.nl",
    to: options.to ?? "alexander-7f3a@invoices.lavega.dev",
    headers,
    rawSize: options.rawSize ?? bytes.byteLength,
    raw: new ReadableStream<Uint8Array>({
      start(controller) {
        // In twee stukken, zodat de lus die de stream leegleest ook echt loopt.
        controller.enqueue(bytes.subarray(0, Math.floor(bytes.byteLength / 2)));
        controller.enqueue(bytes.subarray(Math.floor(bytes.byteLength / 2)));
        controller.close();
      },
    }),
    setReject(reason: string) {
      message.rejected.push(reason);
    },
    async forward() {
      throw new Error("forward wordt door deze Worker niet gebruikt");
    },
    async reply(replyMessage: unknown) {
      if (options.replyThrows) throw new Error(options.replyThrows);
      message.replied.push(replyMessage);
    },
    rejected: [],
    replied: [],
  };
  return message;
}

/** Een `fetch` die altijd hetzelfde teruggeeft, en die opschrijft wat hij kreeg. */
export function fakeFetch(
  reply: { status?: number; body?: unknown; text?: string; throws?: string },
): { fetch: typeof fetch; calls: { url: string; headers: Record<string, string>; body: unknown }[] } {
  const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (reply.throws) throw new Error(reply.throws);
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[key.toLowerCase()] = value;
    }
    calls.push({ url: String(input), headers, body: JSON.parse(String(init?.body ?? "null")) });
    const status = reply.status ?? 200;
    const text = reply.text ?? JSON.stringify(reply.body ?? {});
    return new Response(text, { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetch: impl, calls };
}

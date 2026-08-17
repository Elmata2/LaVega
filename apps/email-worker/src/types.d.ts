/* De stukjes Cloudflare-API die deze Worker gebruikt, met de hand getypt.
 *
 * WAAROM NIET `@cloudflare/workers-types`: deze Worker heeft geen enkele
 * afhankelijkheid, en dat is opzet. Er is niets te installeren, niets te
 * updaten en niets dat stil van gedrag verandert tussen twee deploys van een
 * pad dat een factuur draagt. De prijs is dit bestand: vier velden en drie
 * methodes. Loopt dit uit de pas met Cloudflare, dan faalt de deploy of de
 * eerste echte mail — beide zichtbaar.
 *
 * Bron: Cloudflare Email Workers, `ForwardableEmailMessage`.
 */

/** Eén inkomende mail, zoals de `email()`-handler hem krijgt. */
export interface ForwardableEmailMessage {
  /** De envelop-afzender (MAIL FROM). Niet hetzelfde als de From:-header. */
  readonly from: string;
  /** Het adres waarop de mail binnenkwam (RCPT TO). Dit bepaalt de wachtrij. */
  readonly to: string;
  readonly headers: Headers;
  readonly raw: ReadableStream<Uint8Array>;
  /** Het aantal bytes van het hele bericht, vóór het lezen bekend. */
  readonly rawSize: number;
  /** Weiger de mail op SMTP-niveau: de verzendende server maakt er een bounce
   *  van, dus de afzender hoort ervan. */
  setReject(reason: string): void;
  forward(rcptTo: string, headers?: Headers): Promise<void>;
  reply(message: unknown): Promise<void>;
}

export interface Env {
  /** De production-URL van de n8n-webhook "E-mail binnen". */
  N8N_WEBHOOK_URL?: string;
  /** Hetzelfde geheim als in de Header Auth-credential van die node.
   *  Als secret gezet met `wrangler secret put`, nooit in de repo. */
  N8N_SHARED_SECRET?: string;
}

/** His own n8n webhook/API credentials, as stored in the encrypted vault (see
 *  encryptedStorage.ts). Lives on `VaultData` and travels in the same
 *  encrypted export/`.lavega` backup blob as `BrokerCredentials` — a live
 *  secret at rest under the vault passphrase, the same accepted risk model
 *  this codebase already applies to broker tokens, in place of the plaintext
 *  localStorage keys these replaced. Undefined fields, not "", are "never
 *  set": an empty string would claim a deliberate clear rather than the
 *  honest absence. */
export type N8nSettings = {
  /** His n8n's base URL, for the n8n API (workflow provisioning). */
  baseUrl?: string;
  /** An n8n API key — can create and modify workflows. */
  apiKey?: string;
  /** The webhook Production URL Facturen polls to read the invoice queue. */
  invoiceUrl?: string;
  /** The `x-lavega-token` header value for that webhook. */
  invoiceToken?: string;
};

/** One invoice that booked itself from the n8n queue, logged so "this one
 *  arrived without you" survives a reload. `Invoice.autoBooked` (model.ts) is
 *  the field of record; this list is the fallback for rows booked before that
 *  field existed, and is itself only ever appended to here — inside the vault,
 *  unlike its predecessor localStorage list. */
export type N8nAutoBooked = { invoiceId: string; messageId: string; subject?: string };

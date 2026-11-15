/*
 * Shared classification of an AI-call failure (#300, WS5.7 leftover).
 *
 * The route answers a human with a localized message, and the ledger records a
 * machine code plus the upstream HTTP status. Both come from the same error, so
 * they are classified here once instead of in each route and each provider.
 *
 * No message text leaves this module: the ledger stores `code`, and the route
 * maps it to Dutch copy. That is what keeps a provider body (which can echo a
 * request) out of both the ledger and the browser.
 */

import { MistralHttpError } from "./mistral.js";

export type AiFailureCode =
  | "ai-upstream-limit"
  | "ai-credentials-refused"
  | "ai-timeout"
  | "ai-fault";

/** The failure code the ledger stores. 429 is the provider's spend/rate cap;
 *  401/403 is a key the provider refuses; a timeout is its own case because it
 *  is expected on the search-backed routes. */
export function aiFailureCode(error: unknown): AiFailureCode {
  if (error instanceof MistralHttpError) {
    if (error.status === 429) return "ai-upstream-limit";
    if (error.status === 401 || error.status === 403) return "ai-credentials-refused";
    return "ai-fault";
  }
  if (error instanceof Error && /timeout after \d+ms/i.test(error.message)) return "ai-timeout";
  return "ai-fault";
}

/** The upstream HTTP status, or undefined when the failure never got one
 *  (timeout, transport, malformed body). */
export function upstreamHttpStatus(error: unknown): number | undefined {
  return error instanceof MistralHttpError ? error.status : undefined;
}

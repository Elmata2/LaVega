/** A rejected input at an agent redaction boundary. Carries a machine `code`
 *  alongside the existing Dutch `message` so a route can answer with the
 *  right sentence in ANY locale without parsing prose or guessing from the
 *  message text — see apps/web/src/copy/apiErrors.ts, which is the other
 *  half of this (not touched here). */
export class ValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

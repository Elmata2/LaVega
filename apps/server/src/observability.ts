import * as Sentry from "@sentry/node";
import { HTTPException } from "hono/http-exception";
import { scrubText, sentryOptions } from "@lavega/core";
import { logPosthogError } from "./posthogLogs.js";

const FLUSH_TIMEOUT_MS = 2000;

type Env = Record<string, string | undefined>;

export function initServerSentry(env: Env = process.env): boolean {
  const options = sentryOptions({
    dsn: env.SENTRY_DSN,
    environment: env.VERCEL_ENV ?? env.NODE_ENV,
    app: "server",
  });
  if (!options) return false;
  Sentry.init(options);
  return true;
}

export async function serverErrorResponse(error: Error): Promise<Response> {
  if (error instanceof HTTPException) return error.getResponse();
  /* The console line went out RAW, ahead of Sentry — and Sentry is the channel
   * with the redaction allowlist (packages/core/src/sentryScrub.ts). So the one
   * place that writes to the platform log untouched was also the one place an
   * unhandled error's message could carry a token, an IBAN, an amount or a
   * JSON-quoted body (security review 2026-10-17, A3). Same scrubber, same
   * rules, before anything leaves the process. */
  console.error(scrubText(error.stack ?? error.message));
  logPosthogError("unexpected server error", {
    event: "server_request_failed",
    error_kind: error.name || "Error",
  });
  if (Sentry.getClient()) {
    Sentry.captureException(error);
    await Sentry.flush(FLUSH_TIMEOUT_MS);
  }
  return new Response("Internal Server Error", { status: 500 });
}

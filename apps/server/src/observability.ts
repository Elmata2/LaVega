import * as Sentry from "@sentry/node";
import { HTTPException } from "hono/http-exception";
import { sentryOptions } from "@lavega/core";

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
  console.error(error);
  if (Sentry.getClient()) {
    Sentry.captureException(error);
    await Sentry.flush(FLUSH_TIMEOUT_MS);
  }
  return new Response("Internal Server Error", { status: 500 });
}

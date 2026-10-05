import * as Sentry from "@sentry/browser";
import { sentryOptions } from "@lavega/core";

type BrowserEnv = { VITE_SENTRY_DSN?: string; MODE?: string };

export function initWebSentry(env: BrowserEnv = import.meta.env): boolean {
  const options = sentryOptions({ dsn: env.VITE_SENTRY_DSN, environment: env.MODE, app: "web" });
  if (!options) return false;
  Sentry.init(options);
  return true;
}
